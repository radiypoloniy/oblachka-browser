// Колоды и круг виджета «Карточки» (shared/cards.ts) — без electron, обычным node.
//
// Случаи из договорённости захода: английский первый, три гостя в базе, 2×2 — знание,
// 4×2 — выбор, 4×4 игры нет. Промах не прячется за «ещё».
//
// Запуск: npm test -- cards
import {
  DECKS, DECK_IDS, STARTER_DECK_SIZE, isDeckId, nextDeckId, cardsMode, boxOf, reviewQueue, applyAnswer,
  shuffle, choiceOptions,
} from '../shared/cards.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

console.log('\n— колоды —');
{
  check('английский первый', DECK_IDS[0], 'en');
  check('четыре языка', [...DECK_IDS], ['en', 'ja', 'fr', 'vi']);
  check('isDeckId чужой', isDeckId('de'), false);
  check('круг языков', [nextDeckId('en'), nextDeckId('ja'), nextDeckId('fr'), nextDeckId('vi')], ['ja', 'fr', 'vi', 'en']);
  for (const id of DECK_IDS) {
    const d = DECKS[id];
    check(`${id}: стартовый словарь`, d.cards.length, STARTER_DECK_SIZE);
    const fronts = d.cards.map((c) => c.front);
    check(`${id}: лица уникальны`, new Set(fronts).size, fronts.length);
    const backs = d.cards.map((c) => c.back);
    check(`${id}: обороты уникальны`, new Set(backs).size, backs.length);
    const ids = d.cards.map((c) => c.id);
    check(`${id}: id уникальны`, new Set(ids).size, ids.length);
    check(`${id}: обороты не пустые`, d.cards.every((c) => c.back.length > 0), true);
  }
  check('английское облако', DECKS.en.cards[0], { id: 'en-cloud', front: 'cloud', back: 'облако' });
  check('японское приветствие', DECKS.ja.cards[0].front, 'こんにちは');
  check('французское окно с диакритикой', DECKS.fr.cards.some((c) => c.front === 'fenêtre'), true);
  check('вьетнамское спасибо с диакритикой', DECKS.vi.cards.some((c) => c.front === 'cảm ơn'), true);
  check('имена для выбора, не коды', DECK_IDS.map((id) => DECKS[id].title), [
    'Английский', 'Японский', 'Французский', 'Вьетнамский',
  ]);
}

console.log('\n— размер выбирает игру —');
{
  check('2×2 — знание', cardsMode({ w: 2, h: 2 }), 'review');
  check('3×2 ещё знание: выборам нужна ширина 4', cardsMode({ w: 3, h: 2 }), 'review');
  check('4×2 — выбор', cardsMode({ w: 4, h: 2 }), 'choice');
  check('4×4 всё равно выбор: памяти в этом заходе нет', cardsMode({ w: 4, h: 4 }), 'choice');
}

console.log('\n— коробки —');
{
  check('нет записи — новая', boxOf(undefined, 'en-cloud'), 0);
  check('знаю', boxOf({ 'en-cloud': 2 }, 'en-cloud'), 2);
  check('мусор в сторе — как новая', boxOf({ 'en-cloud': 9 }, 'en-cloud'), 0);
  check('знаю с нуля', applyAnswer(true), 2);
  check('не знаю с нуля — учу, не «ещё» без коробки', applyAnswer(false), 1);
  check('учу и снова не знаю — остаётся учу', applyAnswer(false), 1);
  check('учу и знаю', applyAnswer(true), 2);
  const cards = DECKS.en.cards;
  check('пустой прогресс — весь круг', reviewQueue(cards, undefined).length, STARTER_DECK_SIZE);
  check('все знаю — круг пуст', reviewQueue(cards, Object.fromEntries(cards.map((c) => [c.id, 2]))).length, 0);
  check('одно знаю — остаток', reviewQueue(cards, { 'en-cloud': 2 }).length, STARTER_DECK_SIZE - 1);
}

console.log('\n— выбор перевода —');
{
  const deck = DECKS.en.cards;
  const card = deck[0];
  const seq = [0.9, 0.1, 0.4, 0.2, 0.8, 0.3, 0.5];
  let i = 0;
  const rand = () => seq[i++ % seq.length];
  const opts = choiceOptions(card, deck, rand);
  check('три варианта', opts.length, 3);
  check('верный оборот среди них', opts.includes(card.back), true);
  check('без повторов', new Set(opts).size, opts.length);
  const short = choiceOptions(card, [card, deck[1]], rand);
  check('короткая колода не выдумывает третий', short.length, 2);
  check('короткая всё же с верным', short.includes(card.back), true);
}

console.log('\n— перетасовка не теряет элементы —');
{
  const src = [1, 2, 3, 4, 5];
  const out = shuffle(src, () => 0.3);
  check('длина', out.length, 5);
  check('тот же набор', [...out].sort((a, b) => a - b), src);
  check('исходник не тронут', src, [1, 2, 3, 4, 5]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
