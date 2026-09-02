// Прогон разбора потока SSE (shared/sseParse.ts) — без electron, обычным node.
//
// ⚠️ Главный случай здесь один и он же самый неприятный в жизни: ГРАНИЦЫ СЕТЕВЫХ КУСКОВ НЕ
// СОВПАДАЮТ С ГРАНИЦАМИ СОБЫТИЙ. Событие приезжает двумя чанками, чанк несёт полтора события,
// разрыв попадает ровно в середину слова «data». Наивный split('\n\n') проходит все быстрые
// проверки и ломается на медленной сети — то есть там, где человек смотрит на текст и ждёт.
// Симптом отвратительный: из ответа пропадают куски, воспроизвести нельзя.
//
// Поэтому ниже один и тот же поток разбирается ТРИЖДЫ: целиком, по событиям и ПОБАЙТОВО. Результат
// обязан совпасть. Побайтовый прогон — самая злая форма разрыва, какая бывает.
//
// Запуск: npm run sse-parse-check
import { createSseParser, isSseDone } from '../shared/sseParse.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

// Прогнать поток, разрезанный на куски указанным способом.
function run(chunks) {
  const p = createSseParser();
  const out = [];
  for (const c of chunks) out.push(...p.push(c));
  out.push(...p.flush());
  return out;
}

const byChars = (s, n) => {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
};

console.log('\n— простой поток —');
check('одно событие', run(['data: привет\n\n']), [{ data: 'привет' }]);
check('два события', run(['data: раз\n\ndata: два\n\n']), [{ data: 'раз' }, { data: 'два' }]);
check('имя события сохраняется',
  run(['event: content_block_delta\ndata: {"x":1}\n\n']),
  [{ data: '{"x":1}', name: 'content_block_delta' }]);

console.log('\n— тот же поток, разрезанный как попало —');
const STREAM =
  'data: {"choices":[{"delta":{"content":"При"}}]}\n\n' +
  ': keep-alive\n\n' +
  'data: {"choices":[{"delta":{"content":"вет"}}]}\n\n' +
  'data: [DONE]\n\n';
const WHOLE = run([STREAM]);
check('целиком — три события', WHOLE.length, 3);
check('разрез по событиям даёт то же', run(STREAM.split(/(?<=\n\n)/)), WHOLE);
check('разрез по 7 символов даёт то же', run(byChars(STREAM, 7)), WHOLE);
check('разрез по 1 символу даёт то же', run(byChars(STREAM, 1)), WHOLE);
check('разрез ровно посреди слова data',
  run(['da', 'ta: привет\n', '\n']), [{ data: 'привет' }]);
check('разрыв между \\n и \\n', run(['data: привет\n', '\ndata: пока\n\n']),
  [{ data: 'привет' }, { data: 'пока' }]);

console.log('\n— CRLF: сеть отдаёт \\r\\n, бьём по \\n —');
check('возврат каретки не попадает в данные', run(['data: привет\r\n\r\n']), [{ data: 'привет' }]);
check('и не мешает распознать конец', run(['data: [DONE]\r\n\r\n']).map((e) => isSseDone(e.data)), [true]);

console.log('\n— мелочи формата —');
// ⚠️ Ровно один ведущий пробел принадлежит формату. Второй — уже данные: у некоторых провайдеров
// в потоке идут пробелы как значимый текст, и съесть их значит склеить слова.
check('съедается ровно один пробел после двоеточия', run(['data:  два пробела\n\n']), [{ data: ' два пробела' }]);
check('без пробела тоже работает', run(['data:вплотную\n\n']), [{ data: 'вплотную' }]);
check('поле без двоеточия не роняет разбор', run(['data\n\n']), [{ data: '' }]);
check('комментарий-пульс не даёт события', run([': ping\n\n']), []);
check('несколько data склеиваются через перевод строки',
  run(['data: первая\ndata: вторая\n\n']), [{ data: 'первая\nвторая' }]);
check('незнакомые поля пропускаются', run(['id: 42\nretry: 1000\ndata: тело\n\n']), [{ data: 'тело' }]);

console.log('\n— конец потока —');
// ⚠️ Событие без завершающей пустой строки: так поток кончается, когда сервер просто закрыл
// соединение. Потерять здесь последний кусок ответа — потерять хвост текста у человека на экране.
check('последнее событие без пустой строки не теряется', run(['data: хвост']), [{ data: 'хвост' }]);
check('после flush парсер пуст', (() => {
  const p = createSseParser();
  p.push('data: раз');
  return [p.flush().length, p.flush().length];
})(), [1, 0]);
check('пустой поток — ничего', run([]), []);
check('пустые чанки ничего не ломают', run(['', 'data: тело\n\n', '']), [{ data: 'тело' }]);

console.log('\n— признак конца у OpenAI-совместимых —');
check('[DONE]', isSseDone('[DONE]'), true);
// ⚠️ Часть шлюзов отдаёт «[DONE] » с хвостовым пробелом. Строгое сравнение на них не срабатывает,
// поток выглядит незакрытым, и ответ висит до таймаута.
check('[DONE] с пробелом по краям', isSseDone(' [DONE] '), true);
check('обычные данные — не конец', isSseDone('{"choices":[]}'), false);
check('пустая строка — не конец', isSseDone(''), false);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
