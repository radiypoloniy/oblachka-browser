// Прогон геометрии оформленного снимка (shared/screenshotDecorate.ts) — без electron, обычным node.
//
// Зачем: подложка и доли поля/радиуса — то, из-за чего кадр чернел в Telegram (альфа) или
// выглядел «жиже macOS» на HiDPI. Эталон — литералы рядом с инвариантом, иначе мутант сдвигает
// обе стороны равенства (см. CLAUDE.md про chrome-ground-golden).
//
// Запуск: npm test -- screenshot-decorate
import { SHOT_PAPER, shotFrame } from '../shared/screenshotDecorate.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

console.log('\n— бумага —');
check('литерал светлого n3, не тема', SHOT_PAPER, '#EEEEF1');

console.log('\n— поле и радиус от меньшей стороны —');
check('800×600: поле', shotFrame(800, 600).pad, 33);
check('800×600: радиус', shotFrame(800, 600).radius, 11);
check('800×600: холст шире на два поля', shotFrame(800, 600).width, 866);
check('800×600: холст выше на два поля', shotFrame(800, 600).height, 666);

console.log('\n— нижние пороги (мелкий кадр не теряет тень) —');
check('400×300: поле не ниже 28', shotFrame(400, 300).pad, 28);
check('400×300: радиус не ниже 10', shotFrame(400, 300).radius, 10);

console.log('\n— верхние пороги (огромный кадр не обрастает полями) —');
check('4000×3000: поле не выше 110', shotFrame(4000, 3000).pad, 110);
check('4000×3000: радиус не выше 28', shotFrame(4000, 3000).radius, 28);

console.log('\n— HiDPI: доли считаются от кадра, не от CSS-пикселей —');
check('150% к 800×600 даёт крупнее поле, не ту же 33', shotFrame(1200, 900).pad, 50);
check('и крупнее радиус, не те же 11', shotFrame(1200, 900).radius, 16);

console.log(`\nИтого: ${passed} ок, ${failed} провалено`);
process.exit(failed === 0 ? 0 : 1);
