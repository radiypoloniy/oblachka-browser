// Сторож владельцев оверлеев: вью, чей preload зовёт оконные IPC-каналы, обязана быть
// зарегистрирована в реестре окон.
//
// ⚠️ С e2b26ea оконные обработчики (tabsOf / winOf / chromeOf / contextFromSender) находят окно
// ТОЛЬКО по вью, записанной через registerWindowContents. Незарегистрированная вью получает null,
// и обработчик молча ничего не делает: ни ошибки, ни лога, а сама панель при этом рисуется, потому
// что её открывает main. Так за неделю сломались два оверлея: кнопки поповера паролей (0.9.1) и
// весь Ctrl+F (поле вводится, по странице не ищет). Глазами такое ловится только руками в окне.
//
// Правило: если preload-<имя>.ts вызывает хотя бы один канал, обработчик которого разрешает окно
// через реестр, каждый файл, создающий вью с этим preload, обязан вызывать registerWindowContents.
// Вью со своим поиском владельца (stateBySender, forSender) правило не задевает: их каналы
// реестр не спрашивают.
//
// Запуск: npm test -- overlay-owner
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = path.join(ROOT, 'electron');

let passed = 0;
let failed = 0;
function check(what, ok, detail = '') {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}${ok || !detail ? '' : `\n         ${detail}`}`);
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(ELECTRON).map((p) => ({ p, rel: path.relative(ROOT, p).replace(/\\/g, '/'), src: fs.readFileSync(p, 'utf8') }));

// 1. Каналы, чьи обработчики спрашивают реестр окон. Тело обработчика — грубо: от регистрации
//    до следующего ipcMain. в том же файле. Для ложного «да» хватило бы лишнего текста, для
//    ложного «нет» — обработчика длиннее соседа; оба случая в коде проекта не встречаются.
const ROUTED = /\b(tabsOf|winOf|chromeOf|contextFromSender)\s*\(/;
const routed = new Set();
for (const f of files) {
  const re = /ipcMain\.(?:handle|on|once)\(\s*(IPC\.[A-Z0-9_]+|'[^']+'|"[^"]+")/g;
  const hits = [...f.src.matchAll(re)];
  hits.forEach((m, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index : f.src.length;
    if (ROUTED.test(f.src.slice(m.index, end))) routed.add(m[1].replace(/["']/g, ''));
  });
}
check('нашлись оконные обработчики (иначе разбор сломан, а не код чист)', routed.size > 10, `найдено ${routed.size}`);

// 2. Для каждого preload оверлея — какие из его каналов оконные.
//    preload.ts (хром окна — регистрируется через registerWindow) и preload-content.ts (страницы
//    сайтов — права хрома получать не должны) правилу не подлежат.
const preloads = files.filter((f) => /\/preload-[a-z]+\.ts$/.test(f.rel) && !f.rel.endsWith('preload-content.ts'));
for (const pre of preloads) {
  const name = path.basename(pre.rel, '.ts');
  const used = [...pre.src.matchAll(/ipcRenderer\.(?:invoke|send|sendSync)\(\s*(IPC\.[A-Z0-9_]+|'[^']+'|"[^"]+")/g)]
    .map((m) => m[1].replace(/["']/g, ''));
  const needs = [...new Set(used.filter((c) => routed.has(c)))];
  if (needs.length === 0) continue;
  const creators = files.filter((f) => f.src.includes(`'${name}.js'`) || f.src.includes(`"${name}.js"`));
  check(`${name}: вью создаётся хотя бы где-то`, creators.length > 0);
  for (const c of creators) {
    check(
      `${name} (${c.rel}): владелец зарегистрирован — нужен для ${needs.join(', ')}`,
      /registerWindowContents\s*\(/.test(c.src),
      `добавь registerWindowContents(win, view.webContents) сразу после создания вью`,
    );
  }
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло`);
process.exit(failed ? 1 : 0);
