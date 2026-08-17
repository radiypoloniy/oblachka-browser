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
  buildChromeGround, deepestGround, groundTint, islandColor, withLightness,
  relLuminance, contrast, blend, rotateHue, hexToRgb, rgbToHex,
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
const TINTS_LIGHT = ['#007AFF', '#5B6B7A', '#5E81AC', '#B08968'];
const TINTS_DARK  = ['#0A84FF', '#7C8FA3', '#88C0D0', '#C9A227'];
const AMOUNTS = [6, 18, 30];

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
check('в светлой теме тон не притемняется',
  groundTint('#007AFF', false, relLuminance(islandColor('#007AFF', LIGHT.surface))), '#007AFF');

console.log('\n— тёмная тема: тон темнеет, но НЕ обесцвечивается —');
// ⚠️ Прежняя версия умножала каналы на долю — тон терял и светлоту, и цвет, тёмная земля выходила
// почти чёрной. Теперь светлота задаётся в HSL, а насыщенность сохраняется целиком.
for (const t of TINTS_DARK) {
  const island = islandColor(t, DARK.surface);
  const g = groundTint(t, true, relLuminance(island));
  check(`тон ${t} темнее острова`, relLuminance(g) < relLuminance(island), true);
  check(`тон ${t} сохранил насыщенность`, Math.abs(saturation(g) - saturation(t)) < 0.02, true);
}
check('«Сепия» без поправки была бы ярче земли', relLuminance('#C9A227') > relLuminance(DARK.appBg), true);
check('фиксированных 45% ей не хватило бы',
  relLuminance(rgbToHex(hexToRgb('#C9A227').map((v) => v * 0.45))) > relLuminance(DARK.appBg), true);

console.log('\n— ГЛАВНЫЙ ИНВАРИАНТ: остров светлее земли —');
// Перебираем всё, что человек может выставить: обе темы, оба края ползунка, тона всех палитр.
for (const dark of [false, true]) {
  const th = dark ? DARK : LIGHT;
  const tints = dark ? TINTS_DARK : TINTS_LIGHT;
  for (const tint of tints) {
    for (const amount of AMOUNTS) {
      const island = islandColor(tint, th.surface);
      const input = { tint, appBg: th.appBg, amount, islandLum: relLuminance(island), dark };
      const deepest = deepestGround(input);
      check(`${dark ? 'тёмная' : 'светлая'} ${tint} ${amount}% — земля НЕ светлее острова`,
        relLuminance(deepest) > relLuminance(island), false);
    }
  }
}

console.log('\n— верхняя кромка: она же уходит в полосу системных кнопок —');
{
  const island = islandColor('#007AFF', LIGHT.surface);
  const g = buildChromeGround({ tint: '#007AFF', appBg: LIGHT.appBg, amount: 30, islandLum: relLuminance(island), dark: false });
  // ⚠️ top обязан РЕАЛЬНО встречаться в разметке градиента на позиции 0%: если он разъедется с
  // нарисованным, полоса кнопок снова станет чужой заплаткой поверх окна.
  check('цвет кромки стоит в градиенте на 0%', g.backgroundImage.includes(`${g.top} 0%`), true);
  check('кромка — валидный hex', /^#[0-9a-f]{6}$/.test(g.top), true);
  // ⚠️ Ось строго вертикальная: только тогда цвет постоянен вдоль горизонтали и кромка определима.
  check('ось вертикальная (180deg)', g.backgroundImage.includes('linear-gradient(180deg'), true);
}

console.log('\n— рисунок —');
{
  const island = islandColor('#5E81AC', LIGHT.surface);
  const g = buildChromeGround({ tint: '#5E81AC', appBg: LIGHT.appBg, amount: 18, islandLum: relLuminance(island), dark: false });
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
