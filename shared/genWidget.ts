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

// ⚠️ Три РАЗНЫЕ судьбы, а не один чёрный список. Раньше html|head|body лежали рядом с iframe
// и вырезались ВМЕСТЕ С СОДЕРЖИМЫМ, а 4B регулярно отвечает ПОЛНЫМ документом — от
// такого ответа оставался один <style>. Плитка выходила пустой, причём «успешной»:
// длина строки проходила порог. Обёртку документа теперь СНИМАЕМ, а не выбрасываем.
const DROP_WITH_CONTENT = 'iframe|object|embed|form|input|textarea|select|frame|frameset|applet|noscript|template|video|audio|source|track|title';
const DROP_TAG_ONLY = 'link|meta|base';
const UNWRAP_TAGS = 'html|head|body';
const FORBIDDEN_TAGS = `${DROP_WITH_CONTENT}|${DROP_TAG_ONLY}|${UNWRAP_TAGS}`;

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
  // ⚠️ Значение НЕОБЯЗАТЕЛЬНО. Прежняя форма требовала `=`, и `<div data-display>` — ровно то,
  // что промпт просит у модели, а GEN_HOST_CSS оформляет как героя плитки, — теряло атрибут и
  // становилось безымянным div'ом. Крупного числа на плитке не появлялось никогда.
  const attrRe = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let a: RegExpExecArray | null;
  while ((a = attrRe.exec(rest))) {
    const key = a[1]!;
    const bare = a[2] === undefined && a[3] === undefined && a[4] === undefined;
    const val = a[2] ?? a[3] ?? a[4] ?? '';
    const kept = stripAttrValue(key, val);
    if (kept === null) continue;
    attrs.push(bare ? key.toLowerCase() : `${key.toLowerCase()}="${kept.replace(/"/g, '&quot;')}"`);
  }
  const self = /\/\s*$/.test(rest) ? ' /' : '';
  return `<${name.toLowerCase()}${attrs.length ? ' ' + attrs.join(' ') : ''}${self}>`;
}

/** Вырезает сеть, чужие скрипты и обработчики. Разметку и inline-script оставляет. */
export function sanitizeGenHtml(raw: string): string {
  if (typeof raw !== 'string') return '';
  let s = raw.slice(0, GEN_MAX_CHARS);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(new RegExp(`<(${DROP_WITH_CONTENT})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), '');
  s = s.replace(new RegExp(`<(${DROP_WITH_CONTENT}|${DROP_TAG_ONLY})\\b[^>]*/?>`, 'gi'), '');
  // Обёртка полного документа: тег снят, содержимое живёт дальше.
  s = s.replace(new RegExp(`</?(?:${UNWRAP_TAGS})\\b[^>]*>`, 'gi'), '');
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
  const unwrapped = stripGenModelWrapper(marked ? raw.slice(marked.index + marked[0].length) : raw);
  const start = unwrapped.search(/<(?:html|body|style|div|section|article|main|p|button|script|h[1-6])\b/i);
  if (start < 0) return null;
  const clean = sanitizeGenHtml(unwrapped.slice(start));
  const folded = foldGenLexicon(clean);
  const out = folded.replace(/```[\w]*\s*/g, '').replace(/```+/g, '').trim();
  // ⚠️ Длины мало: от ответа полным документом раньше оставался один <style>, порог он проходил,
  // и человек получал «собрал» с пустым квадратом. Пустой результат — это ПРОВАЛ разбора.
  if (out.length < 12 || genHtmlIsBlank(out)) return null;
  return out;
}

/**
 * Виджет пустой по существу: ни элемента, ни текста, ни скрипта — только оформление.
 * ⚠️ Наличие скрипта сразу означает «не пусто»: наш бегунок словаря рисует себя сам.
 */
export function genHtmlIsBlank(html: string): boolean {
  if (/<script\b/i.test(html)) return false;
  const body = html.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  if (/<(?:div|section|article|main|p|span|button|h[1-6]|ul|ol|li|svg|canvas|table|img)\b/i.test(body)) return false;
  return body.replace(/<[^>]*>/g, '').trim().length === 0;
}

/** 4B оборачивает HTML в markdown-забор и дописывает хвост после последнего тега. */
export function stripGenModelWrapper(raw: string): string {
  const s = raw.replace(/\r\n/g, '\n');
  const closed = /```(?:html|HTML|xml)?[ \t]*\n([\s\S]*?)```/i.exec(s);
  if (closed) {
    const inner = closed[1] ?? '';
    const after = s.slice(closed.index + closed[0].length);
    if (parseLexiconPairs(after).length >= 4) return `${inner}\n${after}`;
    return inner;
  }
  return s.replace(/```(?:html|HTML|xml)?[ \t]*\n?/gi, '').replace(/```+/g, '');
}

export function parseLexiconPairs(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const seen = new Set<string>();
  const plain = text.replace(/<[^>]+>/g, '\n');
  for (const line of plain.split(/\n+/)) {
    const t = line.replace(/^[\s*`#•\-]+/, '').replace(/[`*]+$/g, '').trim();
    if (!t || /^html:/i.test(t)) continue;
    let m = /^([A-Za-z][A-Za-z' -]{1,32})\s*[-–—:|]\s*([А-Яа-яЁё][А-Яа-яЁё ]{1,40})$/.exec(t);
    if (!m) m = /^([А-Яа-яЁё][А-Яа-яЁё ]{1,40})\s*[-–—:|]\s*([A-Za-z][A-Za-z' -]{1,32})$/.exec(t);
    if (!m) m = /^([A-Za-z][A-Za-z']{2,24})\s+([А-Яа-яЁё]{2,24})$/.exec(t);
    if (!m) m = /^[«"“](.{8,180}?)[»"”]\s*[-–—,]\s*(.{2,40})$/.exec(t);
    if (!m) continue;
    const en = m[1]!.trim();
    const ru = m[2]!.trim();
    const k = en.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([en, ru]);
  }
  return out;
}

function lastCloseTagEnd(html: string): number {
  let end = -1;
  const re = /<\/[a-zA-Z][\w:-]*>|<[^>/][^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) end = m.index + m[0].length;
  return end;
}

function stripCaptionEcho(body: string, tail: string): string {
  let t = tail.replace(/```[\s\S]*$/, '').replace(/```+/g, '').trim();
  const cap = /data-caption[^>]*>([^<]*)/i.exec(body)?.[1]?.trim();
  if (cap && cap.length >= 2 && t === cap) return '';
  if (t.length <= 40 && !parseLexiconPairs(t).length) return '';
  return tail;
}

/** Метка внутри тела скрипта: атрибуты у <script> санитайзер не сохраняет, комментарий — да. */
export const GEN_LEXICON_MARK = '/*oblako-lexicon*/';

/** Это наш собственный бегунок словаря, а не совпадение пар в чужом массиве. */
export function isGenLexiconRunner(html: string): boolean {
  return html.includes(GEN_LEXICON_MARK);
}

function lexiconRunner(pairs: Array<[string, string]>): string {
  const data = JSON.stringify(pairs).replace(/</g, '\\u003c');
  return `<script>${GEN_LEXICON_MARK}(function(){var W=${data};function show(){var p=W[Math.floor(Math.random()*W.length)];var a=document.querySelector("[data-display]");if(!a){a=document.createElement("div");a.setAttribute("data-display","");document.body.insertBefore(a,document.body.firstChild);}a.textContent=p[0];var b=document.querySelector("[data-meaning]");if(!b){b=document.createElement("div");b.setAttribute("data-meaning","");a.after(b);}b.textContent=p[1];}show();document.body.addEventListener("click",show);})();</script>`;
}

/**
 * Словарь после тегов / в списке 4B печатает текстом — без этого плитка пустая.
 *
 * ⚠️ Сворачиваем ТОЛЬКО список, напечатанный ТЕКСТОМ ВМЕСТО виджета. Пары внутри <script> —
 * это уже рабочий виджет: палитра цветов, грани кубика, цитаты с авторами, список привычек.
 * Раньше хватало четырёх пар ГДЕ УГОДНО, и «кубик» с массивом [["red","красный"],…] молча
 * превращался в карточку «слово → значение» — то есть выбрасывалось ровно то, что просили.
 */
export function foldGenLexicon(html: string): string {
  const pairs = /<script\b/i.test(html) ? [] : parseLexiconPairs(html);
  if (pairs.length < 4) {
    const end = lastCloseTagEnd(html);
    if (end < 0) return html;
    const tail = html.slice(end);
    return html.slice(0, end) + stripCaptionEcho(html.slice(0, end), tail);
  }
  return lexiconRunner(pairs);
}

/** Пары из скрипта/текста — хост рисует слово и цитату как часы, не вёрстку 4B. */
export function extractGenLexicon(html: string): Array<[string, string]> {
  const fromJson: Array<[string, string]> = [];
  const seen = new Set<string>();
  const re = /\["((?:[^"\\]|\\.){1,120})","((?:[^"\\]|\\.){0,120})"\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let a = m[1]!;
    let b = m[2]!;
    try { a = JSON.parse(`"${a}"`) as string; b = JSON.parse(`"${b}"`) as string; } catch { /* сырой */ }
    const k = a.toLowerCase();
    if (seen.has(k) || a.length < 2) continue;
    seen.add(k);
    fromJson.push([a, b]);
  }
  if (fromJson.length >= 4) return fromJson;
  return parseLexiconPairs(html);
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
},
timer:{
  start:function(seconds){
    parent.postMessage({type:'oblako-gen-timer-start',widgetId:WIDGET_ID,seconds:Number(seconds)||0},'*');
  },
  stop:function(){
    parent.postMessage({type:'oblako-gen-timer-stop',widgetId:WIDGET_ID},'*');
  }
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
  'body{padding:16px;gap:8px}',
  '[data-caption]{margin:0;flex:none;font-family:var(--font-mono),ui-monospace,monospace;',
  'font-size:11px;font-weight:500;letter-spacing:.12em;',
  'text-transform:uppercase;opacity:.62;color:inherit}',
  '[data-display]{margin:0;font-family:var(--font-display),Unbounded,sans-serif;',
  'font-size:var(--gen-num,42px);font-weight:600;letter-spacing:-.03em;',
  'line-height:1.1;font-variant-numeric:tabular-nums;color:var(--text-strong);flex:1;',
  'display:flex;align-items:center}',
  '[data-display]:empty{display:none;flex:none}',
  '[data-meaning]{margin:0;font-size:var(--fs-md);color:var(--text-faint);flex:none}',
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

/**
 * Фото рамки рисует хост на всю плитку — модель часто забывает ASSET: photo.
 *
 * ⚠️ Слово ищем во ФРАЗЕ, а не во фразе вместе с HTML: класс `.photo-card` в сгенерированной
 * вёрстке — не заказ фоторамки. И <img> считаем признаком только у СТАТИЧНОГО ответа: если
 * модель написала скрипт, картинка там украшение, а хост подменил бы весь виджет рамкой.
 */
export function wantsGenPhoto(phrase: string, html: string, flagged: boolean): boolean {
  if (flagged) return true;
  if (/фото|рамк|picture|photo|снимок|кадр/i.test(phrase)) return true;
  return /<img\b/i.test(html) && !/<script\b/i.test(html);
}

/**
 * Таймер целиком ЗАМЕНЯЕТ виджет — значит и просить должны именно таймер.
 * ⚠️ wantsGenTimer ловит слово где угодно во фразе, и «трекер привычек с таймером» превращался
 * в голый таймер. Здесь остаток фразы после вычёркивания таймерных слов обязан быть пустым.
 */
export function timerIsWholeWidget(phrase: string): boolean {
  if (!wantsGenTimer(phrase)) return false;
  const left = phrase.trim().toLowerCase()
    .replace(/хочу|виджет|сделай|пожалуйста|\bмне\b|собери(?:те)?|нужен|нужны|на стол|простой|обычный/gi, ' ')
    .replace(/помодор\S*|pomodoro|таймер\S*|timer|секундомер\S*/gi, ' ')
    .replace(/\d+\s*(?:минут\S*|мин|час\S*|hours?|minutes?|сек\S*)/gi, ' ')
    .replace(/[\s.,!?«»"'()-]+/g, '');
  return left.length <= 4;
}

/** Кто рисует плитку. Решается ОДИН раз при сборке и ложится в запись, а не переугадывается. */
export type GenMode = 'html' | 'photo' | 'timer' | 'lexicon';

export function isGenMode(v: unknown): v is GenMode {
  return v === 'html' || v === 'photo' || v === 'timer' || v === 'lexicon';
}

/**
 * ⚠️ Порядок важен: фоторамка сильнее таймера, таймер сильнее словаря. Три хост-рендерера
 * ВЫБРАСЫВАЮТ сгенерированную разметку целиком, поэтому каждый включается только по своему
 * узкому признаку, а во всех остальных случаях работает то, что собрала модель.
 */
export function pickGenMode(phrase: string, html: string, assetPhoto: boolean): GenMode {
  if (wantsGenPhoto(phrase, html, assetPhoto)) return 'photo';
  if (timerIsWholeWidget(phrase)) return 'timer';
  if (isGenLexiconRunner(html)) return 'lexicon';
  return 'html';
}

/** Готовый виджет — только если фраза про него, а не «погода и помодоро». */
export function phraseClearlyAsksBuiltin(phrase: string, widget: string): boolean {
  const p = phrase.trim().toLowerCase()
    .replace(/хочу|виджет|сделай|пожалуйста|\bмне\b|собери(?:те)?|нужен|нужны|на стол/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

export interface GenClock {
  /** 0 — пауза. Иначе unix-ms, когда должен закончиться. */
  endAt: number;
  durationMs: number;
  leftMs: number;
  beeped: boolean;
}

export function wantsGenTimer(phrase: string): boolean {
  return /помодор|pomodoro|(?:^|\s)таймер|(?:^|\s)timer\b|секундомер/i.test(phrase);
}

export function parseGenDurationMs(phrase: string): number {
  // \b в JS — только ASCII: после «минут» границы нет, и число молча игнорировалось.
  const hours = /(\d+)\s*(?:час(?:а|ов)?|hours?)/i.exec(phrase);
  if (hours) return Math.min(24, Number(hours[1])) * 3_600_000;
  const mins = /(\d+)\s*(?:минут|мин|minutes?)/i.exec(phrase);
  if (mins) return Math.min(180, Number(mins[1])) * 60_000;
  if (/помодор|pomodoro/i.test(phrase)) return 25 * 60_000;
  return 5 * 60_000;
}

export function genClockLeftMs(clock: GenClock, now = Date.now()): number {
  if (clock.endAt > 0) return Math.max(0, clock.endAt - now);
  return Math.max(0, clock.leftMs);
}

export function formatGenClock(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Разбор того, что одностраничник положил в api.storage — endAt, не декремент. */
export function parseGenClockWrite(raw: string, now: number): GenClock | 'stop' | null {
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return null; }
  if (typeof o !== 'object' || o === null) return null;
  const rec = o as Record<string, unknown>;
  if (rec.running === false || rec.stop === true) return 'stop';
  const durationMs = typeof rec.durationMs === 'number' && rec.durationMs > 0
    ? rec.durationMs
    : typeof rec.duration === 'number' && rec.duration > 0 && rec.duration < 86_400
      ? rec.duration * 1000
      : 25 * 60_000;
  if (typeof rec.endAt === 'number' && rec.endAt > now - 86_400_000) {
    return {
      endAt: rec.endAt,
      durationMs,
      leftMs: Math.max(0, rec.endAt - now),
      beeped: rec.endAt <= now,
    };
  }
  const started = rec.running === true || rec.start === true;
  const sec = typeof rec.remaining === 'number' ? rec.remaining
    : typeof rec.seconds === 'number' ? rec.seconds : null;
  if (started && sec !== null && sec >= 0 && sec <= 86_400) {
    const endAt = now + sec * 1000;
    return { endAt, durationMs: Math.max(durationMs, sec * 1000), leftMs: sec * 1000, beeped: false };
  }
  return null;
}
