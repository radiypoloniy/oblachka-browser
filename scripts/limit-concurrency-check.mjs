// Ограничитель одновременных задач (shared/limitConcurrency.ts) — без electron, обычным node.
//
// ⚠️ Проверяется ГЛАВНОЕ СВОЙСТВО, а не «работает ли вообще»: пик одновременных задач не
// превышает лимит НИ В ОДИН МОМЕНТ. Ошибка здесь тихая — залп всё равно уходит, просто список
// значков едет медленнее обычного, и на глаз это не отличить от медленной сети.
//
// ⚠️ Отдельный случай на упавшую задачу: слот обязан освободиться. Если он утечёт, очередь
// встанет НАВСЕГДА и значки перестанут грузиться вовсе — но только у того, у кого хоть один
// сайт не отдал иконку, то есть почти у всех и не сразу.
//
// Запуск: npm test -- limit-concurrency
import { createLimiter } from '../shared/limitConcurrency.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Задача с ручным управлением: сама сообщает, когда началась, и ждёт разрешения закончиться. */
function makeTask(log) {
  let release;
  const done = new Promise((r) => { release = r; });
  const task = async () => {
    log.started++;
    log.peak = Math.max(log.peak, ++log.now);
    await done;
    log.now--;
    return log.started;
  };
  return { task, release: () => release() };
}

console.log('\n— больше лимита одновременно не запускается —');
{
  const limiter = createLimiter(3);
  const log = { now: 0, peak: 0, started: 0 };
  const tasks = Array.from({ length: 10 }, () => makeTask(log));
  const all = tasks.map((t) => limiter.run(t.task));
  await tick();
  check('запущено ровно три', log.now, 3);
  check('лимитер знает про активные', limiter.active(), 3);
  check('остальные семь ждут', limiter.pending(), 7);

  // Отпускаем по одной и следим, что на освободившееся место встаёт следующая.
  for (const t of tasks) { t.release(); await tick(); }
  await Promise.all(all);
  check('в пике не больше лимита', log.peak <= 3, true);
  check('выполнились все десять', log.started, 10);
  check('очередь пуста', [limiter.active(), limiter.pending()], [0, 0]);
}

console.log('\n— упавшая задача освобождает слот —');
{
  const limiter = createLimiter(2);
  const err = limiter.run(async () => { throw new Error('сеть недоступна'); });
  check('ошибка доходит до вызывающего', await err.then(() => 'не бросил', (e) => e.message), 'сеть недоступна');
  const ok = await limiter.run(async () => 'следующая поехала');
  check('очередь не встала', ok, 'следующая поехала');
  check('слоты свободны', [limiter.active(), limiter.pending()], [0, 0]);
}

console.log('\n— синхронное исключение внутри задачи тоже не держит слот —');
{
  const limiter = createLimiter(1);
  // ⚠️ Ровно тот случай, ради которого задача оборачивается в Promise.resolve().then: голый
  // вызов бросил бы ДО того, как выполнится finally, и единственный слот утёк бы навсегда.
  const boom = limiter.run(() => { throw new Error('кривой аргумент'); });
  check('исключение приходит промисом', await boom.then(() => 'не бросил', (e) => e.message), 'кривой аргумент');
  check('слот освободился', limiter.active(), 0);
  check('следующая выполняется', await limiter.run(async () => 42), 42);
}

console.log('\n— порядок очереди сохраняется —');
{
  const limiter = createLimiter(1);
  const order = [];
  const all = [1, 2, 3, 4].map((n) => limiter.run(async () => { order.push(n); }));
  await Promise.all(all);
  check('задачи выполнены по порядку постановки', order, [1, 2, 3, 4]);
}

console.log('\n— вырожденные лимиты —');
{
  const one = createLimiter(0);
  check('ноль превращается в единицу', await one.run(async () => 'ок'), 'ок');
  const half = createLimiter(2.7);
  const log = { now: 0, peak: 0, started: 0 };
  const tasks = Array.from({ length: 4 }, () => makeTask(log));
  const all = tasks.map((t) => half.run(t.task));
  await tick();
  check('дробный лимит округляется вниз', log.now, 2);
  for (const t of tasks) t.release();
  await Promise.all(all);
}

console.log(`\nИтого: ${passed} ок, ${failed} провалено\n`);
process.exit(failed === 0 ? 0 : 1);
