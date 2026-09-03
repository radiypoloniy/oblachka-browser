// Реестр «что сейчас делает ИИ» держит НЕСКОЛЬКО работ разом. Не *-check.mjs — поднимает приложение.
//
// ⚠️ ЗАВЕДЕНО ПО НАЙДЕННОЙ ПОТЕРЕ ЧУЖОЙ РАБОТЫ. Реестр держал ровно один слот, и `beginActivity`
// начинал с того, что обрывал предыдущую работу. С единственной локальной моделью это было честно:
// у node-llama-cpp один контекст на процесс, второй работе всё равно негде было идти. С облаком
// параллельность появилась по-настоящему — и вопрос в чате блокнота молча убивал генерацию
// страницы, начатую минуту назад. Снаружи это выглядит как «Студия перестала писать сама по себе».
//
// ⚠️ Проверяется ЖИВЬЁМ, потому что проверить иначе нечем: AiActivity живёт в electron/, а `npm test`
// держит только чистую логику shared/. Между «функция написана» и «две работы действительно не
// мешают друг другу» помещается ровно эта поломка.
//
// Запуск: npm run drive -- ai-activity
import { withStand, wait } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

// ⚠️ Модуль берём ИЗ КЭША CommonJS: require по абсолютному пути отдаёт ВТОРУЮ копию с пустым
// состоянием — на этом уже спотыкались в key-migration-drive. Ключи кэша на Windows идут с
// обратными слэшами, поэтому перед сравнением приводим разделитель.
const MOD = (tail) => `(() => {
  const cache = process.mainModule.constructor._cache;
  const key = Object.keys(cache).find((k) => k.split(String.fromCharCode(92)).join('/').endsWith(${JSON.stringify(tail)}));
  return key ? cache[key].exports : null;
})()`;

await withStand(async (ctx) => {
  await wait(5000);

  const out = await ctx.evalMain(`(() => {
    const a = ${MOD('AiActivity.js')};
    if (!a) return { ошибка: 'AiActivity не найден в кэше' };
    a.cancelActivity();

    const first = a.beginActivity('Пишу страницу', 'notebook');
    const afterFirst = a.getActivity();
    const second = a.beginActivity('Отвечаю в чате', 'chat');
    // ⚠️ Снимаем признак СРАЗУ: ниже идёт общий «Стоп», и прочитанный после него флаг сказал бы
    // «прервана» о любой работе — то есть ассерт был бы зелёным и на сломанном коде тоже.
    const firstCancelled = first.cancelled;
    const afterSecond = a.getActivity();

    first.progress(1200);
    const progressed = a.getActivity();

    second.done();
    const afterDone = a.getActivity();

    a.cancelActivity();
    return {
      firstCancelled,
      afterFirst, afterSecond, progressed, afterDone,
      afterCancelAll: a.getActivity(),
      cancelledNothing: a.cancelActivity(),
    };
  })()`);

  check('реестр найден', out?.ошибка === undefined, out?.ошибка ?? '');

  // ⚠️ ГЛАВНЫЙ АССЕРТ: вторая работа НЕ обрывает первую. Именно это и ломалось.
  check('вторая работа не обрывает первую', out?.firstCancelled === false, String(out?.firstCancelled));
  check('идут обе', out?.afterSecond?.count === 2, String(out?.afterSecond?.count));
  check('одна — это одна', out?.afterFirst?.count === 1, String(out?.afterFirst?.count));

  // ⚠️ Показывается САМАЯ СВЕЖАЯ: у неё живее счётчик, и это та, на которую человек смотрит.
  check('показана самая свежая работа', out?.afterSecond?.label === 'Отвечаю в чате', String(out?.afterSecond?.label));
  // ⚠️ ...но забытая фоновая не пропадает: прогресс первой не теряется, пока идёт вторая.
  check('прогресс фоновой работы не потерян', out?.progressed?.count === 2, JSON.stringify(out?.progressed));

  check('после завершения свежей остаётся первая', out?.afterDone?.label === 'Пишу страницу', String(out?.afterDone?.label));
  check('и она помнит свои знаки', out?.afterDone?.chars === 1200, String(out?.afterDone?.chars));

  // ⚠️ Цвет светодиода — утверждение «текст никуда не улетает». Без подключений он обязан быть
  // «здесь»: соврать здесь хуже, чем не показать вовсе.
  check('без подключений работа считается локальной', out?.afterDone?.local === true, String(out?.afterDone?.local));

  check('«Стоп» без номера гасит всё', out?.afterCancelAll === null, JSON.stringify(out?.afterCancelAll));
  check('гасить нечего — так и говорим', out?.cancelledNothing === false, String(out?.cancelledNothing));
}, { main: true });

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
