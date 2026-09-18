// Какие поля пароля заполнять одной строкой (shared/passwordFill.ts).
//
// Живой случай: генератор писал только в первое поле, «повторить пароль» оставался пустым,
// клик по нему подставлял снова в первое — человек шёл в настройки искать пароль.
//
// Запуск: npm test -- password-fill
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { passwordFieldRole, passwordFillTargets } from '../shared/passwordFill.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

console.log('\n— роль поля —');
check('autocomplete=new-password', passwordFieldRole({ autocomplete: 'new-password' }), 'new');
check('autocomplete=current-password', passwordFieldRole({ autocomplete: 'current-password' }), 'current');
check('подтвердите пароль', passwordFieldRole({ label: 'Подтвердите пароль' }), 'new');
check('repeat password', passwordFieldRole({ name: 'repeat_password' }), 'new');
check('повтор пароля', passwordFieldRole({ placeholder: 'Повторите пароль' }), 'new');
check('текущий пароль', passwordFieldRole({ label: 'Текущий пароль' }), 'current');
check('обычное поле без подсказок', passwordFieldRole({ name: 'password' }), 'unknown');

console.log('\n— какие поля заполняем —');
check('логин: одно поле', passwordFillTargets(['unknown']), [0]);
check('логин: current-password', passwordFillTargets(['current']), [0]);
check('регистрация: пароль + повтор без autocomplete', passwordFillTargets(['unknown', 'unknown']), [0, 1]);
check('регистрация: оба new-password', passwordFillTargets(['new', 'new']), [0, 1]);
check('смена: current + new + confirm', passwordFillTargets(['current', 'new', 'new']), [1, 2]);
check('смена: current + два безымянных', passwordFillTargets(['current', 'unknown', 'unknown']), [1, 2]);
check('смена без autocomplete: три поля — первое не трогаем', passwordFillTargets(['unknown', 'unknown', 'unknown']), [1, 2]);
check('пусто', passwordFillTargets([]), []);

console.log('\n— preload гостевой страницы зовёт ту же логику —');
// sandboxed preload не импортирует shared, поэтому функции скопированы. Сторож держит вызов:
// вернуть fillCredential к «первое поле пароля» — и эта проверка краснеет.
const preload = fs.readFileSync(path.join(ROOT, 'electron/preload-content.ts'), 'utf8');
check('preload содержит passwordFillTargets', preload.includes('passwordFillTargets('), true);
check('preload знает поле повтора', /confirm\|repeat/.test(preload), true);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
