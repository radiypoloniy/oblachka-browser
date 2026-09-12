// Прогон геометрии разметки снимка (shared/screenshotMarkup.ts).
// Эталон — литералы: иначе мутант двигает и формулу, и ожидание.
//
// Запуск: npm test -- screenshot-markup
import { SHOT_MARK, mapContainPoint, rectFromPoints, clampRect, cropReady, MIN_CROP, parseViewportFrac, viewportFracToShot } from '../shared/screenshotMarkup.ts';

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

console.log('\n— элемент: доли вьюпорта, не CSS×dpr —');
check('полкадра 800×600', viewportFracToShot({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, { width: 800, height: 600 }), { x: 80, y: 120, w: 400, h: 150 });
check('HiDPI 1600×1200 тот же кадр', viewportFracToShot({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, { width: 1600, height: 1200 }), { x: 160, y: 240, w: 800, h: 300 });
check('вылез за край — зажим', viewportFracToShot({ x: 0.9, y: 0.9, w: 0.2, h: 0.2 }, { width: 800, height: 600 }), { x: 720, y: 540, w: 80, h: 60 });
check('мусор → null', parseViewportFrac({ x: 0, y: 0, w: 'нет', h: 1 }), null);
check('нулевая рамка → null', parseViewportFrac({ x: 0, y: 0, w: 0, h: 10 }), null);
check('не объект → null', parseViewportFrac('window:1:0'), null);

console.log(`\nИтого: ${passed} ок, ${failed} провалено`);
process.exit(failed === 0 ? 0 : 1);
