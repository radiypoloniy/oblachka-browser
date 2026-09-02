// Прогон ограничителя одновременности (shared/limiter.ts) — без electron, обычным node.
//
// ⚠️ Проверка написана ПОД КОНКРЕТНУЮ ГОНКУ, найденную при разборе первой версии, и без неё модуль
// не стоил бы отдельного файла. Наивный семафор уменьшает счётчик и будит ожидающего — но
// разбуженный продолжается только в следующей микрозадаче, и в этот зазор успевает влезть новый
// вызов. Оба считают слот своим, предел превышен, никто не заметил.
//
// Для локальной модели превышение — не «чуть больше нагрузки», а невозможное состояние: у
// node-llama-cpp один контекст на процесс. Симптом был бы из худших: редкий, плавающий, зависящий
// от того, в какой момент человек нажал вторую кнопку.
//
// Поэтому ниже НЕ проверяется «работает ли очередь» — проверяется ПИКОВАЯ одновременность, и в
// самом злом месте: новый вызов приходит ровно в момент освобождения слота.
//
// Запуск: npm run limiter-check
import { createLimiter } from '../shared/limiter.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// Гоняет n задач через ограничитель и возвращает пиковую одновременность.
async function peakWith(max, n, work = tick) {
  const lim = createLimiter(max);
  let now = 0;
  let peak = 0;
  await Promise.all(Array.from({ length: n }, () => lim.run(async () => {
    now++;
    if (now > peak) peak = now;
    await work();
    now--;
  })));
  return peak;
}

console.log('\n— предел соблюдается —');
check('единица держит одну задачу', await peakWith(1, 12), 1);
check('четыре держат четыре', await peakWith(4, 20), 4);
check('задач меньше предела — пик по задачам', await peakWith(8, 3), 3);
check('одна задача', await peakWith(1, 1), 1);

console.log('\n— гонка передачи слота —');
// ⚠️ ЭТО ГЛАВНЫЙ СЛУЧАЙ ФАЙЛА: он воспроизводит настоящую поломку наивного семафора («release
// уменьшает счётчик, разбуженный увеличивает его обратно»). Проверено обратным ходом — на наивной
// версии сценарий ниже даёт пик 4 при пределе 2, на нынешней ровно 2.
//
// ⚠️ СЛАБЫЙ СЦЕНАРИЙ ТУТ НЕ РАБОТАЕТ, и это стоит помнить, если случай захочется упростить. Первая
// попытка ловила гонку одним переходом микрозадачи при пределе 1 — и не поймала ничего: окно между
// release() и пробуждением так не достаётся, микрозадачи разбираются раньше любого таймера. Нужны
// РАЗНЫЕ места событийного цикла и предел БОЛЬШЕ единицы: тогда несколько release() успевают
// уменьшить счётчик подряд, пока разбуженные ещё не увеличили его обратно.
async function peakUnderPressure(max) {
  const lim = createLimiter(max);
  let now = 0;
  let peak = 0;
  let i = 0;
  // Порядок способов ожидания фиксирован: проверка не имеет права плавать от запуска к запуску.
  const waits = [
    () => Promise.resolve(),
    () => new Promise((r) => setTimeout(r, 0)),
    () => new Promise((r) => setImmediate(r)),
    async () => {},
  ];
  const mk = () => {
    const wait = waits[i++ % waits.length];
    return lim.run(async () => {
      now++;
      if (now > peak) peak = now;
      await wait();
      now--;
    });
  };

  const all = [];
  for (let k = 0; k < 6; k++) all.push(mk());
  for (let k = 0; k < 6; k++) { await Promise.resolve(); all.push(mk()); }
  // Задачи, запускаемые ИЗ ЗАВЕРШЕНИЯ других задач — то есть ровно в момент release().
  all.slice(0, 3).forEach((p) => p.then(() => all.push(mk())));
  await new Promise((r) => setTimeout(r, 0));
  for (let k = 0; k < 4; k++) all.push(mk());
  await Promise.all(all);
  return peak;
}

check('под давлением предел 1 не превышается', await peakUnderPressure(1), 1);
check('под давлением предел 2 не превышается', await peakUnderPressure(2), 2);
check('под давлением предел 3 не превышается', await peakUnderPressure(3), 3);

console.log('\n— отказ задачи освобождает слот —');
// ⚠️ Без release() в finally одна ошибка сети навсегда съедала бы единицу пропускной способности
// подключения: слот занят задачей, которой уже нет, и восстановиться можно только перезапуском.
{
  const lim = createLimiter(1);
  await lim.run(async () => { throw new Error('сеть'); }).catch(() => {});
  await lim.run(async () => { throw new Error('снова'); }).catch(() => {});
  check('после двух отказов слот свободен', [lim.active(), lim.queued()], [0, 0]);
  check('и следующая задача проходит', await lim.run(async () => 'ок'), 'ок');
}
{
  const lim = createLimiter(1);
  const bad = lim.run(async () => { await tick(); throw new Error('поздний отказ'); });
  const good = lim.run(async () => 'после отказа');
  await bad.catch(() => {});
  check('ожидающая задача дожидается упавшей', await good, 'после отказа');
}

console.log('\n— счётчики —');
{
  const lim = createLimiter(1);
  check('на пустом всё по нулям', [lim.active(), lim.queued()], [0, 0]);
  const a = lim.run(tick);
  const b = lim.run(tick);
  check('одна работает, одна ждёт', [lim.active(), lim.queued()], [1, 1]);
  await Promise.all([a, b]);
  check('после завершения снова пусто', [lim.active(), lim.queued()], [0, 0]);
}

console.log('\n— значение предела —');
check('ноль поднимается до единицы', await peakWith(0, 5), 1);
check('дробное округляется вниз', await peakWith(2.9, 10), 2);
check('отрицательное — тоже единица', await peakWith(-3, 5), 1);

console.log('\n— порядок —');
// Очередь честная: кто раньше встал, тот раньше пойдёт.
{
  const lim = createLimiter(1);
  const order = [];
  await Promise.all([1, 2, 3, 4].map((n) => lim.run(async () => { order.push(n); await tick(); })));
  check('первым пришёл — первым обслужен', order, [1, 2, 3, 4]);
}

console.log('\n— результат задачи доходит до вызывающего —');
check('значение возвращается', await createLimiter(2).run(async () => 42), 42);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
