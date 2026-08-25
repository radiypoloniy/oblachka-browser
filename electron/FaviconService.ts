import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fetchInProfile } from './ProfileSession';
import { createLimiter } from '../shared/limitConcurrency';

// Favicon для адресов (список паролей и т.п.). Тянем ТОЛЬКО с самого сайта (через fetchInProfile —
// это Chromium-сеть, уважает VPN/прокси/адблок), без сторонних favicon-сервисов — приватный
// браузер не должен светить домены аккаунтов третьей стороне. Двухуровневый кэш: память на сессию
// + файлы в userData (иконки маленькие, но повторно дёргать сеть при каждом открытии настроек не
// нужно). Негативы (иконки нет) кэшируются только в памяти — вдруг сайт добавит favicon позже.

// ⚠️ Каталог сменил имя вместе с правилом отбора иконки (см. #fetchForHost): в прежнем лежат
// сохранённые 16×16, и без смены имени человек так и остался бы с лесенками — кэш отдавал бы
// старую мелкую иконку раньше, чем дело дошло бы до новой логики.
// Сколько незнакомых доменов опрашиваем одновременно. ⚠️ Четыре, а не «сколько попросят»:
// значок это украшение строки, и он не имеет права соревноваться за сеть со страницей, которую
// человек открывает. Больше четырёх заметно только на первом открытии архива с пустым кэшем —
// и там выигрыш съедается конкуренцией за туннель.
const FAVICON_NET = createLimiter(4);

const CACHE_DIR = path.join(app.getPath('userData'), 'favicon-cache-v3');
const LEGACY_CACHE_DIRS = ['favicon-cache', 'favicon-cache-hidpi'].map((d) => path.join(app.getPath('userData'), d));
const MAX_BYTES = 256 * 1024;       // иконка больше четверти мегабайта — почти наверняка не иконка
const FETCH_TIMEOUT_MS = 6000;
// ⚠️ Это ПОТОЛОК РАЗБОРА, а не потолок загрузки. Раньше страница больше этого размера
// отбрасывалась целиком — и на этом ломался весь поиск крупной иконки: главная YouTube весит
// пару мегабайт, ответ выкидывался, кандидатов не находилось, и в кэш ложился тот самый
// 16-пиксельный /favicon.ico. Проверено на живом ответе: YouTube объявляет иконки до 144×144,
// то есть брать было что. Теперь страница читается целиком, а регулярками просматривается
// только начало — <link rel=icon> живёт в <head>, дальше первых сотен килобайт его не бывает.
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const HTML_SCAN_CHARS = 512 * 1024;

// Ниже этого размера иконку в интерфейсе уже растягивают, и она рассыпается в пиксельные
// лесенки: строка списка паролей рисует favicon в 16 CSS-px, а на мониторе со 125-150%
// масштабом это 20–24 физических пикселя из 16-пиксельного исходника.
const MIN_CRISP_PX = 48;

// Магия форматов картинок — content-type сервера бывает враньём (favicon.ico часто отдаётся как
// text/html 404-страницей), поэтому определяем тип по байтам. null — это не картинка.
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  // SVG/текстовый XML — иконка тоже валидная.
  const head = buf.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

// Сторона картинки в пикселях — по ней решаем, хватит ли иконки без растягивания.
// ICO и PNG разбираем по заголовку (это 99% фавиконок и никакой возни с декодерами), остальное
// отдаём nativeImage. Векторной иконке размер не нужен — она хороша при любом.
function imagePixelSize(buf: Buffer, mime: string): number {
  if (mime === 'image/svg+xml') return Number.POSITIVE_INFINITY;
  if (mime === 'image/x-icon') {
    // Каталог ICO: 6 байт заголовка, дальше записи по 16 байт, первый байт записи — ширина
    // (0 означает 256). В файле обычно несколько размеров — берём наибольший.
    const count = buf.readUInt16LE(4);
    let best = 0;
    for (let i = 0; i < count; i++) {
      const off = 6 + i * 16;
      if (off >= buf.length) break;
      best = Math.max(best, buf[off] === 0 ? 256 : buf[off]);
    }
    return best;
  }
  if (mime === 'image/png' && buf.length >= 24) return buf.readUInt32BE(16);
  try {
    const { width } = nativeImage.createFromBuffer(buf).getSize();
    return width;
  } catch {
    return 0;
  }
}

function sanitizeHostForFile(host: string): string {
  return host.replace(/[^a-z0-9.-]/gi, '_');
}

/** Кандидат в иконки из разметки страницы: чем крупнее заявлен, тем раньше пробуем. */
interface IconCandidate { href: string; score: number }

class FaviconService {
  #mem = new Map<string, string | null>();
  // ⚠️ Запросы В ПОЛЁТЕ. Кэш #mem заполняется ТОЛЬКО ПОСЛЕ ответа, поэтому без этой карты пять
  // одновременных вопросов про один домен давали пять походов в сеть — а спрашивают его правда
  // одновременно: список истории, сайдбар и поповер живут в РАЗНЫХ вью, и кэш обещаний renderer'а
  // (SiteFavicon.tsx) у каждой свой.
  #inflight = new Map<string, Promise<string | null>>();
  #sweptLegacy = false;

  // Прежний каталог кэша осиротел вместе со сменой правила отбора (см. CACHE_DIR). Сносим его —
  // это кэш и только кэш, любая иконка перекачивается сама; иначе мегабайт мелких png будет
  // лежать в профиле вечно. Лениво, при первом же запросе: в конструкторе это была бы работа
  // на старте приложения ради того, что никто ещё не попросил.
  #sweepLegacyCache(): void {
    if (this.#sweptLegacy) return;
    this.#sweptLegacy = true;
    for (const dir of LEGACY_CACHE_DIRS) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* и не надо */ }
    }
  }

  async get(host: string): Promise<string | null> {
    if (!host) return null;
    const key = host.toLowerCase();
    const cached = this.#mem.get(key);
    if (cached !== undefined) return cached;

    this.#sweepLegacyCache();
    const disk = this.#readDisk(key);
    if (disk !== undefined) { this.#mem.set(key, disk); return disk; }

    const flying = this.#inflight.get(key);
    if (flying) return flying;

    // ⚠️ В сеть — ЧЕРЕЗ ОЧЕРЕДЬ. Один незнакомый домен это до трёх запросов (/favicon.ico →
    // страница → apple-touch-icon), и все они идут сессией профиля, то есть через VPN, если он
    // включён. Открытая с холодным кэшем история давала залп в несколько десятков запросов
    // разом: они конкурировали за туннель друг с другом и с той страницей, которую человек
    // открывает прямо сейчас. Очередь ничего не отбрасывает — только растягивает.
    const job = FAVICON_NET.run(() => this.#fetchForHost(key))
      .then((url) => {
        this.#mem.set(key, url);
        if (url) this.#writeDisk(key, url);
        return url;
      })
      .catch(() => null)
      .finally(() => { this.#inflight.delete(key); });
    this.#inflight.set(key, job);
    return job;
  }

  // ── Сеть ──────────────────────────────────────────────────────────────────

  // ⚠️ Порядок «сначала /favicon.ico, а разметку страницы только если его нет» изменён:
  // /favicon.ico есть почти у всех и почти всегда он 16×16 — то есть прежний код надёжно
  // выбирал САМУЮ мелкую из имеющихся иконок, а интерфейс потом её растягивал. Теперь
  // /favicon.ico по-прежнему пробуется первым (один дешёвый запрос вместо разбора страницы),
  // но принимается, только если он крупный; мелкий держим про запас и идём за apple-touch-icon
  // и <link rel=icon sizes=...> — их сайты кладут именно для крупного показа.
  async #fetchForHost(host: string): Promise<string | null> {
    const fallback = await this.#tryImage(`https://${host}/favicon.ico`);
    if (fallback && fallback.px >= MIN_CRISP_PX) return fallback.dataUrl;

    // href может вести на CDN самого сайта — это его выбор, не выбранный нами трекер.
    for (const cand of await this.#findIconCandidates(`https://${host}/`)) {
      try {
        const abs = new URL(cand.href, `https://${host}/`).toString();
        const img = await this.#tryImage(abs);
        // Не «первая попавшаяся», а именно крупная: иначе разметка вернула бы тот же 16×16,
        // только другим путём.
        if (img && img.px >= MIN_CRISP_PX) return img.dataUrl;
      } catch { /* битый href — пропускаем */ }
    }
    return fallback?.dataUrl ?? null;
  }

  async #tryImage(url: string): Promise<{ dataUrl: string; px: number } | null> {
    const buf = await this.#fetchBytes(url, MAX_BYTES);
    if (!buf) return null;
    const mime = sniffImageMime(buf);
    if (!mime) return null;
    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, px: imagePixelSize(buf, mime) };
  }

  /** Иконки, объявленные самой страницей, — от самой перспективной к самой сомнительной. */
  async #findIconCandidates(pageUrl: string): Promise<IconCandidate[]> {
    const buf = await this.#fetchBytes(pageUrl, MAX_HTML_BYTES);
    if (!buf) return [];
    const html = buf.toString('utf8', 0, Math.min(buf.length, HTML_SCAN_CHARS));
    const out: IconCandidate[] = [];
    // Ищем <link ... rel="...icon..." ... href="..."> в любом порядке атрибутов.
    const linkRe = /<link\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null) {
      const tag = m[0];
      const rel = /\brel\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
      if (!/icon/i.test(rel)) continue;
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (!href) continue;

      // Вектор — вне конкуренции: он хорош при любом размере. Дальше — заявленный размер
      // (sizes="180x180"), а apple-touch-icon без размера всё равно крупная по определению:
      // её кладут для домашнего экрана телефона.
      const declared = Number(/\b(\d{2,4})x\d{2,4}/i.exec(/\bsizes\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '')?.[1] ?? 0);
      const score = /\.svg(\?|$)/i.test(href) ? 10_000
        : declared || (/apple-touch-icon/i.test(rel) ? 180 : 0);
      out.push({ href, score });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  async #fetchBytes(url: string, maxBytes: number): Promise<Buffer | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      // ⚠️ credentials:'omit' — запрос уходит БЕЗ кук. Это список сохранённых паролей: домены
      // здесь те, где человек залогинен, и по умолчанию fetchInProfile приложил бы к каждой иконке
      // его сессионные куки — то есть отметился бы на всех его сайтах при одном открытии
      // настроек. Пункт 4 бэклога безопасности паролей в CLAUDE.md.
      // ⚠️ Отдельную сессию заводить НЕЛЬЗЯ, хотя напрашивается: прокси VPN ставится только на
      // дефолтную и инкогнито-сессию (applyVpnProxy в main.ts), и своя сессия пошла бы мимо
      // тоннеля — вместо утечки кук получили бы утечку адреса, что хуже.
      const res = await fetchInProfile(url, { signal: controller.signal, redirect: 'follow', credentials: 'omit' });
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      if (ab.byteLength === 0 || ab.byteLength > maxBytes) return null;
      return Buffer.from(ab);
    } catch {
      return null; // таймаут/сеть/DNS — тихо, будет буква-заглушка
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Диск ──────────────────────────────────────────────────────────────────

  // undefined — файла нет (не путать с null «иконки нет», который на диск не пишется).
  #readDisk(host: string): string | undefined {
    try {
      return fs.readFileSync(path.join(CACHE_DIR, sanitizeHostForFile(host)), 'utf8');
    } catch {
      return undefined;
    }
  }

  #writeDisk(host: string, dataUrl: string): void {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(path.join(CACHE_DIR, sanitizeHostForFile(host)), dataUrl, 'utf8');
    } catch { /* нет доступа к диску — переживём, останется память */ }
  }
}

export const faviconService = new FaviconService();
