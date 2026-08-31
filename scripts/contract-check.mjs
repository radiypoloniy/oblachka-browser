// Сторож ПРОВОДКИ IPC-контракта: 364 канала в shared/ipc.ts, 301 обработчик в main.
//
// Зачем отдельная проверка, если есть tsc. Шов preload↔renderer типизирован (`const api: OblakoApi`
// в preload + `window.oblako: OblakoApi` в global.d.ts) — расхождение там ловит компилятор. А вот
// сама ПРОВОДКА типами не выражена вообще: `ipcRenderer.invoke(IPC.X)` без парного
// `ipcMain.handle(IPC.X)` собирается зелёным и падает в рантайме («No handler registered for X»),
// причём только когда человек нажмёт нужную кнопку. Ровно эта дыра здесь и закрывается.
//
// Разбор идёт настоящим AST (typescript уже в devDependencies), а не регулярками: `IPC.FOO` внутри
// строки, комментария или чужого идентификатора регуляркой неотличим от вызова, и сторож,
// который врёт, хуже отсутствующего.
//
// Профиль пользователя проверка НЕ трогает: это статический разбор исходников, приложение не
// поднимается. Гонять безопасно при запущенном браузере.
//
// Запуск: npm test -- contract
//         node scripts/contract-check.mjs --update   — переписать golden-инвентарь каналов
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GOLDEN = path.join(HERE, 'fixtures', 'ipc-channels.json');
const UPDATE = process.argv.includes('--update');

// В машинном режиме (--json, см. хвост файла) на stdout уходит ТОЛЬКО json: обычный вывод сторожа
// смешался бы с ним и не разобрался бы. Глушим одной строкой, а не переписываем полсотни вызовов.
const JSON_OUT = process.argv.includes('--json');
if (JSON_OUT) console.log = () => {};

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

// Список расхождений печатаем целиком: сторож обязан говорить, ЧТО именно чинить, иначе им
// начинают пользоваться как светофором «красный — перезапусти».
function checkEmpty(what, list, hint) {
  const ok = list.length === 0;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}${ok ? '' : ` — ${list.length}`}`);
  if (!ok) {
    for (const line of list) console.log(`         ${line}`);
    if (hint) console.log(`         → ${hint}`);
  }
}

// ── Инвентарь каналов из shared/ipc.ts ──────────────────────────────────────
function parse(file) {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

// Список каналов живёт в shared/ipc/channels.ts (см. shared/ipc/index.ts — почему нарезано так).
const CHANNELS_FILE = path.join('shared', 'ipc', 'channels.ts');

function readChannels() {
  const sf = parse(path.join(ROOT, CHANNELS_FILE));
  const out = new Map(); // KEY -> 'строковое:значение'
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(sf) === 'IPC' && node.initializer) {
      // `export const IPC = { ... } as const` — снимаем `as const`, если он есть.
      let init = node.initializer;
      if (ts.isAsExpression(init) || ts.isTypeAssertionExpression?.(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) {
        for (const p of init.properties) {
          if (ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer)) {
            out.set(p.name.getText(sf), p.initializer.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const channels = readChannels();
const byValue = new Map();
for (const [k, v] of channels) {
  if (!byValue.has(v)) byValue.set(v, []);
  byValue.get(v).push(k);
}

// ── Кто и как трогает каждый канал ──────────────────────────────────────────
function walkFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'dist-electron') continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walkFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const files = ['electron', 'src', 'shared'].flatMap((d) => walkFiles(path.join(ROOT, d)));

// ⚠️ Файлы, которые ФИЗИЧЕСКИ не могут импортировать контракт, и потому дублируют строки каналов
// руками. sandboxed preload (webPreferences.sandbox: true — обязателен для гостевых страниц)
// не умеет require() относительных модулей, только 'electron' и встроенные Node: попытка даёт
// 'preload-error: module not found: ../shared/ipc' и роняет ВСЕ хуки на странице. Проверено
// эмпирически, см. шапку preload-content.ts. Для них правило переворачивается: строки зашивать
// можно, но каждая обязана совпадать с объявленным каналом (см. правило ниже).
const SANDBOXED_PRELOADS = new Set(['electron/preload-content.ts']);

// роль → множество каналов; плюс места объявления обработчиков (для поиска дублей)
const roles = new Map(); // KEY -> Set<'handler'|'caller'|'listener'|'sender'|'other'>
const handlerSites = new Map(); // KEY -> [{ kind: 'handle'|'on', where }]
const mainSideRef = new Set(); // канал упомянут где-то в electron/ вне preload
const literalSites = []; // строка канала, зашитая мимо IPC.*
// Арность: сколько аргументов реально уходит из preload и сколько принимает обработчик.
// ⚠️ Сравнивать здесь ТИПЫ нельзя, и это проверено разбором: preload сплошь и рядом законно
// перепаковывает аргументы (три параметра API уезжают в invoke одним объектом), а main местами
// намеренно объявляет `unknown` — данные из renderer недоверенные. Синтаксический сторож на
// типах начал бы врать на шести живых местах из 285; типовое соответствие — работа tsc, и делать
// её надо типизированной обёрткой над handle, а не разбором текста.
const callerArity = new Map();  // KEY -> максимум переданных аргументов (без канала)
const handlerArity = new Map(); // KEY -> { n, where }
for (const k of channels.keys()) roles.set(k, new Set());

const keyOfValue = new Map([...channels].map(([k, v]) => [v, k]));

function addRole(key, role, where, kind) {
  if (!roles.has(key)) return;
  roles.get(key).add(role);
  if (role === 'handler') {
    if (!handlerSites.has(key)) handlerSites.set(key, []);
    handlerSites.get(key).push({ kind, where });
  }
}

// Канал в аргументе может быть записан как `IPC.FOO` или голой строкой 'foo:bar' —
// второе встречается в вспомогательных функциях, и пропускать его нельзя.
function channelOfArg(arg, sf) {
  if (ts.isPropertyAccessExpression(arg) && arg.expression.getText(sf) === 'IPC') return arg.name.text;
  if (ts.isStringLiteral(arg) && keyOfValue.has(arg.text)) return keyOfValue.get(arg.text);
  return null;
}

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('IPC.') && ![...byValue.keys()].some((v) => src.includes(`'${v}'`))) continue;

  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const isPreload = path.basename(file).includes('preload');
  const isMainSide = rel.startsWith('electron/') && !isPreload;
  const sf = parse(file);

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const args = node.arguments;
      let idx = -1;
      let key = null;
      for (let i = 0; i < args.length; i++) {
        const k = channelOfArg(args[i], sf);
        if (k) { idx = i; key = k; break; }
      }
      if (key) {
        if (isMainSide) mainSideRef.add(key);
        const callee = node.expression;
        const where = `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;

        if (ts.isPropertyAccessExpression(callee)) {
          const obj = callee.expression.getText(sf);
          const method = callee.name.text;
          if (obj === 'ipcMain' && idx === 0) {
            // handle и on живут в РАЗНЫХ реестрах Electron: invoke идёт в первый, send во второй.
            // Один канал в обоих — законно, а вот два handle на канал — «Attempted to register
            // a second handler». Поэтому вид регистрации запоминаем.
            if (method === 'handle' || method === 'handleOnce') addRole(key, 'handler', where, 'handle');
            else if (method === 'on' || method === 'once') addRole(key, 'handler', where, 'on');
            else addRole(key, 'other', where);
            // Параметры обработчика без первого (event) — с ними и сверяем число посланных.
            const fn = args[1];
            if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
              handlerArity.set(key, { n: Math.max(0, fn.parameters.length - 1), where });
            }
          } else if (obj === 'ipcRenderer' && idx === 0) {
            if (method === 'invoke' || method === 'send' || method === 'sendSync') {
              addRole(key, 'caller', where);
              callerArity.set(key, Math.max(callerArity.get(key) ?? 0, args.length - 1));
            } else if (method === 'on' || method === 'once') addRole(key, 'listener', where);
            else addRole(key, 'other', where); // removeListener и прочее — не роль
          } else if (method === 'send' || method === 'sendToFrame') {
            addRole(key, 'sender', where);
          } else {
            addRole(key, 'other', where);
          }
        } else if (ts.isIdentifier(callee)) {
          // Вспомогательные обёртки: broadcastToChrome(IPC.X, …), sendTo(wc, IPC.X, …)
          addRole(key, /send|broadcast|push|emit|notify/i.test(callee.text) ? 'sender' : 'other', where);
        } else {
          addRole(key, 'other', where);
        }
      }
    }
    // Упоминание канала вне вызова (объект-карта, switch, массив) — тоже ссылка: канал не мёртвый.
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(sf) === 'IPC' && channels.has(node.name.text)) {
      if (isMainSide) mainSideRef.add(node.name.text);
      if (roles.get(node.name.text).size === 0) addRole(node.name.text, 'other', rel);
    }
    // Строка, дословно равная объявленному каналу, — обход контракта: переименование значения в
    // shared/ipc.ts такое место не заденет, и сторона молча отвалится.
    if (ts.isStringLiteral(node) && keyOfValue.has(node.text)
        && !SANDBOXED_PRELOADS.has(rel) && rel !== CHANNELS_FILE.replace(/\\/g, '/')) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      literalSites.push(`${rel}:${line}  '${node.text}' → IPC.${keyOfValue.get(node.text)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ── Правила ─────────────────────────────────────────────────────────────────
console.log(`\n— инвентарь —`);
check('каналы разобраны из shared/ipc/channels.ts', channels.size > 0, true);
console.log(`         каналов: ${channels.size}, с обработчиком: ${[...roles].filter(([, r]) => r.has('handler')).length}`);

console.log('\n— уникальность —');
checkEmpty(
  'нет двух ключей IPC с одинаковой строкой',
  [...byValue].filter(([, keys]) => keys.length > 1).map(([v, keys]) => `'${v}' ← ${keys.join(', ')}`),
  'один обработчик молча перекроет другой',
);
checkEmpty(
  'канал не зарегистрирован дважды одним и тем же способом',
  [...handlerSites]
    .map(([k, sites]) => {
      const dup = ['handle', 'on'].find((kind) => sites.filter((s) => s.kind === kind).length > 1);
      return dup ? `${k}: ${sites.filter((s) => s.kind === dup).map((s) => s.where).join(', ')}` : null;
    })
    .filter(Boolean),
  'Electron бросит «Attempted to register a second handler»',
);

console.log('\n— проводка —');
checkEmpty(
  'мёртвых каналов нет',
  [...roles].filter(([, r]) => r.size === 0).map(([k]) => k),
  'канал объявлен, но им никто не пользуется — удалить или дописать сторону',
);
checkEmpty(
  'у каждого вызываемого канала есть обработчик',
  [...roles]
    .filter(([, r]) => r.has('caller') && !r.has('handler'))
    .map(([k]) => `${k} — invoke/send есть, ipcMain.handle нет`),
  'в рантайме это «No handler registered», tsc такое не видит',
);
checkEmpty(
  'у каждого слушаемого канала есть отправитель',
  // Отправителем считается и упоминание канала где-нибудь в electron/ вне preload: пуши уходят
  // через обёртки (broadcastToChrome, sendTo, this.win.webContents.send), и требовать здесь
  // именно `.send(` значило бы ловить обёртки как «мёртвую подписку».
  [...roles]
    .filter(([k, r]) => r.has('listener') && !r.has('sender') && !mainSideRef.has(k))
    .map(([k]) => `${k} — ipcRenderer.on есть, из main никто не шлёт`),
  'подписка висит мёртвой: событие не придёт никогда',
);

console.log('\n— арность —');
checkEmpty(
  'обработчик принимает столько же аргументов, сколько шлёт preload',
  [...callerArity]
    .filter(([k, sent]) => handlerArity.has(k) && handlerArity.get(k).n !== sent)
    .map(([k, sent]) => {
      const h = handlerArity.get(k);
      return `${k}: шлём ${sent}, принимает ${h.n}  (${h.where})`;
    }),
  'лишний аргумент теряется, недостающий приходит как undefined',
);

console.log('\n— канал пишется через IPC.*, а не строкой —');
checkEmpty(
  'нет строк, дублирующих объявленный канал',
  literalSites,
  'переименование значения в shared/ipc.ts такое место не заденет — сторона молча отвалится',
);

// Обратная проверка для sandboxed preload: импортировать контракт он не может, поэтому строки
// в нём дублируются руками — и до сих пор это держалось только на комментарии «ДОЛЖНЫ совпадать».
// Здесь обещание становится machine-checked: переименуют значение в shared/ipc.ts — упадём тут,
// а не на живой странице с молчащим автозаполнением.
for (const rel of SANDBOXED_PRELOADS) {
  const file = path.join(ROOT, rel);
  const sf = parse(file);
  const drifted = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^CH_/.test(node.name.text)
        && node.initializer && ts.isStringLiteral(node.initializer)
        && !keyOfValue.has(node.initializer.text)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      drifted.push(`${rel}:${line}  ${node.name.text} = '${node.initializer.text}' — такого канала в IPC нет`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  checkEmpty(`строки каналов в ${rel} совпадают с контрактом`, drifted,
    'sandboxed preload не может импортировать shared/ipc — строки тут дублируются вручную');
}

// ── Golden-инвентарь ────────────────────────────────────────────────────────
// Тревожная нить для ЧИСТЫХ ПЕРЕНОСОВ (раскол shared/ipc.ts и registerIpc по доменам): типы при
// таком переносе сходятся, а вот молча потерянный канал не проявится до нажатия кнопки.
console.log('\n— golden-инвентарь —');
const current = [...channels].map(([k, v]) => `${k}=${v}`).sort();

if (UPDATE) {
  fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
  fs.writeFileSync(GOLDEN, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  console.log(`  ok   инвентарь переписан: ${current.length} каналов → scripts/fixtures/ipc-channels.json`);
  passed++;
} else if (!fs.existsSync(GOLDEN)) {
  console.log(' FAIL  golden-инвентарь отсутствует');
  console.log('         → создать: node scripts/contract-check.mjs --update');
  failed++;
} else {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const goldenSet = new Set(golden);
  const currentSet = new Set(current);
  const gone = golden.filter((x) => !currentSet.has(x));
  const added = current.filter((x) => !goldenSet.has(x));
  checkEmpty(
    'ни один канал не потерян и не переименован молча',
    [...gone.map((x) => `− ${x}`), ...added.map((x) => `+ ${x}`)],
    'если изменение осознанное: node scripts/contract-check.mjs --update',
  );
}

// ⚠️ Машинный вывод для ЖИВОЙ проверки проводки (scripts/ipc-wiring-drive.mjs). Тот разбор
// исходников, что уже сделан здесь, ей нужен целиком: какие каналы ОБЯЗАНЫ иметь глобальную
// регистрацию в ipcMain и каким способом. Второй раз писать тот же AST-проход значило бы завести
// две расходящиеся модели контракта — ровно ту болезнь, от которой этот сторож и лечит.
//
// ⚠️ Здесь только `ipcMain.handle/on`. Регистрация на КОНКРЕТНОМ WebContents (`wc.ipc.on` в
// TabManager) в handlerSites не попадает по построению — и не должна: в глобальном реестре
// Electron её нет, и живая проверка искала бы её там впустую.
if (process.argv.includes('--json')) {
  const of = (kind) => [...handlerSites]
    .filter(([, sites]) => sites.some((s) => s.kind === kind))
    .map(([k]) => channels.get(k))
    .sort();
  process.stdout.write(JSON.stringify({
    channels: Object.fromEntries(channels),
    handle: of('handle'),
    on: of('on'),
  }));
  process.exit(failed === 0 ? 0 : 1);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
