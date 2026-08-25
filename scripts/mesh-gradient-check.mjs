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
  contrast, relLuminance, adaptMeshToTheme, accentFromMesh, randomMesh,
  overlaySymbolColor, CHROME_OVERLAY_PX,
  multiplyColors, retroSteps, retroRamp, RETRO_STEPS_MIN, RETRO_STEPS_MAX, hueOf,
  MESH_SOFTNESS_MIN, MESH_SOFTNESS_MAX,
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
  check('кромка стоит на 0px (высота полосы Windows)', g.backgroundImage.includes(`${g.top} 0px`), true);
  check('слоёв больше одного', g.paintLayers > 1, true);
  check('остров светлее или равен кромке не требуется — но остров валиден',
    /^#[0-9a-f]{6}$/.test(g.island), true);
  check('остров не совпадает с чёрным', g.island !== '#000000', true);
  check('кромка держится на высоте полосы Windows', g.backgroundImage.includes(`${CHROME_OVERLAY_PX}px`), true);
}

console.log('\n— сетка под тему —');
{
  const mesh = mixFromSeeds(['#e07a5f', '#2f6f8f', '#f1e3d3']);
  const full = { id: 't', name: 't', ...mesh };
  const light = adaptMeshToTheme(full, false);
  const dark = adaptMeshToTheme(full, true);
  check('семена не переписываются', light.seeds, full.seeds);
  check('тёмная атмосфера темнее светлой', relLuminance(dark.base) < relLuminance(light.base), true);
  check('акцент в светлой держит белый текст', contrast(accentFromMesh(full, false), '#FFFFFF') >= 4.5, true);
}

console.log('\n— кромка Windows —');
check('на светлой кромке тёмные символы', overlaySymbolColor('#efe8dc'), '#3C3C43');
check('на тёмной кромке светлые символы', overlaySymbolColor('#141216'), '#EBEBF5');

console.log('\n— случайная гармония —');
{
  let i = 0;
  const seq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.15, 0.25, 0.35];
  const rand = () => seq[i++ % seq.length];
  const a = randomMesh(rand);
  i = 0;
  const b = randomMesh(rand);
  check('детерминированный rng воспроизводится', a.seeds, b.seeds);
  check('случайный — не меньше двух семян', a.seeds.length >= 2, true);
}

console.log('\n— каталог —');
check('готовых сеток не меньше шести', BUILTIN_MESHES.length >= 6, true);
check('id не пересекаются', new Set(BUILTIN_MESHES.map((m) => m.id)).size, BUILTIN_MESHES.length);
check('минимум семян', MESH_SEEDS_MIN, 2);

console.log('');
console.log('— режимы: дуплекс —');
{
  // Печать в две краски: там, где вторая легла на первую, цвет — их ПРОИЗВЕДЕНИЕ, а не смесь.
  check('произведение темнее обеих красок',
    relLuminance(multiplyColors('#E9BE1E', '#C63F3E')) < Math.min(
      relLuminance('#E9BE1E'), relLuminance('#C63F3E')), true);
  check('белый не меняет краску', multiplyColors('#FFFFFF', '#E8611C'), '#e8611c');
  check('чёрный поглощает', multiplyColors('#000000', '#E8611C'), '#000000');

  const duplex = createMeshDraft(['#E9BE1E', '#C63F3E'], 'Дуплекс', 'duplex');
  // База дуплекса — ПЕРВАЯ краска целиком: это лист, на который печатают.
  check('база — первая краска', duplex.base, '#e9be1e');
  check('режим сохранён', duplex.kind, 'duplex');
  check('пятно темнее базы', relLuminance(duplex.blobs[0].color) < relLuminance(duplex.base), true);

  // ⚠️ Круг «сохранили → прочитали» обязан вернуть тот же режим: иначе градиент человека после
  // перезапуска нарисуется сеткой, а он собирал дуплекс.
  check('режим переживает валидацию', validateMesh({ ...duplex, id: 'u1' }).kind, 'duplex');
  check('незнакомый режим читается как сетка', validateMesh({ ...duplex, id: 'u2', kind: 'ризограф' }).kind, 'mesh');
  check('отсутствие режима — сетка', validateMesh({ id: 'u3', name: 'x', seeds: ['#E8611C', '#1F5E52'] }).kind, 'mesh');
}

console.log('');
console.log('— режимы: ретро —');
{
  const retro = createMeshDraft(['#E8611C', '#1F5E52'], 'Ретро', 'retro');
  check('база — само первое семя', retro.base, '#e8611c');
  const ramp = retroRamp(retro);
  check('ступеней столько, сколько обещает retroSteps', ramp.length, retroSteps(retro.softness));
  check('ступени идут от светлого к тёмному',
    ramp.every((c, i) => i === 0 || relLuminance(c) < relLuminance(ramp[i - 1])), true);
  check('число ступеней в границах',
    retroSteps(MESH_SOFTNESS_MIN) === RETRO_STEPS_MIN && retroSteps(MESH_SOFTNESS_MAX) === RETRO_STEPS_MAX, true);

  // ⚠️ Ступени — ЖЁСТКИЕ границы, поэтому слой ровно один и это linear-gradient, а не пятна.
  const layers = meshPaintLayers(retro);
  check('ретро рисуется одним слоем', layers.length, 1);
  check('и это линейный градиент', layers[0].startsWith('linear-gradient('), true);

  // ⚠️ Кромка окна читается через sampleMesh: без ветки ретро она брала бы base, то есть цвет
  // ОДНОЙ ступени, и кнопки Windows оказались бы не в цвет окна.
  check('верх светлее низа', relLuminance(sampleMesh(retro, 50, 2)) > relLuminance(sampleMesh(retro, 50, 98)), true);
  check('точка совпадает со ступенью', ramp.includes(sampleMesh(retro, 50, 50)), true);

  // ⚠️ Тема применяется через base: семена трогать нельзя (см. «семена не переписываются»).
  // ⚠️ Семя берётся СВЕТЛОЕ намеренно: тёмная тема зажимает светлоту в 0.20…0.56, и мандарин
  // (0.51) в этот коридор уже попадает — на нём адаптация не видна вовсе, и случай проверял бы
  // не то. Поймано этой же проверкой при первом прогоне.
  const pale = createMeshDraft(['#C6F09A', '#1F5E52'], 'Ретро светлый', 'retro');
  const darkened = adaptMeshToTheme(pale, true);
  check('тёмная тема гасит ступени',
    relLuminance(retroRamp(darkened)[0]) < relLuminance(retroRamp(pale)[0]), true);
  check('а семена остаются прежними', darkened.seeds, pale.seeds);
  // Семя внутри коридора темы не трогается — иначе тон уезжал бы при каждом переключении.
  check('мандарин в тёмной теме не меняется', adaptMeshToTheme(retro, true).base, retro.base);
}

console.log('');
console.log('— акцент сетки в родстве с землёй —');
{
  // ⚠️ Случай из жизни: зелёно-оранжевая сетка давала мятную землю хрома и РОЗОВЫЙ акцент, потому
  // что оранжевое семя насыщеннее зелёного. Переключатель «Вкладки/Закладки» оказывался розовым
  // на зелёном окне.
  const mesh = createMeshDraft(['#3EB489', '#E8611C'], 'Зелень и мандарин');
  const nearGreen = accentFromMesh(mesh, false, '#2E6B57');
  const nearOrange = accentFromMesh(mesh, false, '#C2521A');
  const gap = (a, b) => { const d = Math.abs(hueOf(a) - hueOf(b)) % 360; return d > 180 ? 360 - d : d; };
  check('на зелёной земле акцент зелёный', gap(nearGreen, '#3EB489') < 40, true);
  check('на оранжевой земле акцент оранжевый', gap(nearOrange, '#E8611C') < 40, true);
  // Без подсказки поведение прежнее — самый насыщенный цвет.
  check('без подсказки берётся самый насыщенный', gap(accentFromMesh(mesh, false), '#E8611C') < 40, true);
  // ⚠️ Акцент обязан остаться ЦВЕТНЫМ: обесцвеченный не отличит выбранную вкладку от обычной.
  check('акцент не сереет', hueOf(nearGreen) > 0, true);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
