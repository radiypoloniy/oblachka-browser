// Прогон раскладки загрузок по ярусам (shared/downloadGroups.ts) — обычным node.
//
// ⚠️ Правила тут ломаются ТИХО: список продолжает работать, просто однажды сегодняшний файл
// оказывается в «раньше», идущая загрузка проваливается из героя, а десять файлов с одного
// сайта снова ложатся десятью строками. Человек увидит не сбой, а «опять каша».
//
// Запуск: npm run download-groups-check (или npm test -- download)
import { groupDownloads, packBySite, TODAY_LIMIT } from '../shared/downloadGroups.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const NOW = 1_700_000_000_000;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Запись описываем минимально: id для сверки, сайт, состояние и время старта.
const e = (id, { site = 'a.com', state = 'completed', ago = 0, missing = false } = {}) => ({
  id, url: `https://${site}/file-${id}`, state, startedAt: NOW - ago,
  ...(missing ? { fileMissing: true } : {}),
});
const ids = (list) => list.map((x) => x.id);
const packIds = (packs) => packs.map((p) => [p.head.id, ...p.rest.map((r) => r.id)]);

console.log('— ярусы —');
{
  const t = groupDownloads([
    e('idet', { state: 'progressing' }),
    e('now1', { ago: 5 * MIN }),
    e('old1', { ago: 3 * DAY }),
    e('bad1', { state: 'interrupted', ago: 10 * MIN }),
  ], NOW);
  check('идущая — герой', t.active?.id ?? null, 'idet');
  check('свежее — в «сегодня»', packIds(t.today), [['now1']]);
  check('старое — в «раньше»', ids(t.older), ['old1']);
  check('прерванное — в «не получилось»', ids(t.failed), ['bad1']);
}

// ⚠️ Загрузка на два гигабайта живёт дольше суток. Если искать идущую только среди «сегодняшних»,
// она провалится в «раньше» — то есть исчезнет ровно в тот момент, когда за ней и следят.
check('идущая старше суток всё равно герой',
  groupDownloads([e('big', { state: 'progressing', ago: 2 * DAY })], NOW).active?.id ?? null, 'big');

check('идущих несколько — героем одна',
  groupDownloads([e('a', { state: 'progressing' }), e('b', { state: 'progressing' })], NOW).active?.id ?? null, 'a');

// Вторая идущая не должна пропасть совсем — она уходит в «сегодня» обычной строкой.
check('вторая идущая не теряется',
  packIds(groupDownloads([e('a', { state: 'progressing' }), e('b', { state: 'progressing' })], NOW).today),
  [['b']]);

check('пустой список — пустые ярусы',
  (() => { const t = groupDownloads([], NOW); return [t.active, t.today.length, t.older.length, t.failed.length]; })(),
  [null, 0, 0, 0]);

console.log('');
console.log('— пачка одного сайта —');
check('соседи одного сайта в пределах двух минут — одна пачка',
  packIds(packBySite([e('1'), e('2', { ago: 30 * 1000 }), e('3', { ago: 90 * 1000 })])),
  [['1', '2', '3']]);

check('тот же сайт, но через полчаса — отдельная загрузка',
  packIds(packBySite([e('1'), e('2', { ago: 30 * MIN })])),
  [['1'], ['2']]);

check('разные сайты рядом не склеиваются',
  packIds(packBySite([e('1', { site: 'a.com' }), e('2', { site: 'b.com' })])),
  [['1'], ['2']]);

// ⚠️ Считаем от ГОЛОВЫ пачки, а не от предыдущего соседа: иначе цепочка по две минуты каждый
// склеилась бы в одну пачку длиной в полчаса.
check('цепочка по две минуты не склеивается в бесконечную пачку',
  packIds(packBySite([e('1'), e('2', { ago: 2 * MIN }), e('3', { ago: 4 * MIN })])),
  [['1', '2'], ['3']]);

check('сайт возвращается позже — новая пачка, а не дописывание в старую',
  packIds(packBySite([e('1', { site: 'a.com' }), e('2', { site: 'b.com', ago: 10 * 1000 }), e('3', { site: 'a.com', ago: 20 * 1000 })])),
  [['1'], ['2'], ['3']]);

// Негодный адрес (file://, blob:) — просто нет группировки, а не падение.
check('адрес без хоста не склеивается ни с чем',
  packIds(packBySite([{ id: 'x', url: 'blob:whatever', state: 'completed', startedAt: NOW },
    { id: 'y', url: 'blob:whatever', state: 'completed', startedAt: NOW }])),
  [['x'], ['y']]);

console.log('');
console.log('— потолок «сегодня» —');
{
  // Потолок в ПАЧКАХ: четыре одиночные загрузки при лимите 3 дают три строки и одну в «раньше».
  const many = [e('1'), e('2', { site: 'b.com', ago: 10 * MIN }), e('3', { site: 'c.com', ago: 20 * MIN }), e('4', { site: 'd.com', ago: 30 * MIN })];
  const t = groupDownloads(many, NOW);
  check('в «сегодня» ровно потолок', t.today.length, TODAY_LIMIT);
  check('лишнее уехало в «раньше», не пропало', ids(t.older), ['4']);
}
{
  // ⚠️ Пачка занимает ОДНУ строку: архив из двадцати файлов не должен вытеснять одиночные
  // загрузки, иначе потолок съедается чужим «скачать всё».
  const pack = [e('p1'), e('p2', { ago: 10 * 1000 }), e('p3', { ago: 20 * 1000 }), e('p4', { ago: 30 * 1000 })];
  const t = groupDownloads([...pack, e('solo', { site: 'z.com', ago: 40 * MIN })], NOW);
  check('пачка из четырёх — одна строка, одиночная рядом видна',
    packIds(t.today), [['p1', 'p2', 'p3', 'p4'], ['solo']]);
  check('ничего не уехало в «раньше»', ids(t.older), []);
}

console.log('');
console.log('— граница суток и пропавшие файлы —');
check('ровно сутки — ещё «сегодня»',
  packIds(groupDownloads([e('edge', { ago: DAY })], NOW).today), [['edge']]);
check('сутки и секунда — уже «раньше»',
  ids(groupDownloads([e('edge', { ago: DAY + 1000 })], NOW).older), ['edge']);
check('файл пропал с диска — в «не получилось», а не в «сегодня»',
  ids(groupDownloads([e('gone', { missing: true, ago: 5 * MIN })], NOW).failed), ['gone']);
check('пропавший НЕ попадает в «сегодня»',
  packIds(groupDownloads([e('gone', { missing: true, ago: 5 * MIN })], NOW).today), []);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
