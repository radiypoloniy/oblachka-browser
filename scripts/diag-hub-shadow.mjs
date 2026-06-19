// Диагностика: computed styles стека Hub-карточки ввода.
// Карточку ищем по style.maxWidth === '680px' (уникально в нашей разметке).
// Выводим background, box-shadow, filter, backdrop-filter для каждого предка.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = resolve(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const CDP_PORT = 19241;
const wait = ms => new Promise(r => setTimeout(r, ms));

console.log('Запуск Electron…');
const child = spawn(electronBin, [`--remote-debugging-port=${CDP_PORT}`, ROOT], {
  env: { ...process.env, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', () => {});
await wait(5000);

const cdpGet = path => new Promise((ok, fail) => {
  http.get({ hostname: '127.0.0.1', port: CDP_PORT, path }, res => {
    let b = ''; res.on('data', c => b += c);
    res.on('end', () => { try { ok(JSON.parse(b)); } catch { ok(b); } });
  }).on('error', fail);
});

const targets = await cdpGet('/json/list');
const t = targets.find(x => x.url?.includes('index.html') || x.url?.includes('localhost'));
if (!t) { console.error('Таргет не найден'); child.kill(); process.exit(1); }

const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((ok, fail) => {
  ws.addEventListener('open', ok);
  ws.addEventListener('error', e => fail(e.error ?? e));
  setTimeout(() => fail(new Error('ws timeout')), 5000);
});

let _id = 0;
const send = (method, params = {}) => new Promise((ok, fail) => {
  const id = ++_id;
  const h = e => {
    const m = JSON.parse(e.data);
    if (m.id !== id) return;
    ws.removeEventListener('message', h);
    m.error ? fail(new Error(m.error.message)) : ok(m.result);
  };
  ws.addEventListener('message', h);
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(() => { ws.removeEventListener('message', h); fail(new Error(`timeout: ${method}`)); }, 8000);
});

const PROPS = [
  'background', 'backgroundColor', 'backgroundImage',
  'boxShadow', 'filter', 'backdropFilter', 'WebkitBackdropFilter',
  'borderRadius', 'overflow', 'position', 'zIndex', 'opacity',
  'outline', 'border', 'width', 'height', 'maxWidth',
];

const expr = `(() => {
  // Ищем Hub-карточку по инлайн-стилю maxWidth === '680px'
  const card = [...document.querySelectorAll('div')].find(el => el.style.maxWidth === '680px');
  if (!card) return JSON.stringify({ error: 'hub card not found — Hub может не рендериться (active tab не Hub?)' });

  function getStyles(el, label) {
    const cs = getComputedStyle(el);
    const r = {
      label,
      tag: el.tagName,
      className: el.className || '',
      inlineStyle: el.getAttribute('style') || '',
    };
    ${PROPS.map(p => `r[${JSON.stringify(p)}] = cs[${JSON.stringify(p)}];`).join('\n    ')}
    // pseudo
    const bf = getComputedStyle(el, '::before');
    const af = getComputedStyle(el, '::after');
    r['::before.content']    = bf.content;
    r['::before.background'] = bf.background;
    r['::before.boxShadow']  = bf.boxShadow;
    r['::after.content']     = af.content;
    r['::after.background']  = af.background;
    r['::after.boxShadow']   = af.boxShadow;
    return r;
  }

  // Стек: от card вверх до body (включительно), не больше 12 уровней
  const stack = [];
  let el = card;
  for (let i = 0; i < 12 && el && el.tagName !== 'HTML'; i++) {
    stack.push(getStyles(el, 'depth-' + i + (i === 0 ? ' (CARD)' : i === 1 ? ' (parent)' : '')));
    el = el.parentElement;
  }
  return JSON.stringify(stack, null, 2);
})()`;

const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
ws.close(); child.kill();

let stack;
try { stack = JSON.parse(res.result?.value); } catch { console.log('RAW:', res.result?.value); process.exit(1); }

if (stack.error) { console.error('ОШИБКА:', stack.error); process.exit(1); }

const SKIP_VALUES = new Set(['none', '', '0px', 'auto', 'normal', 'visible', 'static',
  'rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0) none repeat scroll 0% 0% / auto padding-box border-box',
  '""', 'initial', 'rgb(70, 68, 63) none 0px', '0px none rgb(70, 68, 63)']);

console.log('\n══ Hub карточка и её стек предков ══\n');
for (const node of stack) {
  console.log(`▸ ${node.label}  <${node.tag}${node.className ? '.' + node.className.split(' ').filter(Boolean).join('.') : ''}>`);
  if (node.inlineStyle) console.log(`   [inline style]: ${node.inlineStyle.slice(0, 200)}`);
  for (const [k, v] of Object.entries(node)) {
    if (['label','tag','className','inlineStyle'].includes(k)) continue;
    const s = String(v).trim();
    if (!SKIP_VALUES.has(s) && s !== '') {
      if (k.startsWith('::') && (s === 'none' || s === '""' || s === 'rgba(0, 0, 0, 0) none repeat scroll 0% 0% / auto padding-box border-box')) continue;
      console.log(`   ${k.padEnd(28)} ${s}`);
    }
  }
  console.log('');
}
