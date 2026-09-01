// Когда именно главный процесс берёт свой гигабайт — покадровый замер старта.
//
// ⚠️ Продолжение `npm run memory`, а не замена. Тот отвечает на «в какой корзине лежит» и уже
// ответил: из 1426 МБ главного процесса V8 heap занимает 149 и не растёт, external — 26 и не
// растёт, а вся прибавка (+1165 МБ) нативная, разовая, в окне 2,5–8,5 секунды после старта. Это
// не утечка и не накопление: дальше число не меняется ни от вкладок, ни от нагрузки.
//
// ⚠️ Дальше корзины бесполезны, потому что «нативное» — не одна вещь, а всё, чего не видит V8
// ГЛАВНОГО ПОТОКА. Туда попадают и внутренности Chromium, и нативные модули, и — что важнее
// всего — память worker_threads: у них свой изолят, и process.memoryUsage() главного потока их
// не считает вовсе, оставаясь при этом одним и тем же процессом Windows с одними private bytes.
//
// Поэтому здесь другой вопрос: не «что это», а «КОГДА». Момент скачка, сопоставленный со
// стартовым логом приложения, называет виновника точнее любой догадки о составе.
//
// Запуск: npm run memory:timeline
//         npm run memory:timeline -- --seconds 20 --step 200
import { withStand } from './isolated-stand.mjs';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def;
};
const SECONDS = opt('seconds', 16);
const STEP_MS = opt('step', 250);
// Прибавка, ниже которой строка не печатается: без порога вывод утонул бы в шуме на пару мегабайт.
const NOTABLE_MB = opt('notable', 15);

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} МБ`;
const pad = (s, n) => String(s).padEnd(n);

// ⚠️ Выражение нарочно КОРОТКОЕ: оно уходит в main через инспектор каждые 250 мс, и тяжёлый разбор
// метрик здесь искажал бы то, что мы меряем. Нужен один процесс — Browser — и одно число.
const PRIVATE = `(() => {
  const { app } = process.mainModule.require('electron');
  const m = app.getAppMetrics().find((p) => p.type === 'Browser');
  const mu = process.memoryUsage();
  return {
    priv: (m?.memory?.privateBytes ?? 0) * 1024,
    heap: mu.heapTotal,
    external: mu.external,
  };
})()`;

await withStand(async (ctx) => {
  console.log(`\nпрофиль: ${ctx.profile}`);
  console.log(`покадрово: ${SECONDS} с с шагом ${STEP_MS} мс, порог ${NOTABLE_MB} МБ\n`);
  console.log(`  ${pad('t', 9)}${pad('private', 10)}${pad('прирост', 10)}${pad('V8 heap', 10)}что происходило`);

  const t0 = Date.now();
  let seenLogChunks = 0;
  let prev = null;
  let peakStep = { delta: 0, at: 0, lines: [] };

  for (let elapsed = 0; elapsed < SECONDS * 1000; elapsed += STEP_MS) {
    const cur = await ctx.evalMain(PRIVATE).catch(() => null);
    if (!cur) break;

    // Новые строки лога приложения с прошлого кадра — это и есть «что происходило».
    // ⚠️ Отметок времени у них нет, поэтому привязка идёт к КАДРУ: строка, появившаяся между
    // двумя замерами, относится к тому же интервалу, что и прибавка. Точности до миллисекунды
    // здесь не нужно — нужен ответ, какой из стартовых шагов совпал со скачком.
    const fresh = ctx.appLog.slice(seenLogChunks).join('');
    seenLogChunks = ctx.appLog.length;
    const lines = fresh.split('\n').map((l) => l.trim()).filter(Boolean);

    const delta = prev ? cur.priv - prev.priv : cur.priv;
    const t = ((Date.now() - t0) / 1000).toFixed(1);
    const notable = Math.abs(delta) >= NOTABLE_MB * 1024 * 1024;

    if (notable || lines.length) {
      console.log(
        `  ${pad(`${t} с`, 9)}${pad(mb(cur.priv), 10)}`
        + `${pad(delta >= 0 ? `+${mb(delta)}` : `−${mb(-delta)}`, 10)}`
        + `${pad(mb(cur.heap), 10)}${lines[0] ? lines[0].slice(0, 60) : ''}`,
      );
      for (const l of lines.slice(1)) console.log(`  ${' '.repeat(39)}${l.slice(0, 60)}`);
    }
    if (delta > peakStep.delta) peakStep = { delta, at: t, lines };

    prev = cur;
    await new Promise((r) => setTimeout(r, STEP_MS));
  }

  console.log('\n── самый крупный единичный скачок ────────────────────────────');
  console.log(`  ${mb(peakStep.delta)} на отметке ${peakStep.at} с`);
  if (peakStep.lines.length) {
    console.log('  в этом же кадре приложение написало:');
    for (const l of peakStep.lines) console.log(`    ${l.slice(0, 90)}`);
  } else {
    console.log('  ⚠️ в этом кадре приложение не написало ничего — значит, шаг молчаливый.');
    console.log('     Смотреть надо на строки соседних кадров выше: скачок между ними.');
  }
  console.log('');
}, { main: true });
