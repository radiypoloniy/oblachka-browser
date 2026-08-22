import { net } from 'electron';
import {
  parseFeedItems, looksLikeFeed,
  GEN_WEB_MAX_BYTES, GEN_WEB_TIMEOUT_MS, GEN_WEB_MIN_INTERVAL_MS,
  type GenFeedItem,
} from '../shared/genWeb';
// ⚠️ Допуск адреса лежит в genSpec: два модуля из shared/ не могут ссылаться друг на друга,
// потому что проверки гоняют их голым node (см. шапку genWeb.ts).
import { isAllowedGenUrl } from '../shared/genSpec';

// Поход по ссылке, которую дал человек. ЕДИНСТВЕННОЕ место, откуда свой виджет достаёт сеть.
//
// ⚠️ Ходит МAIN через net.fetch, а не страница. Это не формальность: net.fetch идёт сессией
// Electron, то есть уважает session.setProxy — а значит VPN, kill switch и адблок. Тот же
// запрос из renderer'а через глобальный fetch ушёл бы стеком Node мимо туннеля (этот случай
// в проекте уже ловили, см. SearchSuggestFetcher.ts и аудит утечек).
//
// ⚠️ credentials: 'omit' — куки сайта к запросу не прикладываются. Виджет на плитке не должен
// ходить куда-либо от имени залогиненного человека.

export type GenWebResult =
  | { ok: true; kind: 'feed'; items: GenFeedItem[]; title: string }
  | { ok: true; kind: 'json'; json: unknown }
  | { ok: false; error: string };

interface CacheRow { at: number; res: GenWebResult }

const cache = new Map<string, CacheRow>();

/** Заголовок самого фида — из него получается осмысленная подпись плитки. */
function feedTitle(xml: string): string {
  const head = xml.slice(0, 4000);
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  if (!m) return '';
  return (m[1] ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

async function readCapped(res: Response): Promise<string | null> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > GEN_WEB_MAX_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > GEN_WEB_MAX_BYTES) return null;
  return buf.toString('utf8');
}

/**
 * Сходить по адресу и понять, что там: фид или JSON.
 *
 * ⚠️ Тип определяется по СОДЕРЖИМОМУ, а не по расширению в адресе: половина фидов лежит по
 * путям вроде /rss без расширения, а половина API отдаёт JSON с content-type text/plain.
 */
export async function fetchGenWeb(rawUrl: string, force = false): Promise<GenWebResult> {
  const url = String(rawUrl ?? '').trim();
  if (!isAllowedGenUrl(url)) {
    return { ok: false, error: 'Нужна ссылка https на публичный адрес' };
  }
  const hit = cache.get(url);
  // ⚠️ Плитка на новой вкладке перерисовывается часто, и без этого порога сайт получал бы
  // запрос на каждый показ стола. Пять минут — предел вежливости к чужому серверу.
  if (hit && !force && Date.now() - hit.at < GEN_WEB_MIN_INTERVAL_MS) return hit.res;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), GEN_WEB_TIMEOUT_MS);
  let res: GenWebResult;
  try {
    const r = await net.fetch(url, {
      credentials: 'omit',
      signal: ctl.signal,
      headers: { accept: 'application/json, application/rss+xml, application/atom+xml, text/xml;q=0.9, */*;q=0.5' },
    });
    if (!r.ok) {
      res = { ok: false, error: `Сайт ответил ${r.status}` };
    } else {
      const body = await readCapped(r);
      if (body === null) {
        res = { ok: false, error: 'Ответ слишком большой для плитки' };
      } else if (looksLikeFeed(body)) {
        const items = parseFeedItems(body);
        res = items.length
          ? { ok: true, kind: 'feed', items, title: feedTitle(body) }
          : { ok: false, error: 'Это фид, но в нём нет записей' };
      } else {
        try {
          res = { ok: true, kind: 'json', json: JSON.parse(body) as unknown };
        } catch {
          // ⚠️ Обычная HTML-страница сюда попадает штатно, и отказ должен объяснять ПОЧЕМУ:
          // вытаскивать значения из вёрстки мы намеренно не умеем — такой виджет умирал бы
          // молча при первой же перевёрстке сайта.
          res = { ok: false, error: 'По ссылке обычная страница. Нужен адрес RSS-ленты или JSON-ответа' };
        }
      }
    }
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'Сайт не ответил вовремя' : 'Не удалось открыть ссылку';
    res = { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }

  cache.set(url, { at: Date.now(), res });
  // Кэш не должен расти бесконечно: виджетов немного, а адресов человек может перепробовать много.
  if (cache.size > 40) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return res;
}
