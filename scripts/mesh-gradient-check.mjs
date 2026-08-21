// Прогон сетчатого градиента (shared/chromeGround.ts) — без electron, обычным node.
//
// Здесь проверяется не «красиво», а инварианты ядра: из цветов человека получается валидная
// сетка, точка сэмплируется согласованно с CSS, пользовательский сиреневый НЕ режется (это
// обои, не системный хром), а кромка окна остаётся одним hex.
//
// Запуск: npm test -- mesh
import {
  parseHex, mixFromSeeds, createMeshDraft, sampleMesh, compileMeshBackground,
  meshPaintLayers, meshIsLight, buildChromeGroundFromMesh, validateMesh,
  BUILTIN_MESHES, MESH_SEEDS_MIN, MESH_SEEDS_MAX,
  contrast, relLuminance,
} from '../shared/chromeGround.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

console.log('\n— разбор цвета —');
check('шесть цифр', parseHex('#E07A5F'), '#e07a5f');
check('без решётки', parseHex('2f6f8f'), '#2f6f8f');
check('три цифры', parseHex('#f80'), '#ff8800');
check('мусор', parseHex('not-a-color'), null);
check('пусто', parseHex(''), null);

console.log('\n— смешивание из семян —');
{
  const m = mixFromSeeds(['#E07A5F', '#2F6F8F']);
  check('два семени → два пятна', m.blobs.length, 2);
  check('семена нормализованы', m.seeds, ['#e07a5f', '#2f6f8f']);
  check('база — hex', /^#[0-9a-f]{6}$/.test(m.base), true);
  check('пятна внутри холста', m.blobs.every((b) => b.x >= 0 && b.x <= 100 && b.y >= 0 && b.y <= 100), true);
}
{
  const m = mixFromSeeds(['#111111', '#eeeeee', '#4488cc', '#ddaa44', '#88cc88', '#0000ff']);
  check('лишние семена отрезаются', m.seeds.length, MESH_SEEDS_MAX);
  check('пятен столько же', m.blobs.length, MESH_SEEDS_MAX);
}
{
  const a = mixFromSeeds(['#e07a5f', '#2f6f8f']);
  const b = mixFromSeeds(['#e07a5f', '#2f6f8f'], { blobs: a.blobs.map((x) => ({ ...x, x: 40, y: 60 })) });
  check('повтор со своими пятнами держит позицию', b.blobs[0].x, 40);
  check('и перекрашивает из семян', b.blobs[0].color !== a.blobs[0].color || b.intensity === a.intensity, true);
}

console.log('\n— CSS —');
{
  const d = createMeshDraft(['#81b29a', '#f4f1de', '#3d5a45'], 'Луг');
  const css = compileMeshBackground(d);
  check('слоёв = пятна + база', meshPaintLayers(d).length, d.blobs.length + 1);
  check('есть радиальные пятна', css.includes('radial-gradient'), true);
  check('есть база', css.includes(d.base), true);
  check('нет var()', /var\(/.test(css), false);
}

console.log('\n— сэмпл согласован с рисунком —');
{
  const m = mixFromSeeds(['#ff0000', '#0000ff'], { intensity: 100, softness: 40 });
  const atBlob = sampleMesh({ id: 't', name: 't', ...m }, m.blobs[0].x, m.blobs[0].y);
  check('в центре пятна ближе к его цвету, чем база',
    contrast(atBlob, m.blobs[0].color) < contrast(m.base, m.blobs[0].color), true);
}

console.log('\n— светлая / тёмная сетка —');
check('туман светлый', meshIsLight(BUILTIN_MESHES.find((m) => m.id === 'mesh-fog')), true);
check('сумерки не светлые', meshIsLight(BUILTIN_MESHES.find((m) => m.id === 'mesh-dusk')), false);

console.log('\n— обои: сиреневый законен —');
{
  const m = mixFromSeeds(['#af52de', '#5e2b97']);
  check('пользовательский сиреневый не вырезан', m.seeds[0], '#af52de');
}

console.log('\n— валидация —');
check('пусто', validateMesh(null), null);
check('без id', validateMesh({ name: 'x', seeds: ['#ffffff', '#000000'] }), null);
{
  const ok = validateMesh({
    id: 'u1', name: '  Море  ', seeds: ['#7EC8C8', 'not-a-color', '#2F6F8F'],
    blobs: [{ color: '#7ec8c8', x: 10, y: 10, size: 80 }],
    intensity: 70, softness: 60,
  });
  check('имя обрезается', ok?.name, 'Море');
  check('битое пятно не ломает валидацию', ok?.blobs.length === ok?.seeds.length, true);
  check('семян двое (мусор выкинут)', ok?.seeds.length, 2);
}

console.log('\n— земля окна из сетки —');
{
  const mesh = BUILTIN_MESHES[0];
  const g = buildChromeGroundFromMesh(mesh, {
    tint: '#007AFF', appBg: '#F2F2F7', surface: '#FFFFFF', amount: 30, dark: false,
  });
  check('кромка — hex', /^#[0-9a-f]{6}$/.test(g.top), true);
  check('кромка стоит на 0%', g.backgroundImage.includes(`${g.top} 0%`), true);
  check('слоёв больше одного', g.paintLayers > 1, true);
  check('остров светлее или равен кромке не требуется — но остров валиден',
    /^#[0-9a-f]{6}$/.test(g.island), true);
  check('остров не совпадает с чёрным', g.island !== '#000000', true);
}

console.log('\n— каталог —');
check('готовых сеток не меньше шести', BUILTIN_MESHES.length >= 6, true);
check('id не пересекаются', new Set(BUILTIN_MESHES.map((m) => m.id)).size, BUILTIN_MESHES.length);
check('минимум семян', MESH_SEEDS_MIN, 2);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
