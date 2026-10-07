// Когда стирать общую приватную сессию (electron/incognitoClear.ts): решение по всем окнам.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { noteIncognitoTab, takeIncognitoClearIfDone } = require('../dist-electron/electron/incognitoClear.js');

let passed = 0, failed = 0;
const check = (what, got, want) => {
  if (got === want) { passed++; console.log(`  ok   ${what}`); }
  else { failed++; console.log(`  FAIL ${what}: получили ${got}, ждали ${want}`); }
};

check('без приватных вкладок стирать нечего', takeIncognitoClearIfDone(false), false);
noteIncognitoTab();
// Окно A закрыло свою последнюю приватную, а в окне B приватная ещё живёт.
check('живая приватная вкладка другого окна откладывает чистку', takeIncognitoClearIfDone(true), false);
check('последняя приватная во всём приложении стирает сессию', takeIncognitoClearIfDone(false), true);
check('повторное закрытие обычной вкладки ничего не стирает', takeIncognitoClearIfDone(false), false);
noteIncognitoTab();
check('новая приватная вкладка снова взводит чистку', takeIncognitoClearIfDone(false), true);

console.log(`Итого: ${passed} прошло, ${failed} не прошло`);
process.exit(failed === 0 ? 0 : 1);
