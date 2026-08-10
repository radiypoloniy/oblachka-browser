// Показ примеров уведомлений об отслеживании товаров.
//
// Зачем: как выглядит тост, решает Windows, а не мы — мы задаём только заголовок и текст. Дождаться
// настоящей скидки, чтобы это увидеть, можно неделями, поэтому есть примерка.
//
// ⚠️ Браузер запускается ОБЫЧНЫЙ, а тосты идут ТЕМ ЖЕ путём, что настоящие (showTrackingToast):
// иначе примерка показывала бы не то, что человек получит. Через несколько секунд после старта
// придут три уведомления — подешевело, кончилось, вернулось. Клик по любому открывает страницу.
//
// Запуск: npm run notify-preview
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');

console.log('[notify-preview] запускаю браузер; через ~4 секунды придут три примера уведомлений.');
console.log('[notify-preview] если ничего не появилось — проверьте «Уведомления» в параметрах Windows');
console.log('[notify-preview] и режим «Не беспокоить»: тост рисует система, и она же может его скрыть.\n');

const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, OBLAKO_NOTIFY_PREVIEW: '1' },
});
child.on('exit', (code) => process.exit(code ?? 0));
