// Эталон цветовой машины окна (shared/chromeGround.ts): ВХОД → ТОЧНЫЙ ВЫХОД.
//
// Зачем отдельно от chrome-ground-check. Тот проверяет СМЫСЛ — «остров светлее земли», «контраст
// не ниже порога», «тон не уезжает по кругу больше HUE_MAX_SPREAD». Это правильные проверки, и
// трогать их не надо. Но они устроены как неравенства, а неравенству всё равно, 0.42 у него внутри
// или 0.43. Мутационный прогон это и показал: 843 мутанта, убито 39% — то есть больше половины
// чисел в цветовой машине можно было подвинуть, и ни один прогон бы не заметил. А подвинутое число
// здесь — это не падение, а «стало как-то не так»: земля чуть догнала остров, кромка окна
// разошлась с полосой кнопок Windows на полтона.
//
// ⚠️ Это ХАРАКТЕРИЗАЦИОННЫЙ эталон: числа сняты с работающего кода, а не выведены из спеки. Он не
// доказывает, что цвет правильный — он фиксирует, что цвет ТОТ ЖЕ, что человек уже видел и принял.
// Ровно тот же приём, что golden-инвентарь каналов в contract-check.
//
// ⚠️ Красная строка здесь — НЕ обязательно баг. Это значит «картинка поменялась»: если менял
// формулу осознанно — посмотри глазами и обнови эталон. Если не менял — поймал регрессию.
//
// Запуск: npm test -- chrome-ground-golden
//         node --experimental-strip-types scripts/chrome-ground-golden-check.mjs --update
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hexToRgb, rgbToHex, blend, rgba, relLuminance, contrast, rotateHue, lightnessOf, withLightness,
  groundTint, islandOver, deepestGround, buildChromeGround,
  parseHex, multiplyColors, retroSteps, retroRamp, mixFromSeeds, createMeshDraft,
  sampleMesh, meshIsLight, meshPaintLayers, compileMeshBackground, adaptMeshToTheme,
  meshCaptionTop, overlaySymbolColor, hslSaturation, hslToHex, hueOf,
  accentFromMesh, randomMesh, buildChromeGroundFromMesh, validateMesh, findBuiltinMesh,
  BUILTIN_MESHES,
  ISLAND_LIFT, ISLAND_TINT_LIGHT, HUE_MAX_SPREAD, CHROME_OVERLAY_PX,
  MESH_SEEDS_MIN, MESH_SEEDS_MAX, MESH_SOFTNESS_MIN, MESH_SOFTNESS_MAX,
  MESH_INTENSITY_DEFAULT, MESH_SOFTNESS_DEFAULT, RETRO_STEPS_MIN, RETRO_STEPS_MAX,
} from '../shared/chromeGround.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, 'fixtures', 'chrome-ground-golden.json');
const UPDATE = process.argv.includes('--update');

// Тона ровно те, что человек может выбрать в palettes.css, вместе со СВОЕЙ землёй.
const PALETTES = [
  ['уголь', '#007AFF', '#E9EAEF', '#FFFFFF'],
  ['графит', '#5B6B7A', '#E4E5E7', '#FFFFFF'],
  ['бумага', '#B08968', '#E8E2D5', '#FDFBF6'],
  ['мята', '#34A853', '#DEEAE2', '#FFFFFF'],
  ['небо', '#4285F4', '#DCE5F6', '#FFFFFF'],
];

// ⚠️ Сетка задана ЛИТЕРАЛОМ, а не через randomMesh: эталон обязан быть одним и тем же от прогона
// к прогону, иначе первая же красная строка окажется про генератор, а не про цвет.
const MESH = {
  id: 'golden', name: 'Эталон', kind: 'mesh',
  seeds: ['#2C4BD8', '#E8A33D', '#1F7A4C'],
  base: '#dfe3ee',
  blobs: [
    { color: '#2C4BD8', x: 18, y: 22, size: 62 },
    { color: '#E8A33D', x: 78, y: 30, size: 54 },
    { color: '#1F7A4C', x: 46, y: 84, size: 58 },
  ],
  intensity: 78,
  softness: 72,
};
const RETRO = { ...MESH, id: 'golden-retro', kind: 'retro' };
const DUPLEX = { ...MESH, id: 'golden-duplex', kind: 'duplex' };

// Свой генератор вместо Math.random: у случайной сетки эталона быть не может, а проверить
// её сборку надо — она собирает семена из hslToHex и уходит в mixFromSeeds.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const cases = [];
const add = (name, fn) => cases.push([name, fn]);

// ── разбор и сборка цвета ──────────────────────────────────────────────────────
add('hexToRgb #4285F4', () => hexToRgb('#4285F4'));
add('hexToRgb чёрный', () => hexToRgb('#000000'));
add('rgbToHex обратно', () => rgbToHex([66, 133, 244]));
add('rgbToHex зажимает выход за диапазон', () => rgbToHex([-20, 300, 128]));
for (const raw of ['4285f4', '#ABC', '#4285F4', 'rgb(1,2,3)', '', '#12345']) {
  add(`parseHex «${raw}»`, () => parseHex(raw));
}

// ── смешивание ─────────────────────────────────────────────────────────────────
for (const pct of [0, 12, 30, 50, 88, 100]) {
  add(`blend бело-чёрный ${pct}%`, () => blend('#FFFFFF', '#000000', pct));
}
add('blend тона с землёй', () => blend('#4285F4', '#E9EAEF', 12));
add('multiplyColors две краски', () => multiplyColors('#2C4BD8', '#E8A33D'));
add('multiplyColors с белым не меняет', () => multiplyColors('#2C4BD8', '#FFFFFF'));
for (const a of [0, 0.4, 1]) add(`rgba ${a}`, () => rgba('#4285F4', a));

// ── светлота, контраст, тон ────────────────────────────────────────────────────
for (const hex of ['#FFFFFF', '#000000', '#4285F4', '#B08968', '#1F7A4C']) {
  add(`relLuminance ${hex}`, () => relLuminance(hex));
  add(`lightnessOf ${hex}`, () => lightnessOf(hex));
  add(`hslSaturation ${hex}`, () => hslSaturation(hex));
  add(`hueOf ${hex}`, () => hueOf(hex));
}
add('contrast бело-чёрный', () => contrast('#FFFFFF', '#000000'));
add('contrast тон к земле', () => contrast('#4285F4', '#E9EAEF'));
add('contrast сам с собой', () => contrast('#4285F4', '#4285F4'));
for (const deg of [-30, 0, 30, 180, 400]) add(`rotateHue ${deg}°`, () => rotateHue('#4285F4', deg));
for (const l of [0, 0.24, 0.5, 0.86, 1]) add(`withLightness ${l}`, () => withLightness('#4285F4', l));
// ⚠️ Сетка по трём осям, а не три случайных тройки. У hslToHex внутри две развилки — серый при
// нулевой насыщенности и разная формула выше и ниже светлоты 0.5, — и на одиночных значениях обе
// проходят мимо: при l = 0.5 обе ветви дают один и тот же ответ, при s = 0 не важен тон.
for (const h of [0, 45, 120, 200, 300, 359, 400, -30]) {
  for (const s of [0, 0.2, 0.65, 1]) {
    for (const l of [0.15, 0.35, 0.5, 0.65, 0.9]) {
      add(`hslToHex ${h}/${s}/${l}`, () => hslToHex(h, s, l));
    }
  }
}

// ── земля окна из палитры ──────────────────────────────────────────────────────
for (const [name, tint, appBg, surface] of PALETTES) {
  for (const dark of [false, true]) {
    const theme = dark ? 'тёмная' : 'светлая';
    const bg = dark ? '#121214' : appBg;
    const surf = dark ? '#1C1C1E' : surface;
    add(`groundTint ${name}, ${theme}`, () => groundTint(tint, dark, bg));
    for (const amount of [0, 40, 100]) {
      const input = { tint, appBg: bg, amount, surface: surf, dark };
      add(`deepestGround ${name}, ${theme}, ${amount}%`, () => deepestGround(input));
      add(`buildChromeGround ${name}, ${theme}, ${amount}%`, () => buildChromeGround(input));
    }
    add(`islandOver ${name}, ${theme}`, () => islandOver(deepestGround({
      tint, appBg: bg, amount: 60, surface: surf, dark,
    }), tint, surf, dark));
  }
}

// ── сетка ──────────────────────────────────────────────────────────────────────
for (const [name, mesh] of [['mesh', MESH], ['retro', RETRO], ['duplex', DUPLEX]]) {
  add(`meshIsLight ${name}`, () => meshIsLight(mesh));
  add(`meshCaptionTop ${name}`, () => meshCaptionTop(mesh));
  add(`overlaySymbolColor ${name}`, () => overlaySymbolColor(meshCaptionTop(mesh)));
  add(`meshPaintLayers ${name}`, () => meshPaintLayers(mesh));
  add(`compileMeshBackground ${name}`, () => compileMeshBackground(mesh));
  // ⚠️ Сетка точек, а не пять углов. Прозрачность пятна считается тремя кусками — ядро, средняя
  // зона со своим наклоном и хвост до нуля, — и по углам читается только хвост: вся середина
  // формулы оставалась непроверенной.
  for (let x = 0; x <= 100; x += 20) {
    for (let y = 0; y <= 100; y += 20) {
      add(`sampleMesh ${name} ${x}/${y}`, () => sampleMesh(mesh, x, y));
    }
  }
  // Точки прицельно внутри пятен: центр, край ядра, середина спада.
  for (const [x, y] of [[18, 22], [26, 30], [34, 42], [78, 30], [86, 44], [46, 84], [46, 66]]) {
    add(`sampleMesh ${name} внутри пятна ${x}/${y}`, () => sampleMesh(mesh, x, y));
  }
  for (const dark of [false, true]) {
    add(`adaptMeshToTheme ${name}, ${dark ? 'тёмная' : 'светлая'}`, () => adaptMeshToTheme(mesh, dark));
    add(`accentFromMesh ${name}, ${dark ? 'тёмная' : 'светлая'}`, () => accentFromMesh(mesh, dark));
    add(`accentFromMesh ${name} с подсказкой земли, ${dark ? 'тёмная' : 'светлая'}`,
      () => accentFromMesh(mesh, dark, '#1F7A4C'));
    add(`buildChromeGroundFromMesh ${name}, ${dark ? 'тёмная' : 'светлая'}`,
      () => buildChromeGroundFromMesh(mesh, { tint: '#2C4BD8', appBg: dark ? '#121214' : '#E9EAEF', amount: 60, surface: dark ? '#1C1C1E' : '#FFFFFF', dark }));
  }
}
for (const softness of [40, 55, 72, 90]) add(`retroSteps ${softness}`, () => retroSteps(softness));
add('retroRamp эталонной ретро-сетки', () => retroRamp(RETRO));

// ⚠️ Вырожденные входы отдельно: одно семя добирается бумагой и чернилами до минимума, пустой
// список — тоже. Без этих случаев ветку добора можно было убрать целиком.
add('mixFromSeeds из одного семени', () => mixFromSeeds(['#2C4BD8']));
add('mixFromSeeds из пустого списка', () => mixFromSeeds([]));
add('mixFromSeeds отбрасывает лишние семена', () => mixFromSeeds(
  ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777']));
add('mixFromSeeds зажимает насыщенность и мягкость',
  () => mixFromSeeds(['#2C4BD8', '#E8A33D'], { intensity: 500, softness: -20 }));
add('createMeshDraft', () => createMeshDraft(['#2C4BD8', '#E8A33D']));
add('createMeshDraft ретро', () => createMeshDraft(['#2C4BD8', '#E8A33D'], 'Ретро', 'retro'));
// ⚠️ Несколько зёрен, а не одно: у случайной сетки развилка по числу семян (двойка или тройка),
// и на одном зерне вторая ветка вообще не исполняется.
for (const seed of [20260831, 7, 42, 999, 123456, 2, 31337]) {
  add(`randomMesh на зерне ${seed}`, () => randomMesh(lcg(seed)));
}

// ⚠️ «Светлая ли сетка» решается по нескольким точкам сразу, поэтому нужны сетки, у которых
// точки расходятся: на одной эталонной этот ответ не меняется никогда.
for (const [name, seeds] of [
  ['светлая', ['#F5EFE2', '#E8DCC8', '#FBF7EF']],
  ['тёмная', ['#14202E', '#1C1030', '#0E1A14']],
  ['пёстрая', ['#F5EFE2', '#14202E', '#E8A33D']],
]) {
  const m = createMeshDraft(seeds, name);
  add(`meshIsLight сетка «${name}»`, () => meshIsLight(m));
  add(`meshCaptionTop сетка «${name}»`, () => meshCaptionTop(m));
  add(`overlaySymbolColor сетка «${name}»`, () => overlaySymbolColor(meshCaptionTop(m)));
  // Подсказка земли с ПРОТИВОПОЛОЖНЫМ тоном: без неё родство с землёй в выборе акцента
  // ни на что не влияет, и всю поправку можно было выбросить.
  for (const hint of ['#1F7A4C', '#D8452C', '#2C4BD8', undefined]) {
    add(`accentFromMesh «${name}» при земле ${hint ?? 'без подсказки'}`,
      () => accentFromMesh(m, false, hint));
  }
}

// ── разбор сохранённого ────────────────────────────────────────────────────────
add('validateMesh принимает эталон', () => validateMesh(MESH));
add('validateMesh чинит отсутствующий kind', () => validateMesh({ ...MESH, kind: undefined }));
add('validateMesh отвергает мусор', () => validateMesh({ nope: 1 }));
add('validateMesh отвергает не объект', () => validateMesh('#fff'));
add('validateMesh отвергает одно семя', () => validateMesh({ ...MESH, seeds: ['#2C4BD8'] }));
// ⚠️ Границы длины идентификатора по обе стороны: сохранённый объект приходит ИЗ ФАЙЛА, то есть
// это недоверенный вход, а проверялся он только «нормальным» значением посередине.
add('validateMesh отвергает пустой id', () => validateMesh({ ...MESH, id: '' }));
add('validateMesh принимает id ровно в 64 знака', () => validateMesh({ ...MESH, id: 'x'.repeat(64) }));
add('validateMesh отвергает id в 65 знаков', () => validateMesh({ ...MESH, id: 'x'.repeat(65) }));
add('validateMesh отвергает id не строкой', () => validateMesh({ ...MESH, id: 7 }));
add('findBuiltinMesh несуществующий', () => findBuiltinMesh('нет такого'));

// Встроенный каталог градиентов: шесть готовых сеток, которые человек видит в настройках.
// Их координаты пятен не держало вообще ничто — сдвинутое пятно это другая картинка, а не сбой.
// Новая встроенная сетка обязана попасть сюда осознанно: без строки в эталоне прогон покраснеет.
add('состав встроенного каталога', () => BUILTIN_MESHES.map((m) => m.id));
for (const m of BUILTIN_MESHES) {
  add(`встроенная «${m.name}»`, () => findBuiltinMesh(m.id));
  add(`встроенная «${m.name}» — кромка окна`, () => meshCaptionTop(m));
  add(`встроенная «${m.name}» — светлая ли`, () => meshIsLight(m));
  add(`встроенная «${m.name}» — фон целиком`, () => compileMeshBackground(m));
}

// ── константы, на которые опирается вёрстка ────────────────────────────────────
// ⚠️ Тавтологией это не является: значения записаны литералами, а мутируется модуль.
add('константы', () => ({
  ISLAND_LIFT, ISLAND_TINT_LIGHT, HUE_MAX_SPREAD, CHROME_OVERLAY_PX,
  MESH_SEEDS_MIN, MESH_SEEDS_MAX, MESH_SOFTNESS_MIN, MESH_SOFTNESS_MAX,
  MESH_INTENSITY_DEFAULT, MESH_SOFTNESS_DEFAULT, RETRO_STEPS_MIN, RETRO_STEPS_MAX,
}));

// ── прогон ─────────────────────────────────────────────────────────────────────

const actual = {};
for (const [name, fn] of cases) {
  try {
    actual[name] = fn();
  } catch (e) {
    // Упавший случай — тоже наблюдение: мутант, роняющий функцию, обязан отличаться от эталона.
    actual[name] = { ОШИБКА: String(e && e.message ? e.message : e) };
  }
}

if (UPDATE) {
  fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
  fs.writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`);
  console.log(`\nЭталон переписан: ${cases.length} случаев → ${path.relative(process.cwd(), GOLDEN)}\n`);
  process.exit(0);
}

if (!fs.existsSync(GOLDEN)) {
  console.log('\n FAIL  эталона нет — создать: node --experimental-strip-types scripts/chrome-ground-golden-check.mjs --update\n');
  console.log('\nИтого: 0 прошло, 1 не прошло\n');
  process.exit(1);
}

const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));

let passed = 0;
let failed = 0;

function check(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(got)}\n         эталон   ${JSON.stringify(want)}`);
}

console.log('\n— вход → точный выход (эталон снят с работающего кода) —');
for (const [name] of cases) check(name, actual[name], golden[name]);

// ⚠️ Расхождение по СОСТАВУ случаев — тоже провал: иначе удалённый случай тихо перестал бы
// проверяться, а прогон остался бы зелёным.
const extra = Object.keys(golden).filter((k) => !(k in actual));
check('в эталоне нет случаев, которых больше нет в прогоне', extra, []);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
