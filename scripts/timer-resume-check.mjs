// Чтение состояния таймера (src/newtab/timerStore.ts) — без electron, обычным node.
//
// ⚠️ Случай, ради которого проверка заведена, пришёл из жизни: таймер досчитал, и поставить его
// заново на то же время было нельзя. В двух местах сразу и по-разному:
//   • виджет стола запускал `Math.max(остаток, 1000)` — то есть отсчёт на ОДНУ СЕКУНДУ, после
//     которой таймер срабатывал повторно (замер на стенде: 997 мс вместо двадцати минут);
//   • приложение «Таймер» выходило по `if (remaining === 0) return` — кнопка молча не делала
//     ничего.
// Один недосмотр, два обхода: «досчитал» принимали за «нечего считать». Теперь решение одно на
// оба места, и оно проверяется здесь.
//
// Запуск: npm test -- timer-resume
import { TIMER_PRESETS, timerLeftMs, timerResume, timerRunning } from '../src/newtab/timerStore.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const MIN = 60_000;
const NOW = 1_700_000_000_000;

console.log('\n— пуск после того, как таймер досчитал —');
{
  // Состояние ровно такое, каким его оставляет TimerService.fire(): срок снят, остатка нет.
  const fired = { durationMs: 20 * MIN, endAt: 0, leftMs: 0 };
  check('остаток у досчитавшего — ноль', timerLeftMs(fired, NOW), 0);
  check('досчитавший не считается идущим', timerRunning(fired, NOW), false);
  // ⚠️ Главный случай: пуск обязан взять ПОЛНУЮ длительность, а не остаток.
  check('пуск после срабатывания даёт полные 20 минут',
    timerResume(timerLeftMs(fired, NOW), fired.durationMs), 20 * MIN);
}

console.log('\n— пуск с паузы —');
{
  // ⚠️ Обратный край того же правила: у поставленного на паузу продолжаем с ОСТАТКА, иначе
  // пауза превращалась бы в сброс.
  const paused = { durationMs: 20 * MIN, endAt: 0, leftMs: 7 * MIN };
  check('остаток на паузе виден', timerLeftMs(paused, NOW), 7 * MIN);
  check('пуск с паузы продолжает с остатка',
    timerResume(timerLeftMs(paused, NOW), paused.durationMs), 7 * MIN);
}

console.log('\n— единица измерения не важна —');
{
  // Приложение «Таймер» считает в СЕКУНДАХ, виджет — в миллисекундах; функция одна на оба.
  check('секунды: досчитал — берём длительность', timerResume(0, 300), 300);
  check('секунды: остаток есть — берём его', timerResume(42, 300), 42);
  // Отрицательный остаток приходить не должен, но состояние читается из файла — проверим край.
  check('отрицательный остаток считается досчитанным', timerResume(-5, 300), 300);
}

console.log('\n— идёт ли отсчёт —');
{
  check('срок в будущем — идёт', timerRunning({ durationMs: MIN, endAt: NOW + 1000, leftMs: 0 }, NOW), true);
  check('срок ровно сейчас — уже не идёт', timerRunning({ durationMs: MIN, endAt: NOW, leftMs: 0 }, NOW), false);
  check('срок в прошлом — не идёт', timerRunning({ durationMs: MIN, endAt: NOW - 1, leftMs: 0 }, NOW), false);
  check('остаток у просроченного не уходит в минус',
    timerLeftMs({ durationMs: MIN, endAt: NOW - 5000, leftMs: 0 }, NOW), 0);
}

console.log('\n— кнопки —');
{
  // Длительности кнопок держит этот же модуль, а состояние — main (electron/TimerService.ts).
  // ⚠️ Наборы обязаны совпадать: разойдутся — выбранная кнопка перестанет подсвечиваться,
  // потому что виджет ищет пресет по точному равенству длительности.
  check('пресеты виджета', TIMER_PRESETS.map((p) => p.ms), [5 * MIN, 10 * MIN, 20 * MIN]);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
