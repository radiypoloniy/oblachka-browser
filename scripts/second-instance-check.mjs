// Сторож решения о повторном запуске (shared/secondInstance.ts).
//
// ⚠️ Главный случай — живой: «закрыл браузер и тут же открыл заново» давало пустое окно, потому что
// клик прилетал в процесс, доигрывающий выход, и тот создавал окно без сессии.
//
// Запуск: npm test -- second (или node scripts/second-instance-check.mjs)
import { secondInstanceAction } from '../shared/secondInstance.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

check('закрыл и тут же открыл (Windows): перезапуск, а не пустое окно',
  secondInstanceAction({ hasWindow: false, restored: true, platform: 'win32' }), 'relaunch');
check('то же на Linux',
  secondInstanceAction({ hasWindow: false, restored: true, platform: 'linux' }), 'relaunch');
check('повторный клик на медленном старте: ждать восстановления',
  secondInstanceAction({ hasWindow: false, restored: false, platform: 'win32' }), 'defer');
check('на старте не перезапускаемся и на macOS',
  secondInstanceAction({ hasWindow: false, restored: false, platform: 'darwin' }), 'defer');
check('macOS без окон — штатное состояние, поднимаем окно',
  secondInstanceAction({ hasWindow: false, restored: true, platform: 'darwin' }), 'revive');
check('окно есть — поднять его',
  secondInstanceAction({ hasWindow: true, restored: true, platform: 'win32' }), 'focus');
// Окно уже создано, хотя флаг восстановления ещё не поднят (между createWindow и концом старта).
check('окно есть посреди старта — тоже поднять',
  secondInstanceAction({ hasWindow: true, restored: false, platform: 'win32' }), 'focus');

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
