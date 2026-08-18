// Прогон цветного фона окна (shared/chromeGround.ts) — без electron, обычным node.
//
// Здесь проверяется НЕ красота, а читаемость, и каждый случай оплачен переделкой:
//  • земля не должна догонять острова по светлоте — иначе адресная строка и кнопки превращаются
//    в пятна (живая жалоба: «кнопки потеряли объём и тупо начали теряться на фоне»);
//  • в ТЁМНОЙ теме тон палитры бывает ЯРЧЕ земли, и подмешивание выворачивает иерархию —
//    земля становится светлее островов, те читаются дырами;
//  • фиксированной поправки для тёмной не бывает: на синем работает, на жёлтой «Сепии» нет;
//  • притемнять умножением каналов нельзя — тон теряет цвет, и тёмная земля выходит невзрачной.
//
// Запуск: npm run chrome-ground-check
import {
  buildChromeGround, deepestGround, groundTint, withLightness, ISLAND_LIFT,
  relLuminance, contrast, blend, rotateHue, hexToRgb, rgbToHex, HUE_MAX_SPREAD,
} from '../shared/chromeGround.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

// Тона из palettes.css и базовой темы — ровно те, что человек может выбрать.
const LIGHT = { appBg: '#F2F2F7', surface: '#FFFFFF' };
const DARK  = { appBg: '#121214', surface: '#1C1C1E' };
// ⚠️ Тон берётся ВМЕСТЕ СО СВОЕЙ ЗЕМЛЁЙ, а не с землёй базовой темы. Палитра переопределяет
// --app-bg и --surface, и считать её тон по чужому фону — значит проверять сочетание, которого у
// человека не бывает. Поймано на «Мяте»: по базовому #F2F2F7 её ступени расходились по тону
// сильнее порога, по собственному #E9F2EC — укладываются с запасом.
const PALETTES_LIGHT = [
  { tint: '#007AFF', appBg: '#F2F2F7', surface: '#FFFFFF' }, // Уголь
  { tint: '#5B6B7A', appBg: '#ECECEC', surface: '#FFFFFF' }, // Графит
  { tint: '#5E81AC', appBg: '#E5E9F0', surface: '#FFFFFF' }, // Сланец
  { tint: '#B08968', appBg: '#F1EDE4', surface: '#FDFBF6' }, // Бумага
  { tint: '#34A853', appBg: '#E9F2EC', surface: '#FFFFFF' }, // Мята
  { tint: '#4285F4', appBg: '#E8EEFA', surface: '#FFFFFF' }, // Небо
];
const PALETTES_DARK = [
  { tint: '#0A84FF', appBg: '#121214', surface: '#1C1C1E' },
  { tint: '#7C8FA3', appBg: '#1E1E1E', surface: '#2C2C2C' },
  { tint: '#88C0D0', appBg: '#2E3440', surface: '#3B4252' },
  { tint: '#C9A227', appBg: '#14120F', surface: '#1C1917' },
  { tint: '#81C995', appBg: '#101613', surface: '#18201B' },
  { tint: '#8AB4F8', appBg: '#0F1319', surface: '#171C24' },
];
const TINTS_LIGHT = PALETTES_LIGHT.map((p) => p.tint);
const TINTS_DARK = PALETTES_DARK.map((p) => p.tint);
const AMOUNTS = [6, 18, 30];

/** Оттенок HSL в градусах. Нужен запрету сиреневого: сектор задаётся именно углом. */
function hueOf(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const d = mx - mn;
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h / 6) * 360);
}

// Насыщенность HSL — ею и меряем «не обесцветился ли тон».
function saturation(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const l = (mx + mn) / 2;
  return l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
}

console.log('\n— цвет: основа —');
check('hex → rgb → hex без потерь', rgbToHex(hexToRgb('#5E81AC')), '#5e81ac');
check('смешивание на 0% отдаёт основу', blend('#000000', '#F2F2F7', 0), '#f2f2f7');
check('смешивание на 100% отдаёт примесь', blend('#000000', '#F2F2F7', 100), '#000000');
check('белый ярче чёрного', relLuminance('#FFFFFF') > relLuminance('#000000'), true);
check('контраст белого и чёрного — 21', Math.round(contrast('#FFFFFF', '#000000')), 21);
check('поворот на 360° возвращает тот же тон', rotateHue('#007AFF', 360), '#007aff');
check('поворот серого ничего не меняет', rotateHue('#808080', 90), '#808080');
check('светлота задаётся, оттенок держится',
  Math.abs(saturation(withLightness('#007AFF', 0.24)) - saturation('#007AFF')) < 0.01, true);

console.log('\n— светлая тема: тон берётся как есть —');
check('в светлой теме тон не притемняется', groundTint('#007AFF', false), '#007AFF');

console.log('\n— тёмная тема: тон темнеет, но НЕ обесцвечивается —');
// ⚠️ Прежняя версия умножала каналы на долю — тон терял и светлоту, и цвет, тёмная земля выходила
// почти чёрной. Теперь светлота задаётся в HSL, а насыщенность сохраняется целиком.
for (const t of TINTS_DARK) {
  const g = groundTint(t, true);
  check(`тон ${t} стал темнее исходного`, relLuminance(g) < relLuminance(t), true);
  check(`тон ${t} сохранил насыщенность`, Math.abs(saturation(g) - saturation(t)) < 0.02, true);
}
check('«Сепия» без поправки была бы ярче земли', relLuminance('#C9A227') > relLuminance(DARK.appBg), true);
check('фиксированных 45% ей не хватило бы',
  relLuminance(rgbToHex(hexToRgb('#C9A227').map((v) => v * 0.45))) > relLuminance(DARK.appBg), true);

console.log('\n— ВИДИМОСТЬ: в тёмной теме земля обязана читаться —');
// ⚠️ Самый живучий дефект этого фона: он «есть» по коду и невидим глазом. Дважды правился и дважды
// оставался невидимым — 1,038 в первый раз и 1,09–1,14 во второй, причём НА МАКСИМУМЕ ползунка.
// Поэтому видимость здесь — число, а не мнение: порог 1,35 к фону на верхнем краю ползунка.
for (const { tint, appBg, surface } of PALETTES_DARK) {
  const at = (amount) => buildChromeGround({ tint, appBg, surface, amount, dark: true });
  const full = at(30);
  const low = at(6);
  check(`${tint} на максимуме отличим от фона (≥1.35)`, contrast(full.top, appBg) >= 1.35, true);
  // Обратный край: ползунок обязан что-то значить, иначе «6%» и «30%» одинаковы.
  check(`${tint} на минимуме остаётся сдержанным (≤1.25)`, contrast(low.top, appBg) <= 1.25, true);
  check(`${tint} — ползунок двигает землю монотонно`,
    contrast(low.top, appBg) < contrast(at(18).top, appBg)
      && contrast(at(18).top, appBg) < contrast(full.top, appBg), true);
  // Ход по оттенку тоже должен быть виден: без него «градиент» — просто заливка.
  const stops = full.backgroundImage.match(/#[0-9a-f]{6}/g);
  check(`${tint} — верх и низ градиента различимы (≥1.1)`, contrast(stops[0], stops[2]) >= 1.1, true);
}

console.log('\n— ЦВЕТОВОЙ ЗАКОН: земля держится тона палитры —');
// ⚠️ Земля — СГЕНЕРИРОВАННЫЙ цвет, а запрет фиолетового распространяется и на такие (см. CLAUDE.md
// и разбор siteTint.ts).
//
// ⚠️ Одного запрета сектора 250–310° оказалось МАЛО, и это стоило живой жалобы «палитра в
// настройках выглядит уродливо». Поворот ступеней доходил до +30°: синий 211° садился на 242° —
// формально не сиреневый, а глазом ровно он; «Сепия» 46° уезжала на 76°, то есть в болотную
// зелень. Поэтому меряем САМ СДВИГ от тона палитры: чужой цвет в градиенте не появляется вовсе,
// в какой бы сектор он ни метил.
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
for (const [dark, palettes] of [[false, PALETTES_LIGHT], [true, PALETTES_DARK]]) {
  for (const { tint, appBg, surface } of palettes) {
    const stops = buildChromeGround({ tint, appBg, surface, amount: 30, dark })
      .backgroundImage.match(/#[0-9a-f]{6}/g);
    const label = `${dark ? 'тёмная' : 'светлая'} ${tint}`;
    check(`${label} — сиреневых ступеней нет`, stops.map(hueOf).filter((h) => h >= 250 && h <= 310), []);
    const hues = stops.map(hueOf);
    const spread = Math.max(...hues.map((a) => Math.max(...hues.map((b) => hueGap(a, b)))));
    check(`${label} — разброс тона по ступеням ≤ ${HUE_MAX_SPREAD}°`, spread <= HUE_MAX_SPREAD, true);
  }
}

console.log('\n— ГЛАВНЫЙ ИНВАРИАНТ: остров светлее земли —');
// Перебираем всё, что человек может выставить: обе темы, оба края ползунка, тона всех палитр.
for (const dark of [false, true]) {
  const palettes = dark ? PALETTES_DARK : PALETTES_LIGHT;
  for (const { tint, appBg, surface } of palettes) {
    for (const amount of AMOUNTS) {
      const input = { tint, appBg, surface, amount, dark };
      const deepest = deepestGround(input);
      const island = buildChromeGround(input).island;
      // Универсальный инвариант: остров ВСЕГДА светлее самого насыщенного места земли.
      check(`${dark ? 'тёмная' : 'светлая'} ${tint} ${amount}% — остров светлее земли`,
        relLuminance(island) > relLuminance(deepest), true);
      // ⚠️ В тёмной теме этого мало: там всё сжато у нуля, и «просто светлее» на глаз не читается.
      // Подъём строится явно (см. islandOver), поэтому и проверяем его числом.
      if (dark) check(`  и поднят не меньше чем в ${ISLAND_LIFT} раза`,
        contrast(island, deepest) >= ISLAND_LIFT * 0.98, true);
    }
  }
}

console.log('\n— верхняя кромка: она же уходит в полосу системных кнопок —');
{
  const g = buildChromeGround({ tint: '#007AFF', appBg: LIGHT.appBg, surface: LIGHT.surface, amount: 30, dark: false });
  // ⚠️ top обязан РЕАЛЬНО встречаться в разметке градиента на позиции 0%: если он разъедется с
  // нарисованным, полоса кнопок снова станет чужой заплаткой поверх окна.
  check('цвет кромки стоит в градиенте на 0%', g.backgroundImage.includes(`${g.top} 0%`), true);
  check('кромка — валидный hex', /^#[0-9a-f]{6}$/.test(g.top), true);
  // ⚠️ Ось строго вертикальная: только тогда цвет постоянен вдоль горизонтали и кромка определима.
  check('ось вертикальная (180deg)', g.backgroundImage.includes('linear-gradient(180deg'), true);
}

console.log('\n— рисунок —');
{
  const g = buildChromeGround({ tint: '#5E81AC', appBg: LIGHT.appBg, surface: LIGHT.surface, amount: 18, dark: false });
  check('нет анимаций и переменных', !/animation|var\(|calc\(/.test(g.backgroundImage), true);
  // ⚠️ transparent — это прозрачный ЧЁРНЫЙ: градиент к нему идёт через серое и даёт грязную кайму.
  check('нет гашения в transparent', g.backgroundImage.includes('transparent'), false);
  // ⚠️ Радиальных пятен здесь БЫТЬ НЕ ДОЛЖНО: на размер окна они ложились видимыми кольцами —
  // большой радиальный градиент с малой разницей цвета в 8-битном sRGB, и зерно их не спасало.
  check('радиальных пятен нет', g.backgroundImage.includes('radial-gradient'), false);
  check('три ступени', (g.backgroundImage.match(/#[0-9a-f]{6}/g) || []).length, 3);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
