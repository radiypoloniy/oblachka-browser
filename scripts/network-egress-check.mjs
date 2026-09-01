// Сторож сетевого выхода: из main-процесса в сеть ходят ТОЛЬКО через сессию.
//
// ⚠️ ЗАЧЕМ. Обещание «этот профиль только через VPN» держится на `session.setProxy` — то есть на
// КОНКРЕТНОЙ сессии. Глобальный `fetch()` идёт через сетевой стек Node/undici и про сессии
// Electron не знает вовсе: он уходит мимо прокси, мимо kill switch и мимо адблока. При включённом
// туннеле такой запрос отдаёт реальный IP, и человек об этом не узнает никогда.
//
// Августовский заход перевёл 47 вызовов на `fetchInProfile` (см. ProfileSession.ts) и закрыл дыру.
// Этот сторож нужен не для того, чтобы закрыть её ещё раз, а чтобы она НЕ ОТКРЫЛАСЬ ЗАНОВО: один
// забытый `await fetch(url)` в новом файле возвращает всё к августу, и ни `tsc`, ни проверки, ни
// живые прогоны этого не видят — запрос уходит успешно, просто не туда.
//
// ⚠️ РАЗБОР НАСТОЯЩИМ AST, а не регулярками, и это не педантизм. В `electron/` полно строк,
// которые инжектятся В СТРАНИЦУ (`executeJavaScript`), и внутри них `fetch(...)` — совершенно
// законный вызов: он выполняется в гостевом рендерере, идёт через сессию вкладки и никакой утечкой
// не является. Регулярка не отличает код от строки с кодом; AST отличает по построению — в дерево
// попадает только настоящий вызов, а содержимое шаблонного литерала остаётся текстом.
//
// Запуск: npm test -- network-egress
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = 'electron';

// Способы уйти в сеть мимо сессии. Ключ — как это выглядит в коде, значение — чем заменить.
const FORBIDDEN = {
  'fetch': 'fetchInProfile из ProfileSession.ts (или session.fetch нужной сессии)',
  'net.fetch': 'fetchInProfile: net.fetch без session уходит defaultSession, а профили живут в своих',
  'net.request': 'fetchInProfile — по той же причине, что net.fetch',
  'https.request': 'fetchInProfile: модуль Node про сессии Electron не знает',
  'https.get': 'fetchInProfile: модуль Node про сессии Electron не знает',
  'http.request': 'fetchInProfile: модуль Node про сессии Electron не знает',
  'http.get': 'fetchInProfile: модуль Node про сессии Electron не знает',
};

/**
 * Файлы, которым позволено ходить в сеть иначе, — ИМЕННОЙ и закрытый список.
 *
 * ⚠️ Каждая строка здесь обязана иметь причину, по которой сессия не подходит. «Так исторически»
 * причиной не является: если сюда попадёт файл без разбора, сторож перестанет что-либо значить.
 */
const ALLOW = {
  // Сам помощник и есть та самая правильная дверь — внутри он зовёт session.fetch.
  'electron/ProfileSession.ts': 'здесь живёт fetchInProfile — это и есть разрешённый путь',
};

let passed = 0;
let failed = 0;
const check = (what, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name).replace(/\\/g, '/');
    if (e.isDirectory()) walkFiles(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Как записан вызываемый: `fetch`, `net.fetch`, `https.request`… */
function calleeName(node) {
  const e = node.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && ts.isIdentifier(e.name)) {
    return `${e.expression.text}.${e.name.text}`;
  }
  return null;
}

const hits = [];
for (const file of walkFiles(ROOT)) {
  if (file in ALLOW) continue;
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name && name in FORBIDDEN) {
        const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
        hits.push({ file, line: line + 1, name });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(src, visit);
}

console.log('\n— из main в сеть ходят только через сессию —');
if (hits.length === 0) {
  check('да', true, `проверено ${walkFiles(ROOT).length} файлов`);
} else {
  for (const h of hits) check(`${h.file}:${h.line} — ${h.name}()`, false, `нужно: ${FORBIDDEN[h.name]}`);
}

// ⚠️ Список исключений проверяется НА СУЩЕСТВОВАНИЕ файлов. Переименовали файл, забыли строку —
// и исключение начинает молча прикрывать пустоту, а настоящий файл остаётся без охраны.
console.log('\n— именной список исключений не протух —');
const stale = Object.keys(ALLOW).filter((f) => !fs.existsSync(f));
if (stale.length === 0) check('да', true, `${Object.keys(ALLOW).length} файл`);
else for (const f of stale) check(`${f} в списке исключений, но такого файла нет`, false);

console.log(`\nИтого: ${passed} ок, ${failed} провалено\n`);
process.exit(failed === 0 ? 0 : 1);
