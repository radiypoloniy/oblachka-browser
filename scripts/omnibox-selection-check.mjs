// Прогон выбора строки после пересборки списка омнибокса (shared/omniboxSelection.ts).
//
// ⚠️ Случай из жизни, ради которого модуль и появился. Список собирается ДВАЖДЫ на одно нажатие:
// сразу — история и вкладки, повторно — когда доедут живые подсказки поисковика, а им отведено до
// трёх секунд. Вторая сборка безусловно выставляла предвыбор и слала его в нативную вью, то есть
// забирала у человека его выбор: он ушёл стрелками на третью строку, через две секунды приехала
// сеть — и подсветка прыгнула обратно сама. Поймано живым драйвером омнибокса, который падал
// каждый раз по-разному и выглядел как «гонка в самом драйвере».
//
// ⚠️ Второй узел, менее очевидный: держаться за НОМЕР строки нельзя. Пересборка не дописывает
// список в конец, а собирает заново — сетевые подсказки встают между историей и поиском. Сохранив
// номер, человек остался бы на месте, где теперь стоит ДРУГАЯ строка, и Enter увёл бы не туда.
// Это хуже сброса: сброс хотя бы видно.
//
// Запуск: npm run omnibox-selection-check
import { selectionAfterRebuild, TYPED_ROW } from '../shared/omniboxSelection.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const L = (...urls) => urls.map((url) => ({ url }));
const SEQ = 7;

// Список до приезда сети: герой из истории, вкладка, строка поиска.
const BEFORE = L('https://habr.com/a', 'https://github.com/b', 'https://ya.ru/search?q=omni');
// Он же после: сетевые подсказки встали ПОСЕРЕДИНЕ, порядок сместился.
const AFTER = L('https://habr.com/a', 'https://ya.ru/s1', 'https://ya.ru/s2', 'https://github.com/b', 'https://ya.ru/search?q=omni');

console.log('\n— человек выбор не делал: работает предвыбор —');
check('предвыбор героя', selectionAfterRebuild(AFTER, 0, null, SEQ), 0);
check('без героя — набранная строка', selectionAfterRebuild(AFTER, TYPED_ROW, null, SEQ), TYPED_ROW);

console.log('\n— человек выбрал строку: сеть НЕ отбирает выбор —');
// ⚠️ Главный случай. Он стоял на github (номер 1), после пересборки эта строка стала третьей.
check('выбор переезжает вместе со строкой',
  selectionAfterRebuild(AFTER, 0, { seq: SEQ, url: 'https://github.com/b' }, SEQ), 3);
check('и не остаётся на прежнем номере',
  selectionAfterRebuild(AFTER, 0, { seq: SEQ, url: 'https://github.com/b' }, SEQ) === 1, false);
check('выбор на герое остаётся на герое',
  selectionAfterRebuild(AFTER, TYPED_ROW, { seq: SEQ, url: 'https://habr.com/a' }, SEQ), 0);
check('выбор на строке поиска переезжает в конец',
  selectionAfterRebuild(AFTER, 0, { seq: SEQ, url: 'https://ya.ru/search?q=omni' }, SEQ), 4);

console.log('\n— человек стоял на набранной строке —');
// ⚠️ Пустой url — это «выбрана сама набранная строка». Приезд подсказок не повод уводить его
// оттуда: Enter должен вести туда же, куда вёл бы без дропдауна вовсе.
check('остаётся на набранном', selectionAfterRebuild(AFTER, 0, { seq: SEQ, url: '' }, SEQ), TYPED_ROW);

console.log('\n— строка, на которой он стоял, исчезла —');
// ⚠️ Уводим на НАБРАННОЕ, а не на предвыбор: предвыбор означает «мы за вас решили, куда пойдёт
// Enter», и делать это молча в момент, когда из-под человека убрали строку, нельзя.
check('уводим на набранное, а не на героя',
  selectionAfterRebuild(BEFORE, 0, { seq: SEQ, url: 'https://ya.ru/s1' }, SEQ), TYPED_ROW);

console.log('\n— другое поколение запроса —');
// Человек набрал ещё букву: список стал про другое, держаться за прежнюю строку незачем.
check('прежний выбор не тянется в новый запрос',
  selectionAfterRebuild(AFTER, 0, { seq: SEQ - 1, url: 'https://github.com/b' }, SEQ), 0);
check('и без героя даёт набранное',
  selectionAfterRebuild(AFTER, TYPED_ROW, { seq: SEQ - 1, url: 'https://github.com/b' }, SEQ), TYPED_ROW);

console.log('\n— пределы —');
// ⚠️ Предвыбор приходит из другой части кода и рассчитан на список, который уже сменился: номер за
// пределами дал бы подсветку на строке, которой нет.
check('предвыбор за пределами списка гасится', selectionAfterRebuild(L('https://a'), 5, null, SEQ), TYPED_ROW);
check('пустой список — набранная строка', selectionAfterRebuild([], 0, null, SEQ), TYPED_ROW);
check('пустой список при выборе человека — тоже',
  selectionAfterRebuild([], 0, { seq: SEQ, url: 'https://github.com/b' }, SEQ), TYPED_ROW);
check('последняя строка списка достижима',
  selectionAfterRebuild(AFTER, AFTER.length - 1, null, SEQ), AFTER.length - 1);

console.log('\n— одинаковые адреса —');
// Дедуп в омнибоксе есть, но полагаться на него здесь нельзя: берём ПЕРВОЕ вхождение, чтобы
// результат не зависел от направления обхода.
check('берётся первое вхождение',
  selectionAfterRebuild(L('https://a', 'https://b', 'https://a'), 0, { seq: SEQ, url: 'https://a' }, SEQ), 0);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
