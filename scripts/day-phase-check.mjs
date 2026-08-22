// Фаза суток и дуга светила (shared/dayPhase.ts) — без electron.
//
// Зачем: ошибка здесь видна как БАГ, а не как неточность. Живой случай 22.08 — луна лежала в
// углу плитки, потому что ночью позиция считалась «ниже горизонта».
//   npm test -- day-phase
import {
  dayPhase, arcPosition, minutesUntilNextEvent, skyStops, isWarmPhase, starField,
  circularDistance, TWILIGHT_MIN, MINUTES_IN_DAY,
} from '../shared/dayPhase.ts';

let passed = 0;
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  ✗ ${name}\n      получили ${JSON.stringify(got)}\n      ждали    ${JSON.stringify(want)}`); }
  else { passed++; console.log(`  ✓ ${name}`); }
};
const checkTrue = (name, got) => check(name, !!got, true);

const RISE = 5 * 60 + 34;  // 05:34 — как в живом Краснодаре на скриншотах
const SET = 19 * 60 + 19;  // 19:19
const at = (h, m = 0) => h * 60 + m;

console.log('\n── фазы суток ──');
{
  check('глубокая ночь', dayPhase(at(2), RISE, SET), 'night');
  check('перед восходом — рассвет', dayPhase(at(5, 10), RISE, SET), 'dawn');
  check('сразу после восхода — восход', dayPhase(at(5, 50), RISE, SET), 'sunrise');
  check('полдень', dayPhase(at(13), RISE, SET), 'day');
  check('перед закатом — закат', dayPhase(at(19), RISE, SET), 'sunset');
  check('после заката — сумерки', dayPhase(at(19, 45), RISE, SET), 'dusk');
  check('поздний вечер снова ночь', dayPhase(at(23), RISE, SET), 'night');
  // ⚠️ Шесть фаз, а не две: небо «день/ночь» переключалось скачком, и в 21:15 рисовалось то же,
  // что в 3 часа. Сумерки — отдельное состояние, и они дают картинке настроение.
  check('фаз ровно шесть', new Set(['night', 'dawn', 'sunrise', 'day', 'sunset', 'dusk']).size, 6);
}

console.log('\n── дуга: ночью по ней идёт ЛУНА ──');
{
  // ⚠️ Живой баг: ночью светило считалось «ниже горизонта» и лежало в углу плитки. Теперь у
  // луны своя дуга — то же решение, что у Sundial и Sloww.
  check('днём на дуге солнце', arcPosition(at(13), RISE, SET).body, 'sun');
  check('ночью на дуге луна', arcPosition(at(2), RISE, SET).body, 'moon');
  check('сразу после заката — луна', arcPosition(at(19, 30), RISE, SET).body, 'moon');

  const noonish = arcPosition(at(12, 26), RISE, SET);
  checkTrue('в середине дня солнце примерно на вершине',
    Math.abs(noonish.frac - 0.5) < 0.03, `frac=${noonish.frac.toFixed(3)}`);
  checkTrue('на восходе доля около нуля', arcPosition(RISE + 1, RISE, SET).frac < 0.01);
  checkTrue('перед закатом доля около единицы', arcPosition(SET - 1, RISE, SET).frac > 0.99);
  // Ночь переходит через полночь — самое частое место ошибки в таких расчётах.
  const midnight = arcPosition(at(0, 30), RISE, SET);
  checkTrue('после полуночи луна прошла больше половины пути',
    midnight.frac > 0.5 && midnight.frac < 1, `frac=${midnight.frac.toFixed(3)}`);
  checkTrue('доля всегда в пределах 0…1',
    [0, 300, 700, 1100, 1439].every((m) => {
      const f = arcPosition(m, RISE, SET).frac;
      return f >= 0 && f <= 1;
    }));
}

console.log('\n── сколько осталось ──');
{
  check('днём — до заката', minutesUntilNextEvent(at(19), RISE, SET), 19);
  check('ночью — до восхода', minutesUntilNextEvent(at(4), RISE, SET), 94);
  // ⚠️ Через полночь: наивная разность дала бы отрицательное число, и подпись показала бы
  // «рассвет через −8 ч».
  checkTrue('через полночь остаток положительный',
    minutesUntilNextEvent(at(23, 30), RISE, SET) > 0,
    String(minutesUntilNextEvent(at(23, 30), RISE, SET)));
  check('и он равен пути до утра', minutesUntilNextEvent(at(23, 30), RISE, SET), 364);
}

console.log('\n── расстояние по кругу ──');
check('внутри суток', circularDistance(at(10), at(11)), 60);
check('через полночь считается коротким путём', circularDistance(at(23, 30), at(0, 30)), 60);
checkTrue('никогда не больше полусуток',
  [0, 100, 700, 1400].every((m) => circularDistance(m, at(12)) <= MINUTES_IN_DAY / 2));
check('окно сумерек задано', TWILIGHT_MIN, 45);

console.log('\n── небо ──');
{
  for (const phase of ['night', 'dawn', 'sunrise', 'day', 'sunset', 'dusk']) {
    const stops = skyStops(phase);
    checkTrue(`${phase}: три ступени hex`,
      stops.length === 3 && stops.every((c) => /^#[0-9A-Fa-f]{6}$/.test(c)));
  }
  checkTrue('день и ночь — разное небо', skyStops('day')[0] !== skyStops('night')[0]);
  checkTrue('закат тёплый', isWarmPhase('sunset'));
  checkTrue('ночь холодная', !isWarmPhase('night'));
}

console.log('\n── звёзды ──');
{
  const a = starField();
  const b = starField();
  // ⚠️ НЕ Math.random(): позиции обязаны совпадать между перерисовками, иначе небо мерцает
  // каждую минуту при обновлении времени.
  check('поле звёзд повторяемо', a, b);
  checkTrue('все внутри плитки', a.every((s) => s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1));
  checkTrue('звёзды жмутся к верху', a.every((s) => s.y <= 0.62));
  check('сколько просили, столько и вернулось', starField(10).length, 10);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
