// Когда карточке обновления можно появиться (shared/updateOffer.ts).
//
// Случаи из жизни, не из симметрии: пропущенная версия не должна спрашивать снова, следующая —
// должна; «не сейчас» живёт до перезапуска; начатая качка не имеет права исчезнуть с экрана.
//
// Запуск: npm test -- update-offer
import { shouldShowUpdatePrompt, updateOfferPhase } from '../shared/updateOffer.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const base = { newVersion: '0.8.2', skippedVersion: null, dismissedAsk: false, postponedInstall: false };

console.log('\n— фаза по статусу —');
check('available → вопрос', updateOfferPhase('available'), 'ask');
check('downloading → прогресс', updateOfferPhase('downloading'), 'progress');
check('downloaded → перезапуск', updateOfferPhase('downloaded'), 'restart');
check('idle прячем', updateOfferPhase('idle'), 'hide');
check('checking прячем', updateOfferPhase('checking'), 'hide');
check('not-available прячем', updateOfferPhase('not-available'), 'hide');
check('error прячем (повтор в настройках)', updateOfferPhase('error'), 'hide');
check('disabled прячем', updateOfferPhase('disabled'), 'hide');

console.log('\n— вопрос: показать или нет —');
check('есть новая версия — спрашиваем',
  shouldShowUpdatePrompt({ kind: 'available', ...base }), true);
check('без номера версии вопроса нет',
  shouldShowUpdatePrompt({ kind: 'available', ...base, newVersion: null }), false);
check('пропущенная эта же версия — молчим',
  shouldShowUpdatePrompt({ kind: 'available', ...base, skippedVersion: '0.8.2' }), false);
check('пропущена СТАРАЯ — новую всё равно спрашиваем',
  shouldShowUpdatePrompt({ kind: 'available', ...base, skippedVersion: '0.7.5' }), true);
check('«не сейчас» в этой сессии — молчим',
  shouldShowUpdatePrompt({ kind: 'available', ...base, dismissedAsk: true }), false);

console.log('\n— качка и перезапуск не прячутся —');
check('качаем даже после «не сейчас»',
  shouldShowUpdatePrompt({ kind: 'downloading', ...base, dismissedAsk: true }), true);
check('качаем даже пропущенную, если уже начали',
  shouldShowUpdatePrompt({ kind: 'downloading', ...base, skippedVersion: '0.8.2' }), true);
check('перезапуск после skip всё равно предлагаем — файл уже лежит',
  shouldShowUpdatePrompt({ kind: 'downloaded', ...base, skippedVersion: '0.8.2' }), true);
check('«позже» на готовом файле прячет карточку',
  shouldShowUpdatePrompt({ kind: 'downloaded', ...base, postponedInstall: true }), false);
check('проверку не показываем карточкой',
  shouldShowUpdatePrompt({ kind: 'checking', ...base }), false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
