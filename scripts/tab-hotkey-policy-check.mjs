// Спорные клавиши должны совпадать в main и sandboxed preload: общий импорт там невозможен.
// Запуск: npm test -- tab-hotkey-policy
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { disputedPageAction, disputedKeyStuckInFrame } from '../electron/tabHotkeyPolicy.ts';

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(` ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`       получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const preload = fs.readFileSync(fileURLToPath(new URL('../electron/preload-content.ts', import.meta.url)), 'utf8');
const mapping = preload.match(/const DISPUTED: Record<string, string> = \{([\s\S]*?)\n\};/)?.[1] ?? '';
const entries = [...mapping.matchAll(/(Key[A-Z]): '([^']+)'/g)].map((m) => [m[1], m[2]]);
check('список preload найден', entries.length, 5);
check('имена действий в main совпадают с preload',
  entries.map(([code]) => disputedPageAction(code)), entries.map(([, action]) => action));
check('посторонняя клавиша не считается спорной', disputedPageAction('KeyX'), undefined);

const wc = (origin, parent, mainOrigin = 'https://site.test') => ({
  focusedFrame: { origin, parent }, mainFrame: { origin: mainOrigin },
});
check('главный кадр оставляет клавишу нижнему пути', disputedKeyStuckInFrame(wc('https://site.test', null)), false);
check('iframe своего origin оставляет клавишу редактору', disputedKeyStuckInFrame(wc('https://site.test', {})), false);
check('чужой iframe подхватывается в main', disputedKeyStuckInFrame(wc('https://other.test', {})), true);
check('исчезнувший кадр не ломает обработчик', disputedKeyStuckInFrame({ get focusedFrame() { throw Error('destroyed'); } }), false);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
