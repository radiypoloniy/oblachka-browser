// Запрос «вы это уже читали» (shared/relatedHistory.ts) — без electron, обычным node.
//
// Живые заголовки: на DTF «Diablo» в хвосте, первые 8 слов подряд его не берут;
// хвост сайта не должен становиться запросом; ролик даёт короткое имя BLIZZARD.
//
// Запуск: npm test -- related-history
import {
  relatedQueryFromTitle,
  stripSiteTail,
  RELATED_QUERY_MAX_TERMS,
  RELATED_QUERY_MIN_CHARS,
} from '../shared/relatedHistory.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  const ok = a === b;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${a}, ждали ${b}`);
}

function terms(title) {
  return relatedQueryFromTitle(title).split(' ').filter(Boolean);
}

const DTF = 'Караван, процедурная генерация локаций и рекордное количество классов: детали и концепт-арты Diablo V — Игры на DTF';
const KOD = 'Blizzard анонсировала Diablo V, шутер по StarCraft и первую за 23 года кампанию для Warcraft III';
const AFISHA = 'Blizzard анонсировала новую часть Diablo и мультсериал по вселенной - Афиша Daily';
const YT = 'BLIZZARD НАСТОЛЬКО ВЕРНУЛСЯ что я В ШОКЕ - YouTube';

check('лимит слов — 8', RELATED_QUERY_MAX_TERMS, 8);
check('минимум запроса — 4', RELATED_QUERY_MIN_CHARS, 4);

const dtfSeq = stripSiteTail(DTF)
  .split(/[\s\-_/|·•,.:;!?()[\]{}'"«»—–]+/)
  .map((t) => t.trim().toLowerCase())
  .filter((t) => t.length >= 3 && t !== 'и')
  .slice(0, 8);
check('первые 8 подряд с DTF Diablo не берут', dtfSeq.includes('diablo'), false);
check('наш запрос с DTF берёт diablo', terms(DTF).includes('diablo'), true);
check('dtf не длиннее 8 слов', terms(DTF).length <= 8, true);

check('kod.ru: blizzard', terms(KOD).includes('blizzard'), true);
check('kod.ru: diablo', terms(KOD).includes('diablo'), true);
check('kod.ru: starcraft', terms(KOD).includes('starcraft'), true);

check('афиша: blizzard', terms(AFISHA).includes('blizzard'), true);
check('афиша: diablo', terms(AFISHA).includes('diablo'), true);
check('афиша без имени сайта', terms(AFISHA).includes('афиша') || terms(AFISHA).includes('daily'), false);

check('ролик: blizzard', terms(YT).includes('blizzard'), true);
check('ролик без youtube', terms(YT).includes('youtube'), false);

check('хвост Госуслуги не запрос',
  relatedQueryFromTitle('Расчёт НДФЛ — Госуслуги').includes('госуслуги'), false);
check('пусто', relatedQueryFromTitle(''), '');
check('слишком короткое', relatedQueryFromTitle('Hi'), '');

console.log(`\n${passed} прошло, ${failed} провалов`);
process.exit(failed === 0 ? 0 : 1);
