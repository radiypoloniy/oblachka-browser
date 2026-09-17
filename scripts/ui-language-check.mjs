import { initialUiLanguage, isUiLanguage } from '../shared/uiLanguage.ts';

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}`);
}

check('новый профиль начинает на английском', initialUiLanguage(undefined, false), 'en');
check('старый профиль без настройки остаётся русским', initialUiLanguage(undefined, true), 'ru');
check('явный русский выбор нового профиля', initialUiLanguage('ru', false), 'ru');
check('явный английский выбор старого профиля', initialUiLanguage('en', true), 'en');
check('битая настройка в старом профиле', initialUiLanguage('xx', true), 'ru');
check('строгая проверка допустимых языков', isUiLanguage('EN'), false);

console.log(`Итого: ${passed} прошло, ${failed} не прошло`);
if (failed) process.exitCode = 1;
