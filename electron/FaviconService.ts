import { app, net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Favicon для адресов (список паролей и т.п.). Тянем ТОЛЬКО с самого сайта (через net.fetch —
// это Chromium-сеть, уважает VPN/прокси/адблок), без сторонних favicon-сервисов — приватный
// браузер не должен светить домены аккаунтов третьей стороне. Двухуровневый кэш: память на сессию
// + файлы в userData (иконки маленькие, но повторно дёргать сеть при каждом открытии настроек не
// нужно). Негативы (иконки нет) кэшируются только в памяти — вдруг сайт добавит favicon позже.

const CACHE_DIR = path.join(app.getPath('userData'), 'favicon-cache');
const MAX_BYTES = 256 * 1024;       // иконка больше четверти мегабайта — почти наверняка не иконка
const FETCH_TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 512 * 1024;  // парсим только начало страницы ради <link rel=icon>

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

function sanitizeHostForFile(host: string): string {
  return host.replace(/[^a-z0-9.-]/gi, '_');
}

class FaviconService {
  #mem = new Map<string, string | null>();

  async get(host: string): Promise<string | null> {
    if (!host) return null;
    const key = host.toLowerCase();
    const cached = this.#mem.get(key);
    if (cached !== undefined) return cached;

    const disk = this.#readDisk(key);
    if (disk !== undefined) { this.#mem.set(key, disk); return disk; }

    const url = await this.#fetchForHost(key);
    this.#mem.set(key, url);
    if (url) this.#writeDisk(key, url);
    return url;
  }

  // ── Сеть ──────────────────────────────────────────────────────────────────

  async #fetchForHost(host: string): Promise<string | null> {
    // 1) стандартный /favicon.ico на самом домене.
    const direct = await this.#tryImage(`https://${host}/favicon.ico`);
    if (direct) return direct;
    // 2) фолбэк — распарсить <link rel="icon"> с главной страницы того же сайта (href может вести
    //    на CDN самого сайта — это его выбор, не выбранный нами трекер).
    const href = await this.#findIconHref(`https://${host}/`);
    if (href) {
      try {
        const abs = new URL(href, `https://${host}/`).toString();
        const img = await this.#tryImage(abs);
        if (img) return img;
      } catch { /* битый href — пропускаем */ }
    }
    return null;
  }

  async #tryImage(url: string): Promise<string | null> {
    const buf = await this.#fetchBytes(url, MAX_BYTES);
    if (!buf) return null;
    const mime = sniffImageMime(buf);
    if (!mime) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  async #findIconHref(pageUrl: string): Promise<string | null> {
    const buf = await this.#fetchBytes(pageUrl, MAX_HTML_BYTES);
    if (!buf) return null;
    const html = buf.toString('utf8');
    // Ищем <link ... rel="...icon..." ... href="..."> в любом порядке атрибутов.
    const linkRe = /<link\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null) {
      const tag = m[0];
      if (!/\brel\s*=\s*["'][^"']*icon[^"']*["']/i.test(tag)) continue;
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
      if (href?.[1]) return href[1];
    }
    return null;
  }

  async #fetchBytes(url: string, maxBytes: number): Promise<Buffer | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await net.fetch(url, { signal: controller.signal, redirect: 'follow' });
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
