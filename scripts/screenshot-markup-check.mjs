// Прогон геометрии разметки снимка (shared/screenshotMarkup.ts).
// Эталон — литералы: иначе мутант двигает и формулу, и ожидание.
//
// Запуск: npm test -- screenshot-markup
import { SHOT_MARK, SHOT_TEXT, SHOT_FONT, mapContainPoint, mapContainCoords, rectFromPoints, clampRect, cropReady, MIN_CROP, PICK_PAD, expandCssRect, parseViewportFrac, viewportFracToShot, fracOverlapsView, frameCorners, resizeCrop, rotateCrop, moveCrop, ROTATE_GAP } from '../shared/screenshotMarkup.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

console.log('\n— цвет разметки —');
check('литерал danger-500, не акцент палитры', SHOT_MARK, '#FF3B30');
check('минимальный кроп', MIN_CROP, 16);

console.log('\n— object-fit contain, кадр 800×600 в коробке 400×400 —');
{
  const box = { width: 400, height: 400 };
  const nat = { width: 800, height: 600 };
  // scale = min(400/800, 400/600) = 0.5; displayed 400×300, поля сверху/снизу по 50.
  check('центр коробки → центр кадра', mapContainPoint(box, nat, { x: 200, y: 200 }), { x: 400, y: 300 });
  check('левый верх картинки', mapContainPoint(box, nat, { x: 0, y: 50 }), { x: 0, y: 0 });
  check('клик по верхнему полю — мимо', mapContainPoint(box, nat, { x: 200, y: 10 }), null);
  check('клик по нижнему полю — мимо', mapContainPoint(box, nat, { x: 200, y: 390 }), null);
}

console.log('\n— рамка из двух точек —');
check('тянули влево-вверх, стороны неотрицательны', rectFromPoints({ x: 80, y: 90 }, { x: 20, y: 30 }), { x: 20, y: 30, w: 60, h: 60 });
check('кроп 16×16 готов', cropReady({ x: 0, y: 0, w: 16, h: 16 }), true);
check('кроп 15×40 слишком мелкий', cropReady({ x: 0, y: 0, w: 15, h: 40 }), false);

console.log('\n— зажим в кадр —');
check('рамка за краем обрезается', clampRect({ x: 700, y: 500, w: 200, h: 200 }, { width: 800, height: 600 }), { x: 700, y: 500, w: 100, h: 100 });
check('целиком снаружи → ноль', clampRect({ x: 900, y: 0, w: 50, h: 50 }, { width: 800, height: 600 }), { x: 800, y: 0, w: 0, h: 50 });

console.log('\n— поле вокруг элемента —');
check('литерал поля', PICK_PAD, 10);
check('10 вокруг строки текста', expandCssRect({ x: 100, y: 50, w: 200, h: 20 }, 10, { width: 800, height: 600 }), { x: 90, y: 40, w: 220, h: 40 });
check('у края не уходит в минус', expandCssRect({ x: 2, y: 2, w: 10, h: 10 }, 10, { width: 800, height: 600 }), { x: 0, y: 0, w: 22, h: 22 });

console.log('\n— элемент: доли вьюпорта, не CSS×dpr —');
check('полкадра 800×600', viewportFracToShot({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, { width: 800, height: 600 }), { x: 80, y: 120, w: 400, h: 150 });
check('HiDPI 1600×1200 тот же кадр', viewportFracToShot({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, { width: 1600, height: 1200 }), { x: 160, y: 240, w: 800, h: 300 });
check('вылез за край — зажим', viewportFracToShot({ x: 0.9, y: 0.9, w: 0.2, h: 0.2 }, { width: 800, height: 600 }), { x: 720, y: 540, w: 80, h: 60 });
check('мусор → null', parseViewportFrac({ x: 0, y: 0, w: 'нет', h: 1 }), null);
check('нулевая рамка → null', parseViewportFrac({ x: 0, y: 0, w: 0, h: 10 }), null);
check('не объект → null', parseViewportFrac('window:1:0'), null);
check('пересечение с кадром', fracOverlapsView({ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }), true);
check('целиком выше вьюпорта — мимо', fracOverlapsView({ x: 0, y: -2, w: 1, h: 0.5 }), false);
check('частично за краем — ещё кадр', fracOverlapsView({ x: 0.9, y: 0.9, w: 0.3, h: 0.3 }), true);

console.log('\n— подпись —');
check('чернила нейтральный чёрный, не акцент', SHOT_TEXT, '#1C1C1E');
check('семейство Голос, не системный', SHOT_FONT, '"Golos Text", "Segoe UI", sans-serif');

console.log('\n— contain без отсечения —');
{
  const box = { width: 400, height: 400 };
  const nat = { width: 800, height: 600 };
  check('над картинкой — координата есть', mapContainCoords(box, nat, { x: 200, y: 10 }), { x: 400, y: -80 });
  check('клик по полю по-прежнему мимо', mapContainPoint(box, nat, { x: 200, y: 10 }), null);
}

console.log('\n— рамка кропа: углы, растяжение, поворот —');
{
  const f = { x: 10, y: 20, w: 40, h: 10, angle: 0 };
  check('угол 0, четыре угла', frameCorners(f), [
    { x: 10, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 30 }, { x: 10, y: 30 },
  ]);
  const box = { x: 0, y: 0, w: 100, h: 50, angle: 0 };
  check('se тянем в 120,80', resizeCrop(box, 'se', { x: 120, y: 80 }), { x: 0, y: 0, w: 120, h: 80, angle: 0 });
  check('nw тянем в 10,10', resizeCrop(box, 'nw', { x: 10, y: 10 }), { x: 10, y: 10, w: 90, h: 40, angle: 0 });
  check('мельче минимума не сжимается', resizeCrop(box, 'se', { x: 5, y: 5 }), { x: 0, y: 0, w: 16, h: 16, angle: 0 });
  const sq = { x: 0, y: 0, w: 100, h: 100, angle: 1 };
  check('ручка сверху → угол 0', rotateCrop(sq, { x: 50, y: 0 }).angle, 0);
  check('ручка справа → четверть оборота', rotateCrop(sq, { x: 100, y: 50 }).angle, Math.PI / 2);
  check('зазор ручки поворота', ROTATE_GAP, 28);
  check('сдвиг на 5,8', moveCrop({ x: 10, y: 10, w: 20, h: 20, angle: 0 }, { x: 0, y: 0 }, { x: 5, y: 8 }, { width: 200, height: 200 }), { x: 15, y: 18, w: 20, h: 20, angle: 0 });
  const spun = { x: 0, y: 0, w: 8, h: 4, angle: Math.PI / 2 };
  check('π/2, nw после поворота', {
    x: Math.round(frameCorners(spun)[0].x),
    y: Math.round(frameCorners(spun)[0].y),
  }, { x: 6, y: -2 });
}

console.log(`\nИтого: ${passed} ок, ${failed} провалено`);
process.exit(failed === 0 ? 0 : 1);
