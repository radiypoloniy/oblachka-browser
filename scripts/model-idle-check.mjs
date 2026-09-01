// Политика выгрузки локальной модели (shared/modelIdle.ts) — без electron, обычным node.
//
// ⚠️ Ошибка здесь дорога в обе стороны и незаметна при чтении кода:
//   • мягче — модель висит в памяти весь день после одного перевода утром (2,7 ГБ на 4B, 5,7 на 9B);
//   • жёстче — человек платит тридцать секунд загрузки за каждый второй запрос, и «локальный ИИ»
//     превращается в «ИИ, который всегда думает».
// Отдельно закреплён случай, ради которого заведено давление: игра или монтаж видео поверх
// открытого браузера. Правило обязано отличать чужой приход от нашей же занятой видеопамяти.
//
// Запуск: npm test -- model-idle
import {
  isVramTight, isHardwareTight, shouldUnloadModel,
  MODEL_IDLE_TIMEOUT, MODEL_CHECK_INTERVAL, PRESSURE_MIN_IDLE, TIGHT_STREAK,
  VRAM_FREE_MIN_SHARE, VRAM_OTHERS_MIN,
} from '../shared/modelIdle.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const GB = 1024 * 1024 * 1024;
const MIN = 60 * 1000;

// ── Сами пороги ──────────────────────────────────────────────────────────────
//
// ⚠️ Эталон ЛИТЕРАЛЬНЫМИ числами, а не через те же константы: ассерт вида
// `MODEL_IDLE_TIMEOUT === MODEL_IDLE_TIMEOUT` держит форму и слеп к сдвигу самого числа. Разбор
// этой ошибки — в CLAUDE.md, раздел про мутационный прогон.
{
  check('простой — сорок минут', MODEL_IDLE_TIMEOUT, 40 * 60 * 1000);
  check('проверка раз в минуту', MODEL_CHECK_INTERVAL, 60_000);
  check('под давлением не отнимаем раньше пяти минут', PRESSURE_MIN_IDLE, 5 * 60 * 1000);
  check('тесно должно быть три проверки подряд', TIGHT_STREAK, 3);
  check('порог свободной видеопамяти — 15 %', VRAM_FREE_MIN_SHARE, 0.15);
  check('чужой приход — от гигабайта', VRAM_OTHERS_MIN, 1024 * 1024 * 1024);
}

// ── Видеопамять: чужой приход против нашей же модели ─────────────────────────
//
// ⚠️ Отсчёт (freeAtLoad) снимает ВОРКЕР сразу после того, как модель встала на карту. Раньше его
// снимал сторож на ближайшем тике — до минуты спустя, — и игра, запущенная в эту минуту, попадала
// в отсчёт как норма: разность нулевая, давление молчит, модель висит все сорок минут. Живая
// жалоба, ради которой этот замер и переехал в воркер.
{
  // 8 ГБ карта, модель 5,7 ГБ: свободного меньше 15 % сразу после загрузки, и это НОРМА.
  // ⚠️ Ради этого случая и нужна разность. Стоячее «сколько держат не мы» здесь дало бы 1,4 ГБ
  // (рабочий стол плюс GPU-процесс Chromium) и выгружало бы модель на такой машине постоянно.
  check('своя модель на забитой карте — не повод выгружаться',
    isVramTight({ total: 8 * GB, free: 0.9 * GB, freeAtLoad: 0.9 * GB }), false);

  // Та же карта, и поверх браузера запустили игру: она забрала полтора гигабайта.
  check('чужая программа забрала полтора гигабайта — тесно',
    isVramTight({ total: 8 * GB, free: 0.4 * GB, freeAtLoad: 1.9 * GB }), true);

  // ⚠️ Просторная карта: чужой забрал даже больше, но свободного всё равно вдоволь.
  check('на просторной карте чужой приход ничего не меняет',
    isVramTight({ total: 24 * GB, free: 12 * GB, freeAtLoad: 20 * GB }), false);

  check('забрали ровно гигабайт — граница включительно',
    isVramTight({ total: 8 * GB, free: 0.5 * GB, freeAtLoad: 1.5 * GB }), true);
  check('забрали чуть меньше гигабайта — ещё не чужой приход',
    isVramTight({ total: 8 * GB, free: 0.5 * GB, freeAtLoad: 1.5 * GB - 1 }), false);
  check('ровно 15 % свободно — ещё не тесно',
    isVramTight({ total: 8 * GB, free: 1.2 * GB, freeAtLoad: 4 * GB }), false);
  check('чуть меньше 15 % — уже тесно',
    isVramTight({ total: 8 * GB, free: 1.2 * GB - 1, freeAtLoad: 4 * GB }), true);

  // Карта, о которой ничего не известно: делить на ноль нельзя, и «тесно» тут не значит ничего.
  check('нулевая карта — не тесно', isVramTight({ total: 0, free: 0, freeAtLoad: 0 }), false);
  // Свободного стало БОЛЬШЕ, чем при загрузке (чужая программа закрылась) — разность отрицательна.
  check('чужие ушли — не тесно',
    isVramTight({ total: 8 * GB, free: 3 * GB, freeAtLoad: 1 * GB }), false);
}

// ── Железу тесно: только видеопамять ─────────────────────────────────────────
//
// ⚠️ Ветки по обычной памяти в политике НЕТ намеренно — разбор в шапке shared/modelIdle.ts. Эти
// ассерты её отсутствие и закрепляют: модель на CPU по давлению не выгружается вовсе.
{
  check('карты нет (модель на CPU) — по давлению не выгружаем',
    isHardwareTight({ vram: null }), false);
  check('карта забита чужими — тесно',
    isHardwareTight({ vram: { total: 8 * GB, free: 0.4 * GB, freeAtLoad: 1.9 * GB } }), true);
  check('карта просторна — не тесно',
    isHardwareTight({ vram: { total: 24 * GB, free: 20 * GB, freeAtLoad: 20 * GB } }), false);
}

// ── Решение: выгружать или держать ───────────────────────────────────────────
const now = 1_000_000_000;
const warm = {
  loaded: true, loading: false, busy: false, panelOpen: false,
  lastUserRequestAt: now, tightStreak: 0,
};

{
  check('только что просили — держим', shouldUnloadModel(warm, now), null);
  check('простой сорок минут — выгружаем по простою',
    shouldUnloadModel({ ...warm, lastUserRequestAt: now - 40 * MIN }, now), 'idle');
  check('простой тридцать девять минут — ещё держим',
    shouldUnloadModel({ ...warm, lastUserRequestAt: now - 39 * MIN }, now), null);

  // ⚠️ Все четыре запрета проверяются по отдельности: слитый ассерт «занято — держим» прошёл бы
  // и при выпавшем условии, а выпавшее условие здесь означает выгрузку из-под работающей функции.
  check('модели нет в памяти — выгружать нечего',
    shouldUnloadModel({ ...warm, loaded: false, lastUserRequestAt: now - 5 * 60 * MIN }, now), null);
  check('модель грузится — не трогаем',
    shouldUnloadModel({ ...warm, loading: true, lastUserRequestAt: now - 5 * 60 * MIN }, now), null);
  check('очередь занята — не трогаем',
    shouldUnloadModel({ ...warm, busy: true, lastUserRequestAt: now - 5 * 60 * MIN }, now), null);
  check('AI-панель открыта — не трогаем',
    shouldUnloadModel({ ...warm, panelOpen: true, lastUserRequestAt: now - 5 * 60 * MIN }, now), null);
}

// ── Давление: игра или монтаж поверх браузера ────────────────────────────────
{
  const tight = { ...warm, tightStreak: TIGHT_STREAK };

  check('тесно три проверки подряд и человек не просил пять минут — выгружаем по давлению',
    shouldUnloadModel({ ...tight, lastUserRequestAt: now - 5 * MIN }, now), 'pressure');
  check('тесно, но человек просил минуту назад — не отнимаем',
    shouldUnloadModel({ ...tight, lastUserRequestAt: now - 1 * MIN }, now), null);
  check('тесно две проверки из трёх — ждём',
    shouldUnloadModel({ ...warm, tightStreak: 2, lastUserRequestAt: now - 10 * MIN }, now), null);
  check('просторно — по давлению не выгружаем даже через полчаса',
    shouldUnloadModel({ ...warm, lastUserRequestAt: now - 30 * MIN }, now), null);

  // ⚠️ Сработали оба повода — причиной называется простой: модель ушла бы и без чужой программы.
  // Причина видна в логе и в диспетчере задач, и подменять одну другой значит врать в диагностике.
  check('сработали оба повода — причина «простой»',
    shouldUnloadModel({ ...tight, lastUserRequestAt: now - 45 * MIN }, now), 'idle');

  // Запреты сильнее давления — тот же набор, но с тесным железом.
  check('тесно, но идёт генерация — держим',
    shouldUnloadModel({ ...tight, busy: true, lastUserRequestAt: now - 10 * MIN }, now), null);
  check('тесно, но открыта панель — держим',
    shouldUnloadModel({ ...tight, panelOpen: true, lastUserRequestAt: now - 10 * MIN }, now), null);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
