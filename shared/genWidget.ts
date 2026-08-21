// Свои виджеты стола: одностраничник модели живёт ВНУТРИ рамки, не в хроме.
//
// ⚠️ HTML ответа нельзя монтировать в DesktopScreen: там window.oblako и вся сессия.
// Сюда попадает только то, что пережило sanitizeGenHtml, и только в iframe без allow-same-origin.
// Значимых импортов нет — проверка scripts/gen-widget-check.mjs гоняет модуль голым node.

export const GEN_WIDGET_KIND = 'gen';
export const GEN_MAX_CHARS = 20_000;
export const GEN_STORAGE_MAX_CHARS = 4_000;

/** Факты, которые хост умеет отдать. Модель выбирает имя из списка, не считает сама. */
export const GEN_FACTS = [
  { id: 'openTabs', label: 'How many tabs are open now' },
  { id: 'sessionBlocks', label: 'Trackers blocked this session' },
  { id: 'taskCount', label: 'Unchecked items in the desktop task list' },
] as const;

export type GenFactId = (typeof GEN_FACTS)[number]['id'];

export const GEN_FACT_IDS: readonly GenFactId[] = GEN_FACTS.map((f) => f.id);

export const GEN_TOKEN_VARS = [
  '--accent', '--on-accent', '--accent-soft',
  '--surface', '--app-bg', '--divider', '--card',
  '--text-body', '--text-strong', '--text-faint',
  '--font-sans', '--font-display', '--font-mono',
  '--radius-box', '--radius-control', '--radius-pill',
  '--fs-xs', '--fs-sm', '--fs-md', '--fs-lg',
  '--gen-num',
] as const;

const FORBIDDEN_TAGS = 'iframe|object|embed|link|meta|base|form|input|textarea|select|frame|frameset|applet|html|head|body|noscript|template|video|audio|source|track';

export function isGenFactId(id: string): id is GenFactId {
  return (GEN_FACT_IDS as readonly string[]).includes(id);
}

export function pickGenFacts(ids: unknown): GenFactId[] {
  if (!Array.isArray(ids)) return [];
  const out: GenFactId[] = [];
  for (const x of ids) {
    if (typeof x !== 'string' || !isGenFactId(x) || out.includes(x)) continue;
    out.push(x);
  }
  return out;
}

function stripAttrValue(attr: string, value: string): string | null {
  const v = value.trim();
  const name = attr.toLowerCase();
  if (name.startsWith('on')) {
    // В песочнице без allow-same-origin обработчик не достаёт до window.oblako родителя,
    // а сеть режет CSP. Резать onclick — значит ломать кнопки, которые 4B пишет чаще addEventListener.
    return value;
  }
  if (name === 'srcdoc' || name === 'srcset' || name === 'action' || name === 'formaction') return null;
  if (name === 'href' || name === 'xlink:href' || name === 'poster') {
    if (!v || /^(https?:|\/\/|javascript:|data:text\/html|vbscript:)/i.test(v)) return null;
    return v;
  }
  if (name === 'src') {
    if (/^(data:image\/|blob:)/i.test(v)) return v;
    return null;
  }
  if (name === 'style') {
    if (/url\s*\(|expression\s*\(|javascript:|@import/i.test(v)) return null;
    if (/position\s*:\s*fixed/i.test(v)) return v.replace(/position\s*:\s*fixed/gi, 'position:relative');
    return v;
  }
  return value;
}

function sanitizeTag(open: string): string {
  const m = /^<\/?([a-zA-Z][\w:-]*)\b([\s\S]*)>$/.exec(open);
  if (!m) return '';
  const name = m[1]!;
  const rest = m[2] ?? '';
  const closing = open.startsWith('</');
  if (new RegExp(`^(?:${FORBIDDEN_TAGS})$`, 'i').test(name)) return '';
  if (closing) return `</${name.toLowerCase()}>`;
  if (/^script$/i.test(name) && /\bsrc\s*=/i.test(rest)) return '';
  const attrs: string[] = [];
  const attrRe = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let a: RegExpExecArray | null;
  while ((a = attrRe.exec(rest))) {
    const key = a[1]!;
    const val = a[2] ?? a[3] ?? a[4] ?? '';
    const kept = stripAttrValue(key, val);
    if (kept === null) continue;
    attrs.push(`${key.toLowerCase()}="${kept.replace(/"/g, '&quot;')}"`);
  }
  const self = /\/\s*$/.test(rest) ? ' /' : '';
  return `<${name.toLowerCase()}${attrs.length ? ' ' + attrs.join(' ') : ''}${self}>`;
}

/** Вырезает сеть, чужие скрипты и обработчики. Разметку и inline-script оставляет. */
export function sanitizeGenHtml(raw: string): string {
  if (typeof raw !== 'string') return '';
  let s = raw.slice(0, GEN_MAX_CHARS);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(new RegExp(`<(${FORBIDDEN_TAGS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), '');
  s = s.replace(new RegExp(`<(${FORBIDDEN_TAGS})\\b[^>]*/?>`, 'gi'), '');
  const scripts: string[] = [];
  s = s.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (_all, attrs: string, js: string) => {
    if (/\bsrc\s*=/i.test(attrs)) return '';
    const body = String(js).replace(/<\/script/gi, '<\\/script');
    scripts.push(`<script>${body}</script>`);
    return `\0SCRIPT${scripts.length - 1}\0`;
  });
  s = s.replace(/<script\b[^>]*\/>/gi, '');
  s = s.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_all, css: string) => {
    const clean = String(css)
      .replace(/@import[^;]+;?/gi, '')
      .replace(/url\s*\(\s*['"]?\s*(https?:|\/\/)/gi, 'url(')
      .replace(/expression\s*\(/gi, '(')
      .replace(/(html|body)\s*\{[^}]*\}/gi, (block) => block.replace(/background(?:-color)?\s*:[^;]+;?/gi, ''));
    return `<style>${clean}</style>`;
  });
  s = s.replace(/<[^>]+>/g, (tag) => sanitizeTag(tag));
  s = s.replace(/\0SCRIPT(\d+)\0/g, (_all, n: string) => scripts[Number(n)] ?? '');
  return s.trim();
}

export function extractGenHtml(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const marked = /HTML:\s*/i.exec(raw);
  const slice = marked ? raw.slice(marked.index + marked[0].length) : raw;
  const start = slice.search(/<(?:style|div|section|article|main|p|button|script|h[1-6])\b/i);
  if (start < 0) return null;
  const clean = sanitizeGenHtml(slice.slice(start));
  return clean.length >= 12 ? clean : null;
}

function cssVarsBlock(tokens: Record<string, string>): string {
  const lines = GEN_TOKEN_VARS
    .filter((k) => typeof tokens[k] === 'string' && tokens[k]!.length > 0)
    .map((k) => `${k}:${tokens[k]};`)
    .join('');
  return `:root{${lines}}`;
}

function bootstrapScript(widgetId: string): string {
  const id = JSON.stringify(widgetId);
  return `(function(){
var WIDGET_ID=${id};
var api={facts:{},assets:{},now:Date.now(),storage:{
  get:function(){return new Promise(function(res){
    var req=Math.random().toString(36).slice(2);
    function on(e){
      if(!e.data||e.data.type!=='oblako-gen-storage'||e.data.req!==req)return;
      window.removeEventListener('message',on);
      res(e.data.value);
    }
    window.addEventListener('message',on);
    parent.postMessage({type:'oblako-gen-storage-get',req:req,widgetId:WIDGET_ID},'*');
  });},
  set:function(value){
    parent.postMessage({type:'oblako-gen-storage-set',widgetId:WIDGET_ID,value:value},'*');
  }
},
pickPhoto:function(){
  parent.postMessage({type:'oblako-gen-pick-photo',widgetId:WIDGET_ID},'*');
}};
window.api=api;
window.addEventListener('message',function(e){
  if(!e.data||e.data.type!=='oblako-gen-facts')return;
  api.facts=e.data.facts||{};
  api.assets=e.data.assets||{};
  api.now=Date.now();
  window.dispatchEvent(new Event('oblako-facts'));
});
setInterval(function(){
  api.now=Date.now();
  window.dispatchEvent(new Event('oblako-tick'));
},250);
parent.postMessage({type:'oblako-gen-ready',widgetId:WIDGET_ID},'*');
})();`;
}

export const GEN_HOST_CSS = [
  '*,*:before,*:after{box-sizing:border-box}',
  'html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;',
  'background:transparent!important;color:var(--text-strong);font-family:var(--font-sans),system-ui,sans-serif;',
  'display:flex;flex-direction:column}',
  'body{padding:16px;gap:10px;justify-content:space-between}',
  '[data-caption],h1,.caption{margin:0;flex:none;font-family:var(--font-mono),ui-monospace,monospace!important;',
  'font-size:11px!important;font-weight:500!important;letter-spacing:.12em!important;',
  'text-transform:uppercase;opacity:.62;color:inherit}',
  '[data-display],.time,.num,.value{margin:0;font-family:var(--font-display),Unbounded,sans-serif!important;',
  'font-size:var(--gen-num,42px)!important;font-weight:600!important;letter-spacing:-.03em!important;',
  'line-height:1!important;font-variant-numeric:tabular-nums;color:var(--text-strong)!important;flex:1;',
  'display:flex;align-items:center}',
  'button{font-family:var(--font-sans),system-ui,sans-serif;font-size:13px;font-weight:600;border:none;cursor:default;',
  'background:var(--accent);color:var(--on-accent);border-radius:var(--radius-pill);padding:7px 14px}',
  'img{display:none!important}',
].join('');

/**
 * Собирает srcdoc: CSP + токены темы + мост api + тело после санитайзера.
 * sandbox на iframe ставит вызывающий: allow-scripts без allow-same-origin.
 */
export function wrapGenSrcdoc(
  body: string,
  tokens: Record<string, string>,
  widgetId: string,
  fontCss = '',
): string {
  const html = sanitizeGenHtml(body);
  const id = widgetId.replace(/[^\w-]/g, '').slice(0, 64) || 'gen';
  const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'";
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + `<style>${cssVarsBlock(tokens)}${fontCss}${GEN_HOST_CSS}</style>`
    + `<script>${bootstrapScript(id)}</script></head><body>${html}</body></html>`;
}

/** Фото рамки рисует хост на всю плитку — модель часто забывает ASSET: photo. */
export function wantsGenPhoto(phrase: string, html: string, flagged: boolean): boolean {
  if (flagged) return true;
  if (/фото|рамк|picture|photo|снимок|кадр|выберите фото|выбрать фото/i.test(phrase + ' ' + html)) return true;
  return /<img\b/i.test(html);
}

/** Готовый виджет — только если фраза про него, а не «погода и помодоро». */
export function phraseClearlyAsksBuiltin(phrase: string, widget: string): boolean {
  const p = phrase.trim().toLowerCase();
  if (p.length > 36) return false;
  const map: Record<string, RegExp> = {
    weather: /погод[аеуы]?|weather/,
    clock: /часы|часов|clock|время/,
    rates: /курс|dollar|доллар|цб/,
    crypto: /крипт|bitcoin|биткоин/,
    tasks: /дела|задач|todo/,
    shield: /защит|адблок|vpn/,
    moon: /луна|moon/,
    downloads: /загрузк/,
    holiday: /праздник/,
    tracking: /отслеж/,
    digest: /итог|чем занима/,
    topsites: /часто открыв|топ.?сайт/,
    music: /музык|spotify|яндекс.?музык/,
  };
  const re = map[widget];
  if (!re || !re.test(p)) return false;
  const leftover = p.replace(re, '').replace(/[\s.,!?«»-]/g, '');
  return leftover.length === 0;
}

export const GEN_SIZES = {
  small:  { w: 2, h: 2 },
  medium: { w: 4, h: 2 },
  large:  { w: 4, h: 4 },
} as const;
export type GenSizeName = keyof typeof GEN_SIZES;

export const GEN_BUILTIN_WIDGETS = [
  'weather', 'clock', 'rates', 'crypto', 'tasks', 'topsites', 'music',
  'shield', 'moon', 'downloads', 'holiday', 'tracking', 'digest',
] as const;

export function labelledLine(out: string, label: string): string {
  const m = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im').exec(out);
  return (m?.[1] ?? '').trim().replace(/^["'«»]|["'«»]$/g, '').trim();
}

export function parseGenMeta(out: string): {
  widget: string;
  facts: GenFactId[];
  size: { w: number; h: number };
  assetPhoto: boolean;
  title: string;
} {
  const widgetRaw = labelledLine(out, 'WIDGET').toLowerCase();
  const widget = widgetRaw === 'gen' || (GEN_BUILTIN_WIDGETS as readonly string[]).includes(widgetRaw)
    ? widgetRaw
    : 'none';
  const factRaw = labelledLine(out, 'FACTS');
  const facts = pickGenFacts(factRaw.split(/[,;\s]+/).filter(Boolean));
  const sizeRaw = labelledLine(out, 'SIZE').toLowerCase();
  const size = GEN_SIZES[sizeRaw as GenSizeName] ?? GEN_SIZES.small;
  const asset = labelledLine(out, 'ASSET').toLowerCase();
  let title = labelledLine(out, 'TITLE').slice(0, 28);
  if (title.length < 2) title = widget === 'gen' ? 'Свой виджет' : '';
  return { widget, facts, size, assetPhoto: asset === 'photo', title };
}

export function clampGenStorage(raw: unknown): string {
  if (typeof raw !== 'string') {
    try { return JSON.stringify(raw).slice(0, GEN_STORAGE_MAX_CHARS); } catch { return ''; }
  }
  return raw.slice(0, GEN_STORAGE_MAX_CHARS);
}
