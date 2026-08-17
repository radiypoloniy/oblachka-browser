// Прогон цветного фона окна (shared/chromeGround.ts) — без electron, обычным node.
//
// Здесь проверяется НЕ красота, а читаемость, и каждый случай оплачен переделкой:
//  • земля не должна догонять острова по светлоте — иначе адресная строка и кнопки превращаются
//    в пятна (живая жалоба: «кнопки потеряли объём и тупо начали теряться на фоне»);
//  • в ТЁМНОЙ теме тон палитры бывает ЯРЧЕ земли, и подмешивание выворачивает иерархию —
//    земля становится светлее островов, те читаются дырами;
//  • фиксированной поправки для тёмной не бывает: на синем работает, на жёлтой «Сепии» нет.
//
// Запуск: npm run chrome-ground-check
import {
  buildChromeGround, deepestGround, groundTint, islandColor,
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
const PATTERNS = ['blobs', 'dawn'];
const AMOUNTS = [6, 18, 30];

console.log('\n— цвет: основа —');
check('hex → rgb → hex без потерь', rgbToHex(hexToRgb('#5E81AC')), '#5e81ac');
check('смешивание на 0% отдаёт основу', blend('#000000', '#F2F2F7', 0), '#f2f2f7');
check('смешивание на 100% отдаёт примесь', blend('#000000', '#F2F2F7', 100), '#000000');
check('белый ярче чёрного', relLuminance('#FFFFFF') > relLuminance('#000000'), true);
check('контраст белого и чёрного — 21', Math.round(contrast('#FFFFFF', '#000000')), 21);
check('поворот на 360° возвращает тот же тон', rotateHue('#007AFF', 360), '#007aff');
check('поворот серого ничего не меняет', rotateHue('#808080', 90), '#808080');

console.log('\n— светлая тема: тон берётся как есть —');
check('в светлой теме тон не притемняется', groundTint('#007AFF', LIGHT.appBg, false), '#007AFF');

console.log('\n— тёмная тема: тон притемняется ДО СВЕТИМОСТИ земли —');
// ⚠️ Тот самый случай, ради которого поправку нельзя было отдавать ползунком: «Сепия» ярче земли
// в разы, и фиксированные 45% её не спасают.
for (const t of TINTS_DARK) {
  const g = groundTint(t, DARK.appBg, true);
  check(`тон ${t} стал не ярче земли`, relLuminance(g) <= relLuminance(DARK.appBg), true);
}
check('«Сепия» без поправки была бы ярче земли', relLuminance('#C9A227') > relLuminance(DARK.appBg), true);
check('фиксированных 45% ей не хватило бы',
  relLuminance(rgbToHex(hexToRgb('#C9A227').map((v) => v * 0.45))) > relLuminance(DARK.appBg), true);

console.log('\n— ГЛАВНЫЙ ИНВАРИАНТ: остров светлее земли —');
// Перебираем всё, что человек может выставить: обе темы, оба рисунка, оба края ползунка.
for (const dark of [false, true]) {
  const th = dark ? DARK : LIGHT;
  const tints = dark ? TINTS_DARK : TINTS_LIGHT;
  for (const tint of tints) {
    for (const pattern of PATTERNS) {
      for (const amount of AMOUNTS) {
        const input = { tint, appBg: th.appBg, amount, pattern, dark };
        const island = islandColor(tint, th.surface);
        const deepest = deepestGround(input);
        const inverted = relLuminance(deepest) > relLuminance(island);
        check(`${dark ? 'тёмная' : 'светлая'} ${tint} ${pattern} ${amount}% — земля НЕ светлее острова`,
          inverted, false);
      }
    }
  }
}

console.log('\n— верхняя кромка: она же уходит в полосу системных кнопок —');
for (const pattern of PATTERNS) {
  const g = buildChromeGround({ tint: '#007AFF', appBg: LIGHT.appBg, amount: 30, pattern, dark: false });
  // ⚠️ top обязан РЕАЛЬНО встречаться в разметке градиента на позиции 0%: если он разъедется с
  // нарисованным, полоса кнопок снова станет чужой заплаткой поверх окна.
  check(`${pattern}: цвет кромки стоит в градиенте на 0%`, g.backgroundImage.includes(`${g.top} 0%`), true);
  // ⚠️ transparent — это прозрачный ЧЁРНЫЙ: градиент к нему идёт через серое и даёт грязную кайму
  // с видимым кольцом по краю пятна. Гасить обязаны альфой ТОГО ЖЕ цвета.
  check(`${pattern}: нет гашения в transparent`, g.backgroundImage.includes('transparent'), false);
  check(`${pattern}: кромка — валидный hex`, /^#[0-9a-f]{6}$/.test(g.top), true);
}

console.log('\n— рисунок собирается —');
for (const pattern of PATTERNS) {
  const g = buildChromeGround({ tint: '#5E81AC', appBg: LIGHT.appBg, amount: 18, pattern, dark: false });
  check(`${pattern}: есть linear-gradient`, g.backgroundImage.includes('linear-gradient'), true);
  check(`${pattern}: нет анимаций и переменных`,
    !/animation|var\(|calc\(/.test(g.backgroundImage), true);
}
check('пятен ровно три', (buildChromeGround({ tint: '#007AFF', appBg: LIGHT.appBg, amount: 18, pattern: 'blobs', dark: false })
  .backgroundImage.match(/radial-gradient/g) || []).length, 3);
check('у «рассвета» пятен нет',
  buildChromeGround({ tint: '#007AFF', appBg: LIGHT.appBg, amount: 18, pattern: 'dawn', dark: false })
    .backgroundImage.includes('radial-gradient'), false);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
