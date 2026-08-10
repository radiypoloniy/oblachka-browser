// Стенд «читается ли цена товара» (замер перед фичей отслеживания товаров).
//
// Отвечает на ЕДИНСТВЕННЫЙ вопрос, от которого зависит вся фича: можем ли мы узнать цену и
// наличие ПОТОМ, без человека. Прочитать их на открытой странице мы уже умеем (pageFacts.ts), а
// вся ценность отслеживания — в повторном чтении, и по нему в проекте уже записан неприятный
// замер: «открывая страницу ВТОРЫМ заходом, мы упираемся в антибот, капчу и логин» (см.
// NotebookExtract в CLAUDE.md; Amazon и AliExpress вторым заходом не открывались вовсе).
//
// Поэтому меряем ТРИ пути на каждый адрес:
//   1) сырой HTTP-запрос без JS — самый дешёвый; если JSON-LD отдаётся сервером, отслеживание
//      почти ничего не стоит и не выглядит роботом;
//   2) фоновая вью с ЖИВОЙ сессией человека (его куки) — дороже, но переживает то, что требует
//      входа; ровно так забирается картинка из веб-чата в графе;
//   3) те же факты, но со страницы — эталон «сколько можно было бы получить».
//
// ⚠️ Стенд ничего не пишет: ни истории, ни сессии, ни индекса. Он поднимается ВМЕСТО боевого
// окна (как OBLAKO_LLAMA_TEST) и работает на боевом профиле только ради кук — это осознанно,
// иначе замер соврёт: без кук магазины ведут себя иначе.
import { BrowserWindow, session, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { PAGE_FACTS_SCRIPT, type PageFacts } from './pageFacts';
import { applyClientHints } from './BrowserIdentity';

// Сколько ждём догрузки страницы. Карточки товара тяжёлые, но вечно ждать нельзя — «не успело»
// это тоже результат замера.
const LOAD_TIMEOUT_MS = 30_000;
// Пауза после загрузки: цена часто дорисовывается скриптом уже после did-finish-load.
const SETTLE_MS = 2500;

interface ProbeRow {
  url: string;
  host: string;
  raw: string;      // что дал сырой запрос
  view: string;     // что дала фоновая вью
  note: string;     // приметы антибота и прочее
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url.slice(0, 30); }
}

/**
 * Разбор JSON-LD из СЫРОГО HTML, без DOM.
 *
 * ⚠️ Намеренно наивный: задача стенда — узнать, отдаёт ли сервер структурные данные вообще.
 * Если этот путь заработает, он и станет боевым (дёшево и не похоже на робота), и вот тогда
 * разбор надо будет вынести в отдельный модуль под прогон — как fileNameSafety/addressParts.
 */
function factsFromRawHtml(html: string): { price?: string; currency?: string; availability?: string; name?: string } | null {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of blocks) {
    const body = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { continue; }
    const stack: unknown[] = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) { stack.push(...node); continue; }
      if (!node || typeof node !== 'object') continue;
      const obj = node as Record<string, unknown>;
      for (const v of Object.values(obj)) if (v && typeof v === 'object') stack.push(v);
      const type = String(obj['@type'] ?? '');
      if (!/product/i.test(type)) continue;
      const offers = (Array.isArray(obj.offers) ? obj.offers[0] : obj.offers) as Record<string, unknown> | undefined;
      const price = offers?.price != null ? String(offers.price) : undefined;
      const currency = offers?.priceCurrency != null ? String(offers.priceCurrency) : undefined;
      const availability = offers?.availability != null ? String(offers.availability) : undefined;
      const name = obj.name != null ? String(obj.name) : undefined;
      if (price || availability) return { price, currency, availability, name };
    }
  }
  return null;
}

function summarize(f: { price?: string | null; currency?: string | null; availability?: string | null } | null): string {
  if (!f) return 'нет';
  const parts: string[] = [];
  if (f.price) parts.push(`${f.price}${f.currency ? ' ' + f.currency : ''}`);
  if (f.availability) parts.push(String(f.availability).replace(/^https?:\/\/schema\.org\//, ''));
  return parts.length ? parts.join(' · ') : 'нет';
}

async function probeRaw(url: string): Promise<{ text: string; note: string }> {
  try {
    // ⚠️ Через session.defaultSession, а не голым fetch: так уходят куки человека, наш UA и
    // клиентские подсказки — то есть запрос выглядит как из браузера, а не как из скрипта.
    const res = await session.defaultSession.fetch(url, { method: 'GET' });
    if (!res.ok) return { text: 'нет', note: `HTTP ${res.status}` };
    const html = await res.text();
    const facts = factsFromRawHtml(html);
    const captcha = /captcha|проверка безопасности|are you a robot|challenge-platform/i.test(html.slice(0, 200_000));
    return { text: summarize(facts), note: captcha ? 'похоже на капчу' : '' };
  } catch (e) {
    return { text: 'нет', note: (e as Error).message.slice(0, 60) };
  }
}

// ⚠️ ОДНО скрытое окно на весь прогон, а не своё на каждый адрес. Причина не в экономии: как
// только последнее окно приложения закрывается, срабатывает window-all-closed → app.quit(), и
// замер обрывался после первого же адреса (поймано на живом прогоне). Заодно так быстрее.
let probeWin: BrowserWindow | null = null;

function ensureProbeWindow(): BrowserWindow {
  if (probeWin && !probeWin.isDestroyed()) return probeWin;
  probeWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  return probeWin;
}

async function probeView(url: string): Promise<{ text: string; note: string }> {
  // Страница может уронить свой рендерер — тогда окно пересоздаётся следующим вызовом.
  const win = ensureProbeWindow();
  try {
    const loaded = new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve('не дождались загрузки'), LOAD_TIMEOUT_MS);
      win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve(''); });
      win.webContents.once('did-fail-load', (_e, code, desc) => {
        clearTimeout(timer); resolve(`ошибка загрузки ${code} ${desc}`);
      });
    });
    void win.loadURL(url);
    const failure = await loaded;
    if (failure) return { text: 'нет', note: failure };

    await new Promise((r) => setTimeout(r, SETTLE_MS));
    // PAGE_FACTS_SCRIPT только ОБЪЯВЛЯЕТ __oblakoCollectFacts — вызываем сами (как в
    // AiPanelManager.buildExtractionScript). Факты берём по нетронутому документу.
    const facts = await win.webContents.executeJavaScript(
      `(function(){ ${PAGE_FACTS_SCRIPT}\n try { return __oblakoCollectFacts(); } catch (e) { return null; } })()`,
    ) as PageFacts | null;
    const title = win.webContents.getTitle();
    const captcha = /captcha|robot|проверк/i.test(title);
    return { text: summarize(facts), note: captcha ? `капча: ${title.slice(0, 40)}` : '' };
  } catch (e) {
    return { text: 'нет', note: (e as Error).message.slice(0, 60) };
  }
}

/** Закрыть окно замера. Зовётся ОДИН раз в самом конце — см. комментарий у ensureProbeWindow. */
function closeProbeWindow(): void {
  if (probeWin && !probeWin.isDestroyed()) probeWin.destroy();
  probeWin = null;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length);
}

export async function runPriceProbe(urls: string[]): Promise<void> {
  applyClientHints(session.defaultSession);
  const out: string[] = [];
  // ⚠️ Отчёт пишется ФАЙЛОМ в UTF-8, а не только в консоль: консоль Windows показывает кириллицу
  // кракозябрами (cp866), и прочитать результат замера было невозможно (поймано на живом прогоне).
  const log = (line: string): void => { out.push(line); console.log(line); };

  log(`[price-probe] адресов: ${urls.length}. Замер: страницы только читаются, ничего не сохраняется.`);

  const rows: ProbeRow[] = [];
  for (const url of urls) {
    const host = hostOf(url);
    const raw = await probeRaw(url);
    const view = await probeView(url);
    const note = [raw.note && `сырой: ${raw.note}`, view.note && `вью: ${view.note}`].filter(Boolean).join('; ');
    rows.push({ url, host, raw: raw.text, view: view.text, note });
    log(`  ${pad(host, 22)} сырой: ${pad(raw.text, 26)} вью: ${view.text}`);
  }
  closeProbeWindow();

  log('');
  log('─── ИТОГ ────────────────────────────────────────────────────────────');
  log(`${pad('сайт', 22)}${pad('сырой HTTP', 28)}фоновая вью`);
  for (const r of rows) {
    log(`${pad(r.host, 22)}${pad(r.raw, 28)}${r.view}`);
    if (r.note) log(`${' '.repeat(22)}↳ ${r.note}`);
  }

  const rawOk = rows.filter((r) => r.raw !== 'нет').length;
  const viewOk = rows.filter((r) => r.view !== 'нет').length;
  log('');
  log('─── ЧТО ЭТО ЗНАЧИТ ──────────────────────────────────────────────────');
  log(`Сырым запросом цена читается на ${rawOk} из ${rows.length} — это самый дешёвый путь.`);
  log(`Фоновой вью — на ${viewOk} из ${rows.length}. Столько магазинов сможет отслеживать фича.`);
  log('Там, где «нет» в обоих столбцах, отслеживание невозможно в принципе:');
  log('цену придётся брать только когда человек сам открыл страницу.');

  const reportPath = path.join(app.getAppPath(), 'scripts', 'price-probe-report.txt');
  try {
    fs.writeFileSync(reportPath, out.join('\r\n'), 'utf8');
    console.log(`\n[price-probe] отчёт: ${reportPath}`);
  } catch (e) {
    console.warn('[price-probe] отчёт не записался:', (e as Error).message);
  }
}
