import { useEffect, useState } from 'react';
import type React from 'react';
import { Check, Plus, X, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import type { TileSite } from '../../../shared/frecency';
import type { MediaCommand, MediaNowPlaying } from '../../../shared/ipc';
import type { CellSize } from '../../newtab/desktop';
import { card, cardGlass, grain, RADIUS, DISPLAY, CAPS, CARD_COLOR_ENABLED, CARD_INK, altitude, ALTITUDE, HERO_ENABLED, sp } from '../../styles/system';
import { loadNewTabSettings } from '../../newtab/settings';
// Что вообще влезает в плитку — чистая арифметика под проверкой (scripts/tile-budget-check.mjs).
// ⚠️ Здесь её быть не должно: ровно эти числа раньше стояли порогами по месту и на узком окне
// резали содержимое краем плитки.
import { densityOf, padOf, weatherFit, musicFit, tileGridCell } from '../../../shared/tileBudget';
import CryptoIcon from '../CryptoIcon';
import { siteTint } from './siteTint';
import { AnalogFace, WideClusterClock, WideTypeClock } from './clockFaces';
import { MoonWidget, ShieldWidget, DownloadsWidget, HolidayWidget, DigestWidget, TrackingWidget, CalendarWidget, TimerWidget } from './localWidgets';

// Виджеты рабочего стола.
//
// ⚠️ Два правила, выведенных из первой версии, которую справедливо назвали бедной:
//
// 1. Плитка ЦВЕТНАЯ, а не прозрачная. Полупрозрачное стекло на обоях даёт «дырку» в фоне и само
//    по себе ничего не сообщает; у Apple каждый виджет — сплошной носитель со своим настроением
//    (погода синяя, ночью тёмная). Цвет здесь несёт смысл, а не украшает.
// 2. Место используется целиком. Размер меняет не масштаб, а СОДЕРЖАНИЕ: маленькая плитка
//    показывает главное число, широкая добавляет ряд часов и крайности суток. Одна крупная
//    цифра посреди пустого прямоугольника — это и есть «дёшево».

export interface WidgetProps {
  size: CellSize;
  /**
   * Виджет попросили открыть — клик по плитке. Пусто означает «сейчас нельзя»: в режиме правки
   * плитку таскают, а не открывают. Открывает виджет то, что показывает: у отслеживания это
   * экран отслеживания.
   */
  onActivate?: () => void;
  /** Пиксельные размеры плитки — от них считаются кегли и число колонок внутри. */
  box: { width: number; height: number };
  /**
   * Сторона КЛЕТКИ сетки — не плитки.
   *
   * ⚠️ Плотность стола задаёт именно она: плитка 2×2 крупная всегда, а вот тесно на ней или нет,
   * решает клетка. На узком окне клетка падает со 132 до 95, и всё, что было абсолютным
   * (значки, кнопки, ячейки), обязано ужиматься вместе с ней — см. shared/tileBudget.ts.
   */
  cell: number;
  tiles: TileSite[];
  onOpen: (url: string) => void;
  /** Город для погоды — из настроек вкладки; пустой означает «человек ещё не выбрал». */
  city: string;
  /** Выбранная человеком заливка (id из WIDGET_FILLS). Погода его игнорирует — см. ниже. */
  fill?: string;
  /**
   * Фон вкладки — КАРТИНКА (фото дня или своё фото). Тогда плитки становятся стеклом: сплошная
   * заливка поверх фотографии закрывает то, ради чего фото и поставили (см. cardGlass).
   */
  overImage?: boolean;
  /**
   * Этот виджет — ГЕРОЙ стола: высота 3, цвет в полную силу (см. altitude в styles/system.ts).
   * ⚠️ Ровно один на стол, и выбирает его человек — инвариант держит setHero в newtab/desktop.ts.
   */
  hero?: boolean;
  /** Свой одностраничник: ключ тела в genStore. */
  genId?: string;
}

// ── Плитка ────────────────────────────────────────────────────────────────────
//
// Два вида, и это не вкус, а разное назначение:
//  • ЦВЕТНАЯ (tint) — носитель со своим настроением: погода, часы, часто открываемые сайты;
//  • ПЛИТКА ТЕМЫ (surface) — та, что раньше была просто белой. Теперь она берёт поверхность из
//    темы (var(--surface)), то есть темнеет вместе с интерфейсом и следует выбранной палитре.
//    Прежний литерал #FFFFFF в тёмной теме светил на весь стол белым прямоугольником, а тёмный
//    текст на нём оставался тёмным.
// ── Заливки виджетов ──────────────────────────────────────────────────────────
// ⚠️ 'theme' — заливка ПО УМОЛЧАНИЮ и не случайно: плитка темы берёт var(--surface) и темнеет
// вместе с интерфейсом и палитрой, а выбранный цвет живёт своей жизнью. Поэтому список начинается
// с темы, а не с цвета, и поэтому здесь id, а не готовые цвета в раскладке стола.
// ⚠️ Фиолетового нет — то же правило, что у --tile-* и подложек иконок сайтов.
export const WIDGET_FILLS: { id: string; label: string; css: string | null; ink: string | null }[] = [
  { id: 'theme',   label: 'Как тема', css: null,                     ink: null },
  { id: 'blue',    label: 'Небо',     css: 'var(--poster-sky)',      ink: 'var(--on-poster-dark)' },
  { id: 'mustard', label: 'Горчица',  css: 'var(--poster-mustard)',  ink: 'var(--on-poster-dark)' },
  { id: 'green',   label: 'Лайм',     css: 'var(--poster-lime)',     ink: 'var(--on-poster-dark)' },
  { id: 'orange',  label: 'Мандарин', css: 'var(--poster-tangerine)',ink: 'var(--on-poster-dark)' },
  { id: 'teal',    label: 'Чай',      css: 'var(--poster-tea)',      ink: 'var(--on-poster-light)' },
  { id: 'pink',    label: 'Страсть',  css: 'var(--poster-passion)',  ink: 'var(--on-poster-light)' },
  { id: 'slate',   label: 'Графит',   css: 'var(--poster-neutral)', ink: 'var(--on-poster-light)' },
];

// ⚠️ Образец в пикере — ТА ЖЕ строка, что и заливка, а не отдельный цвет. Раньше здесь лежал
// свой плоский набор, потому что градиент на кружке 22 px превращался в грязное пятно с
// невнятной серединой. Градиентов больше нет, и второй набор стал ровно тем, чем такие наборы
// становятся: местом, где два списка расходятся при первой же правке.
export const FILL_SWATCH: Record<string, string> = Object.fromEntries(
  WIDGET_FILLS.map((f) => [f.id, f.css ?? 'var(--surface-sunken)']),
);

export function fillCss(id: string | undefined): string | null {
  return WIDGET_FILLS.find((f) => f.id === id)?.css ?? null;
}

/**
 * Краска на выбранной заливке.
 *
 * ⚠️ Пара «цвет + краска» обязательна и не вкусовая: на небе, горчице, лайме и мандарине чернила
 * дают контраст выше 7:1, а белый — ниже 3:1; на чае, страсти и графите наоборот. Прежний код
 * ставил белый на ЛЮБУЮ заливку, и на светлой половине набора текст было физически не прочитать.
 */
export function fillInk(id: string | undefined): string | null {
  return WIDGET_FILLS.find((f) => f.id === id)?.ink ?? null;
}

export function Tile({ children, tint, tintInk, padding = 16, surface, fill, toned, glass, overImage, hero, onActivate }: {
  children: React.ReactNode;
  /** Заливка цветной плитки. Игнорируется при surface. */
  tint?: string;
  /**
   * Краска на собственной заливке плитки (погода).
   *
   * ⚠️ Ходит ПАРОЙ с tint и не имеет разумного умолчания: набор состояний погоды идёт от почти
   * белого снега до тёмного чая, и одного цвета текста на них не существует.
   */
  tintInk?: string;
  padding?: number;
  /** Плитка идёт за темой и палитрой, а не за собственным цветом. */
  surface?: boolean;
  /** Выбранная человеком заливка (id из WIDGET_FILLS). Перебивает surface. */
  fill?: string;
  /**
   * Карточка идёт по цвету содержимого: нейтраль с намёком тона палитры (см. card() в
   * src/styles/system.ts). `high` — та единственная, что должна выделяться.
   *
   * ⚠️ Выбор человека всегда сильнее: задал свою заливку (fill) — цвет карточки не применяется.
   * Весь цвет содержимого гасится одной константой CARD_COLOR_ENABLED.
   */
  toned?: boolean | 'high';
  /**
   * Плитка — СТЕКЛО всегда, а не только над фотографией.
   *
   * ⚠️ Заводится для виджетов, у которых стекло — часть их собственного языка (календарь,
   * таймер): у них внутри крупная типографика и тонкие линии, и на плотной заливке они читаются
   * как наклейка поверх стола, а не как его часть. Выбор человека по-прежнему сильнее: задал
   * свою заливку — стекла нет.
   */
  glass?: boolean;
  /** Высота 3: цвет в полную силу. Ровно один герой на стол — см. setHero. */
  hero?: boolean;
  /**
   * Фон новой вкладки — КАРТИНКА (фото дня или своё фото). Тогда карточка становится стеклом:
   * непрозрачная плитка поверх фотографии закрывает то, ради чего фото и поставили.
   */
  overImage?: boolean;
  /**
   * Клик по плитке. ⚠️ Приходит уже с учётом режима правки: в нём плитку таскают, а не открывают,
   * и DesktopScreen не передаёт обработчик вовсе (см. там же).
   */
  onActivate?: () => void;
}) {
  const custom = fillCss(fill);
  // Цвет карточки — только когда человек не выбрал свою заливку и плитка вообще идёт за темой.
  // ⚠️ Порядок разбора и есть иерархия высот: выбор человека → герой → стекло над фото → карта.
  const useHero = !custom && !!hero && HERO_ENABLED;
  const useGlass = !custom && !useHero && surface && (!!overImage || !!glass);
  const useCard = !custom && !useHero && surface && !!toned && !useGlass && CARD_COLOR_ENABLED;
  const heroStyle = useHero ? altitude(ALTITUDE.hero, { content: true }) : null;
  const toneStyle = heroStyle ?? (useGlass ? cardGlass() : useCard ? card(toned === 'high') : null);
  const onSurface = surface && !custom && !useCard && !useGlass && !useHero;
  // ⚠️ Плитка объявляет СВОЙ ФОН переменной. Содержимому (лицам часов, таймеру) нужна краска,
  // на которой гарантированно читается заливка из currentColor: акцентная кнопка на акцентной
  // плитке — кнопка-невидимка.
  // ⚠️ Плоский образец (FILL_SWATCH) здесь больше не нужен: заливки перестали быть градиентами,
  // и `custom` уже плоская краска. Раньше подстановка градиента в --tile-bg давала подпись на
  // кнопке, залитую двухцветным переливом, — отсюда и брался отдельный образец.
  const tileBg = custom ?? (useHero ? 'var(--accent)' : 'var(--surface)');
  // ⚠️ И ФОН, И КРАСКА — двумя переменными, а не одной. Содержимому нужна ПАРА: заливка кнопки
  // краской плитки и подпись на ней фоном плитки. Через currentColor это не выражается: в
  // `background: currentColor` он берёт цвет САМОГО элемента, а элемент этот цвет тут же
  // переопределяет под подпись — кнопка красится сама собой и исчезает (проверено на стенде).
  // ⚠️ Белого литерала здесь больше нет. Он был единственной краской на любой цветной плитке, и
  // после перехода на плакатные заливки половина набора (небо, горчица, лайм, мандарин) стала бы
  // нечитаемой: контраст белого на них ниже 3:1. Краска приходит парой к заливке — от человека
  // через fillInk, от погоды через tintInk.
  const tileInk = toneStyle?.color
    ?? (onSurface ? 'var(--text-body)' : (fillInk(fill) ?? tintInk ?? 'var(--on-poster-light)'));
  return (
    <div onClick={onActivate} style={{
      // Кастомное свойство в inline-стиле — React пропускает его как есть.
      ['--tile-bg' as string]: tileBg,
      ['--tile-ink' as string]: tileInk,
      // ⚠️ Подпись на ПЛАКАТНОЙ плоскости приглушается слабее: 0.62 задумывалась для плитки темы,
      // где под текстом почти белая поверхность. На страсти светлая краска и без приглушения даёт
      // 4.30, а с 0.62 падает до 2.52 — капса перестаёт читаться вовсе.
      // ⚠️ Граница названа честно: на страсти мелкая капса не даёт 4.5:1 ни при какой
      // непрозрачности (потолок 4.30 — свойство самого цвета). Крупные числа там же идут в полную
      // силу и проходят как крупный текст; приглушать имело смысл только подписи.
      ['--tile-caption-op' as string]: (custom || tint) && !useHero ? 0.78 : 0.62,
      width: '100%', height: '100%', overflow: 'hidden', position: 'relative',
      // ⚠️ У содержимого радиус свой и крупнее, чем у хрома: два мира — разная геометрия.
      borderRadius: RADIUS.content,
      background: custom ?? toneStyle?.background ?? (surface ? 'var(--surface)' : tint),
      // ⚠️ У плитки темы тень мягче, а по краю идёт кромка: и белая на светлых обоях, и тёмная на
      // тёмных иначе сливается с фоном и перестаёт читаться как отдельный остров.
      boxShadow: heroStyle?.boxShadow ?? (onSurface
        ? 'var(--shadow-lvl2), var(--inner-light)'
        : '0 6px 20px rgba(16,20,40,0.22)'),
      border: toneStyle?.border ?? (onSurface ? '1px solid var(--divider)' : undefined),
      backdropFilter: toneStyle?.backdropFilter,
      WebkitBackdropFilter: toneStyle?.WebkitBackdropFilter,
      // Свойства против артефактов стекла едут вместе с ним — см. cardGlass.
      transform: toneStyle?.transform,
      willChange: toneStyle?.willChange,
      isolation: toneStyle?.isolation,
      // На выбранной заливке текст всегда белый: все заливки набора тёмные настолько, что
      // --text-body на них не читался бы.
      color: tileInk,
      padding,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Зерно: тонкая текстура поверх заливки — она и отличает материал от плоской заливки из
          макета. Только на тонированных плитках: на своей картинке человека и на фото дня зерно
          было бы грязью. */}
      {/* ⚠️ Зерно — на любой ПЛОТНОЙ заливке: и на карточке темы, и на плакатной краске, и на
          собственном цвете погоды. Не на стекле и не поверх фото человека: там под слоем лежит
          чужая картинка, и текстура поверх неё читается грязью (правило из манифеста). */}
      {(useCard || custom || tint) && !useGlass && <div style={grain} />}
      {children}
    </div>
  );
}

// ⚠️ Подпись плитки — МОНОШИРИННАЯ капса, тот же приём, что в настройках (CAPS). Это половина
// «нового шрифта»: пока подписи были обычным гротеском, плитки визуально жили в старой системе,
// сколько бы материал ни меняли (живая жалоба: «прозрачность сделал, а типографику не тронул»).
export function TileCaption({ children }: { children: React.ReactNode }) {
  return <div style={{ ...CAPS, color: 'inherit', opacity: 'var(--tile-caption-op, 0.62)', flex: 'none' }}>{children}</div>;
}

/**
 * Ключевое число плитки — вторая половина «нового шрифта».
 *
 * ⚠️ Дисплейная гарнитура + табличные цифры, а размер приходит снаружи: у каждой плитки он
 * считается от её геометрии, и общего кегля тут быть не может. У ГЕРОЯ число крупнее в
 * HERO_SCALE раз — именно это и делает геройство видимым на любом виджете, а не только на погоде.
 */
// ── Метрика дисплейных цифр ───────────────────────────────────────────────────
//
// ⚠️ Числа ЗАМЕРЕНЫ, а не прикинуты. `measureText` по Unbounded при кегле 100 даёт «19:44» =
// 233.3 px и «0:00» = 183.3 px; из разницы следует, что цифра занимает ровно 0.50 em, а
// двоеточие 0.33 em. Прежние оценки — 0.78 у часов и 0.62 у курса — резервировали ширину,
// которой цифры не занимают, и кегль упирался не в геометрию плитки, а в ошибку измерения:
// на квадратной плитке часы стояли на 52 при доступных ~72.
//
// ⚠️ Пересчитывать при смене дисплейной гарнитуры. Замер повторяется страницей с
// document.fonts.ready + measureText — сам шрифт лежит в src/assets/fonts.
const DIGIT_EM = 0.50;
const COLON_EM = 0.34;
const SPACE_EM = 0.28;
// Всё прочее (знаки валют, °, буквы) — с запасом: они шире цифр, и лучше недобрать кегль,
// чем обрезать строку краем плитки.
const WIDE_EM = 0.60;

/** Ширина строки в единицах кегля: сколько em займёт текст дисплейной гарнитурой. */
export function displayEm(text: string): number {
  let em = 0;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') em += DIGIT_EM;
    else if (ch === ':') em += COLON_EM;
    else if (ch === ' ' || ch === ' ' || ch === ' ') em += SPACE_EM;
    else em += WIDE_EM;
  }
  return em;
}

/**
 * Доля доступной ширины, которую занимает ключевое число.
 *
 * ⚠️ Не «запас на ошибку», а решение о композиции: число во всю плитку, но с полем примерно в
 * 9% с каждой стороны. Без поля цифры упираются в край и плитка читается как обрезанная —
 * ровно то, чего не было в согласованном макете.
 */
const VALUE_SIDE = 0.82;

const HERO_SCALE = 1.28;
export function TileValue({ children, size, hero, style }: {
  children: React.ReactNode; size: number; hero?: boolean; style?: React.CSSProperties;
}) {
  return (
    <div style={{
      ...DISPLAY,
      fontSize: Math.round(size * (hero ? HERO_SCALE : 1)),
      fontWeight: hero ? 700 : 600,
      ...style,
    }}>{children}</div>
  );
}

// ⚠️ Общего «слейта» у часов и топ-сайтов БОЛЬШЕ НЕТ. Он был их несменяемым цветом, и когда
// появился выбор заливки, пункт «как тема» на них не работал вовсе: у виджета с собственным
// tint тема просто не побеждала — то есть сделать часы белыми было физически нельзя. Теперь по
// умолчанию за темой идёт всё, кроме погоды (там цвет означает время суток и саму погоду), а
// прежний слейт остался одним из выбираемых цветов — 'slate' в WIDGET_FILLS.

// ── Часы ──────────────────────────────────────────────────────────────────────
//
// Два вида, выбор в настройках: циферблат со стрелками (по умолчанию) и прежние цифры.
// ⚠️ Секундная стрелка — тёплая, а не акцентная синяя: у механических часов и у системных часов
// Apple секундная всегда контрастного тёплого цвета, потому что она единственная движется
// непрерывно и должна отделяться от двух статичных. Цветовой закон это не нарушает — он про
// интерфейс браузера, а плитки стола сознательно живут своими цветами (см. шапку файла).
function tinyDial(box: { width: number; height: number }, avail: number, dateH: number): number {
  const small = box.height < 150;
  const reserved = small ? 0 : 20 + dateH;
  return Math.max(44, Math.min(avail, box.height - (small ? 24 : 32) - reserved));
}

// Средние сумерки на случай, когда города нет: 6:00 и 21:00. Не «правильные» для конкретной
// широты, но и не выдумка — это медиана по году для средней полосы.
const DEFAULT_SUNRISE = 6 * 60;
const DEFAULT_SUNSET = 21 * 60;

export function ClockWidget({ box, fill, city, overImage, hero }: WidgetProps) {
  const [now, setNow] = useState(() => new Date());
  const opts = loadNewTabSettings().clock;
  const analog = opts.face !== 'digital';

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), opts.seconds ? 1_000 : 15_000);
    return () => clearInterval(t);
  }, [opts.seconds]);

  // ⚠️ В РАСТЯНУТОЙ плитке у часов своё лицо — и оно следует тому же выбору «стрелки/цифры»,
  // что и обычный вид, а не заводит третий. Дуга дня, стоявшая здесь раньше, снята: три захода
  // подряд по ней не сошлись, и владелец выбрал по стенду два других лица (см. clockFaces.tsx).
  //   • стрелки → кластер: крупный циферблат, дата стеклом, полоса времени;
  //   • цифры  → набор на всю ширину по небу текущей фазы дня.
  // Порог по пропорции, а не по числу клеток: клетка резиновая, а «заметно шире, чем высокая» —
  // ровно тот случай, где узкий круг посреди пустоты перестаёт работать.
  const wide = box.width > box.height * 1.7;
  // Восход/закат берём из погоды (уже кэшируется, тот же город) — своей геолокации часам не
  // заводим. ⚠️ Нет города — не отказываемся от лица, а берём средние сумерки: небо станет чуть
  // менее точным, но виджет останется тем, что человек выбрал. Прежний код в этом случае
  // молча показывал совсем другой вид.
  const sun = useSunTimes(wide && !analog ? city : '');
  if (wide) {
    return (
      <Tile surface toned overImage={overImage} hero={hero} fill={fill} padding={0}>
        {analog
          ? <WideClusterClock now={now} seconds={opts.seconds} />
          : <WideTypeClock now={now} sunrise={sun?.rise ?? DEFAULT_SUNRISE} sunset={sun?.set ?? DEFAULT_SUNSET} />}
      </Tile>
    );
  }

  const time = fmtTime(now, opts);
  const weekday = now.toLocaleDateString('ru-RU', { weekday: 'long' });
  const dayMonth = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  // Кегль считаем от ДЛИНЫ строки, а не от одной ширины плитки: «18:50» и «18:50:07» занимают
  // разное место, и общий коэффициент неизбежно ошибается на одном из них — в маленьком виджете
  // время упиралось в край. 0.56 — доля ширины цифры от кегля у моноширинных цифр (tabular-nums)
  // нашего шрифта, замерена по факту. Потолок по высоте и общий потолок остаются.
  const avail = box.width - 32; // минус паддинги плитки
  // ⚠️ 0.78, а не 0.56. Коэффициент — это ДОЛЯ ШИРИНЫ ЦИФРЫ ОТ КЕГЛЯ, и он свой у каждой
  // гарнитуры. 0.56 был замерен у Golos Text, а время теперь набирается ДИСПЛЕЙНОЙ (Unbounded),
  // у которой знаки заметно шире: формула давала кегль в полтора раза больше нужного, и «17:16»
  // вылезало за правый край плитки (живая жалоба «накосячил с размером часов»).
  // Замена гарнитуры без замены этого числа — та же ошибка ещё раз.
  // ⚠️ Ширина считается ПО СИМВОЛАМ, а не «длина × средний коэффициент»: двоеточие втрое уже
  // цифры, поэтому «19:44» и «0:00» — это 2.34 и 1.84 em, а не 5 и 4 одинаковых знака.
  // Высотный множитель 0.42 остаётся: на низкой широкой плитке (2×1) ограничивает именно он,
  // и трогать его значило бы уронить кегль там, где ширина не мешает.
  // ⚠️ Масштаб героя (HERO_SCALE) учитывается ЗДЕСЬ, а не после: TileValue умножит кегль уже
  // после расчёта, и без поправки геройские часы считали бы ширину для 81, а рисовали для 104 —
  // то есть выезжали бы за плитку тем сильнее, чем честнее мы посчитали метрику.
  const heroScale = hero ? HERO_SCALE : 1;
  const fs = Math.round(Math.min(
    box.height * 0.42,
    (avail * VALUE_SIDE) / (displayEm(time) * heroScale),
    92,
  ));

  // Циферблат — КРУГ, поэтому его размер держит меньшая из сторон свободного места, иначе на
  // широкой плитке он вылез бы за нижний край. Подпись сверху и дата снизу вычитаются заранее.
  const dateH = opts.date ? 26 : 0;
  // ⚠️ На одноклеточной плитке подписи сверху и снизу больше нет, поэтому и вычитать под них
  // нечего: прежняя формула резервировала 46 px, которых не существует, и циферблат упирался в
  // нижний потолок 64 px, вылезая за плитку. Отсюда и «плывёт разметка» на мелком размере.
  const dial = tinyDial(box, avail, dateH);

  // ⚠️ На плитке в ОДНУ клетку подпись дня и дата не показываются. Втроём (день сверху, время,
  // дата снизу) они физически не влезают в ~124 px: содержимое вылезало за края — это и было
  // «плывёт разметка». Размер меняет СОДЕРЖАНИЕ, а не масштаб — то же правило, что у погоды.
  const tiny = box.height < 150;
  // Заметно шире, чем высокая — тот же порог, по которому включается дуга дня.
  const wideRow = box.width > box.height * 1.5 && box.height >= 150;
  return (
    <Tile surface toned overImage={overImage} hero={hero} fill={fill} padding={tiny ? 12 : 16}>
      {!tiny && <TileCaption>{weekday}</TileCaption>}
      {analog ? (
        // ⚠️ В ШИРОКОЙ плитке циферблат встаёт РЯДОМ с временем, а не один посреди пустоты.
        // Круг держится меньшей стороной, поэтому на растянутой плитке он оставлял по половине
        // ширины пустоты с боков и «терялся» — живая жалоба. Композиция меняется от формы, как
        // у погоды и у самих часов в растянутом виде; сам циферблат при этом тот же.
        // ⚠️ ЦИФР РЯДОМ С ЦИФЕРБЛАТОМ НЕТ. Первая попытка ставила их бок о бок, и это оказалось
        // хуже пустоты: одно и то же время, сказанное дважды двумя способами, — «слепленные
        // часы». Человек, выбравший стрелки, выбрал стрелки. В широкой плитке циферблат просто
        // становится КРУПНЫМ и центрируется: пустота по бокам — это воздух, а не брак.
        wideRow ? (
          <div style={{
            flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: sp(2),
          }}>
            <AnalogFace size={Math.min(box.height - 64, 150)} now={now} seconds={opts.seconds} />
            {opts.date && <div style={{ fontSize: 'var(--fs-sm)', opacity: 0.8 }}>{dayMonth}</div>}
          </div>
        ) : (
        <div style={{
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <AnalogFace size={dial} now={now} seconds={opts.seconds} />
          {opts.date && !tiny && (
            <div style={{ fontSize: 'var(--fs-sm)', opacity: 0.8, textAlign: 'center' }}>{dayMonth}</div>
          )}
        </div>
        )
      ) : (
        // ⚠️ На широкой плитке содержимое ЦЕНТРИРУЕТСЯ. Прижатое влево время оставляло справа
        // пустоту в половину виджета — на 4 клетки это выглядело как незаполненная заготовка.
        // Порог по пропорции, а не по числу клеток: клетка резиновая, а «шире, чем высокая» —
        // это ровно тот случай, когда прижатый край и читается пустотой.
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
          alignItems: box.width > box.height * 1.6 ? 'center' : 'flex-start',
          textAlign: box.width > box.height * 1.6 ? 'center' : 'left',
        }}>
          <TileValue size={fs} hero={hero}>{time}</TileValue>
          {opts.date && !tiny && (
            <div style={{ marginTop: 10, fontSize: Math.max(13, Math.round(fs * 0.2)), opacity: 0.8 }}>
              {dayMonth}
            </div>
          )}
        </div>
      )}
    </Tile>
  );
}

// Формат времени по настройкам часов — общий для цифрового вида и дуги дня, чтобы «14:30» и
// выбор 24/12ч не разъезжались между двумя рисовками.
function fmtTime(now: Date, opts: { seconds?: boolean; hour24?: boolean }): string {
  return now.toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit',
    ...(opts.seconds ? { second: '2-digit' } : {}),
    hour12: !opts.hour24,
  });
}

// «ЧЧ:ММ» → минуты от полуночи. Восход/закат приходят из погоды строкой — для позиции на дуге
// нужно число. Кривой ввод → null, дуга тогда просто не рисуется (откат на обычные часы).
function hhmmToMinutes(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h >= 0 && h < 24 && min >= 0 && min < 60 ? h * 60 + min : null;
}

// Восход/закат для дуги дня. Источник — та же погода, что у виджета погоды (кэш общий, город тот
// же), поэтому своей геолокации и сетевого запроса у часов нет: спрашиваем getWeather и берём из
// ответа только sunrise/sunset. Пустой город или сбой → null, и дуга не показывается.
function useSunTimes(city: string): { rise: number; set: number } | null {
  const [sun, setSun] = useState<{ rise: number; set: number } | null>(null);
  useEffect(() => {
    if (!city) { setSun(null); return; }
    let alive = true;
    void window.oblako.getWeather(city).then((w) => {
      if (!alive) return;
      const rise = hhmmToMinutes(w.sunrise), set = hhmmToMinutes(w.sunset);
      // Оба нужны И закат должен быть позже восхода — иначе доля дня считается мусором.
      setSun(rise !== null && set !== null && set > rise ? { rise, set } : null);
    }).catch(() => { if (alive) setSun(null); });
    return () => { alive = false; };
  }, [city]);
  return sun;
}

// ── Погода ────────────────────────────────────────────────────────────────────
// Пороги европейского индекса качества воздуха (EAQI) — из шкалы самого Open-Meteo, а не
// придуманные: до 20 «хорошо», до 40 «нормально», до 60 «средне», до 80 «плохо», выше «очень
// плохо». Цифра без слова человеку ничего не говорит, поэтому рядом всегда стоит подпись.
function aqiLabel(v: number): string {
  if (v <= 20) return 'хорошо';
  if (v <= 40) return 'нормально';
  if (v <= 60) return 'средне';
  if (v <= 80) return 'плохо';
  return 'очень плохо';
}

interface WeatherState {
  t: number; code: number; city: string;
  feels?: number; max?: number; min?: number; isDay: boolean;
  aqi?: number; sunrise?: string; sunset?: string;
  hours: { hour: number; tempC: number; code: number }[];
}

// WMO-код → имя файла Meteocons (см. scripts/download-icons.mjs).
//
// ⚠️ Эмодзи здесь не годятся: они рисуются шрифтом системы, выглядят по-разному на разных
// машинах и рядом с крупной температурой смотрятся наклейкой. Meteocons — цветные объёмные
// SVG в том же стиле, что системный виджет Apple.
function wmoIconName(code: number, day = true): string {
  if (code === 0) return day ? 'clear-day' : 'clear-night';
  if (code <= 2) return day ? 'partly-cloudy-day' : 'partly-cloudy-night';
  if (code === 3) return day ? 'overcast-day' : 'overcast-night';
  if (code <= 48) return day ? 'fog-day' : 'fog-night';
  if (code <= 57) return 'drizzle';
  if (code <= 67) return 'rain';
  if (code <= 77) return 'snow';
  if (code <= 82) return 'rain';
  if (code <= 86) return 'sleet';
  if (code <= 99) return day ? 'thunderstorms-day-rain' : 'thunderstorms-night-rain';
  return 'not-available';
}

function WeatherIcon({ code, day, size }: { code: number; day: boolean; size: number }) {
  return (
    <img
      src={`./weather/${wmoIconName(code, day)}.svg`}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, flex: 'none', display: 'block' }}
    />
  );
}

function wmoText(code: number): string {
  if (code === 0) return 'Ясно';
  if (code <= 2) return 'Малооблачно';
  if (code === 3) return 'Пасмурно';
  if (code <= 48) return 'Туман';
  if (code <= 57) return 'Морось';
  if (code <= 67) return 'Дождь';
  if (code <= 77) return 'Снег';
  if (code <= 82) return 'Ливень';
  if (code <= 86) return 'Снегопад';
  return 'Гроза';
}

// Цвет плитки — от времени суток и состояния неба. Это и есть «настроение» виджета Apple:
// ясный день голубой, пасмурный серо-синий, ночь тёмная.
/**
 * Кожа погоды: плоская краска и краска текста к ней.
 *
 * ⚠️ Погода — единственная плитка со СВОИМ цветом (он означает время суток и осадки), и до этой
 * правки её пять серо-синих градиентов были отдельной палитрой посреди стола. Тона взяты из
 * общего плакатного набора, смысл сохранён: ясно — небо, ночь — чай, дождь и снег — холодные
 * промежуточные, пасмурно — бумага-тень.
 *
 * ⚠️ Краска идёт ПАРОЙ с цветом, иначе половина состояний нечитаема: на небе и бумаге-тени нужен
 * тёмный текст, на чае и дожде — светлый. Прежний код ставил белый на все пять.
 */
type Skin = { bg: string; ink: string };
const SKIN_DARK = 'var(--on-poster-dark)';
const SKIN_LIGHT = 'var(--on-poster-light)';

function weatherSkin(code: number, isDay: boolean): Skin {
  if (!isDay) return { bg: 'var(--poster-tea)', ink: SKIN_LIGHT };
  // Снег: почти белая плоскость — единственное состояние, которое читается светлым по смыслу.
  if (code >= 71) return { bg: '#CFDCE4', ink: SKIN_DARK };
  // ⚠️ Дождь темнее, чем просится на глаз (#7E93A8), и это про контраст, а не про вкус: на том
  // тоне светлая краска давала 2.71, то есть подписи «ощущается» и «воздух» читались с трудом.
  // #55697D — первый шаг вниз, на котором пара проходит 4.5:1.
  if (code >= 51) return { bg: '#55697D', ink: SKIN_LIGHT };
  if (code >= 3)  return { bg: 'var(--surface-sunken)', ink: 'var(--text-body)' };
  return { bg: 'var(--poster-sky)', ink: SKIN_DARK };
}

export function WeatherWidget({ size, box, cell, city, hero }: WidgetProps) {
  const [data, setData] = useState<WeatherState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!city) return;
    let alive = true;
    void window.oblako.getWeather(city).then((w) => {
      if (!alive) return;
      if (w.error || w.tempC === undefined) { setFailed(true); return; }
      setData({
        t: Math.round(w.tempC), code: w.weatherCode ?? 0, city: w.city || city,
        feels: w.feelsC !== undefined ? Math.round(w.feelsC) : undefined,
        max: w.maxC !== undefined ? Math.round(w.maxC) : undefined,
        min: w.minC !== undefined ? Math.round(w.minC) : undefined,
        isDay: w.isDay !== false,
        aqi: w.aqi, sunrise: w.sunrise, sunset: w.sunset,
        hours: w.hours ?? [],
      });
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [city]);

  if (!city || failed) {
    return (
      <Tile tint="var(--surface-sunken)" tintInk="var(--text-body)" hero={hero}>
        <TileCaption>Погода</TileCaption>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: 'var(--fs-sm)', opacity: 0.9, lineHeight: 1.4 }}>
          {city ? 'Не удалось загрузить' : 'Укажите город в настройках интерфейса'}
        </div>
      </Tile>
    );
  }

  const wide = size.w >= 4;
  const skin = weatherSkin(data?.code ?? 0, data?.isDay ?? true);
  // ⚠️ Что показывать, решает БЮДЖЕТ, а не пороги по высоте коробки. Прежние `box.height > 120`
  // и `> 150` не знали, сколько уже занято шапкой, числом и описанием: на клетке 105 ряду не
  // хватало 26 px, и `overflow: hidden` срезал ему низ (см. shared/tileBudget.ts).
  const fit = weatherFit(box, cell, wide, {
    air: data?.aqi !== undefined || !!data?.sunrise,
    hours: data?.hours.length ?? 0,
  });
  const hours = data?.hours.slice(0, fit.hours) ?? [];

  return (
    <Tile tint={skin.bg} tintInk={skin.ink} hero={hero} padding={padOf(densityOf(cell))}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flex: 'none' }}>
        <span style={{
          fontSize: 'var(--fs-sm)', fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{data?.city ?? city}</span>
        {data?.max !== undefined && data?.min !== undefined && (
          <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.85, flex: 'none' }}>
            {data.max}° / {data.min}°
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, flex: 'none' }}>
        {/* ⚠️ У ГЕРОЯ число набирается дисплейной гарнитурой и плотнее: он на экране один, и
            смотрят на него издалека. У обычной плитки остаётся тонкое начертание — иначе стол
            превращается в набор кричащих цифр. */}
        <TileValue size={fit.tempSize} hero={hero}>{data ? `${data.t}°` : '—'}</TileValue>
        <WeatherIcon code={data?.code ?? 0} day={data?.isDay ?? true} size={fit.iconSize} />
      </div>

      <div style={{ fontSize: 'var(--fs-sm)', opacity: 0.9, marginTop: 2, flex: 'none' }}>
        {wmoText(data?.code ?? 0)}
        {data?.feels !== undefined && `, ощущается ${data.feels}°`}
      </div>

      {/* Воздух и солнце — ВНУТРИ погоды, а не отдельными плитками. Данные приходят от того же
          Open-Meteo, то есть нового получателя не появляется; а качество воздуха без погоды
          рядом и не читается — «европейский индекс 34» сам по себе человеку ничего не говорит,
          а «34, хорошо» рядом с +19° и солнцем складывается в одну картину дня.
          Строка появляется, только если место есть: в маленькой плитке ей не встать. */}
      {fit.showAir && (
        <div style={{
          display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap',
          fontSize: 'var(--fs-xs)', opacity: 0.85,
        }}>
          {data?.aqi !== undefined && <span>Воздух: {data.aqi} · {aqiLabel(data.aqi)}</span>}
          {data?.sunrise && data.sunset && <span>↑ {data.sunrise} ↓ {data.sunset}</span>}
        </div>
      )}

      {/* Почасовой ряд — то, чем виджет Apple заполняет нижнюю половину. Появляется, только
          если место под него реально есть: втиснутый в низкую плитку он был бы кашей. */}
      {hours.length > 0 && (
        <div style={{
          marginTop: 'auto', paddingTop: 10, display: 'flex', justifyContent: 'space-between',
          borderTop: '1px solid rgba(255,255,255,0.18)',
        }}>
          {hours.map((h) => (
            <div key={h.hour} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.8 }}>{String(h.hour).padStart(2, '0')}</span>
              <WeatherIcon code={h.code} day={h.hour >= 7 && h.hour <= 20} size={fit.hourIcon} />
              <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600 }}>{Math.round(h.tempC)}°</span>
            </div>
          ))}
        </div>
      )}
    </Tile>
  );
}

// ── Курсы валют ───────────────────────────────────────────────────────────────
// Плитка темы, а не собственный цвет: слишком много ярких островов рядом превращают стол в
// витрину. Цвет остаётся только там, где он что-то значит, — в стрелках роста и падения.
const RATE_SYMBOL: Record<string, string> = {
  USD: '$', EUR: '€', CNY: '¥', GBP: '£', JPY: '¥', KZT: '₸', TRY: '₺', BYN: 'Br', AMD: '֏', GEL: '₾',
};

// ⚠️ Названы по ЦВЕТУ, а не по смыслу («рост»/«падение»), и это принципиально: у курса ЦБ рост
// значения красят тёплым (рубль слабеет), у крипты рост — зелёным (актив дорожает). Одно имя
// вроде TONE_UP склеило бы два противоположных правила в одно и рано или поздно их перепутало.
// Значения — в токенах (colors.css + theme-dark.css): на тёмной плитке прежние тёмные литералы
// не читались вовсе.
export const TONE_GREEN = 'var(--tone-green)';
export const TONE_WARM  = 'var(--tone-warm)';
export const FILL_GREEN = 'var(--tone-green-fill)';
export const FILL_WARM  = 'var(--tone-warm-fill)';

// ── Тесная плитка ─────────────────────────────────────────────────────────────
//
// ⚠️ Виджет курса живёт в двух видах, а не в одном растянутом. На плитке в одну клетку высотой
// прежняя вёрстка складывалась сама в себя: подпись «Курс ЦБ» сталкивалась с «USD · 30 дней»,
// строки валют налезали друг на друга, а кегль считался как (высота − 60), то есть на низкой
// плитке уходил в отрицательные числа. Уменьшать шрифт дальше бессмысленно — читать было бы
// нечего; поэтому в тесноте виджет показывает ОДНУ строку и молчит про всё второстепенное.
const COMPACT_H = 150;

/**
 * Кегль строки со значением — по ОБЕИМ сторонам плитки, а не по одной высоте.
 *
 * ⚠️ Считать только от высоты было мало: на плитке 2×2 при клетке 81 px высота позволяла кегль
 * 26, а по ширине строка «$ 80.07 ▲ 0.76%» в него не влезала — процент выезжал за край и
 * обрезался (nowrap не даёт ему перенестись, и правильно: перенос ломал бы столбец цифр).
 * Поэтому ширина считается в единицах кегля: знак слева ≈1.1 em, каждый знак числа ≈0.62 em
 * (цифры моноширинные, fontVariantNumeric: tabular-nums), плюс фиксированное место под процент
 * — он рисуется мелким кеглем и от rowFs не зависит.
 */
function rowFontSize(box: { width: number; height: number }, rows: number, opts?: {
  /** Сколько знаков в самом длинном значении («80.07» — 5, «5.12 млн» — 8). */
  chars?: number;
  /** Рисуется ли процент справа: под него нужно место, которое от кегля не зависит. */
  delta?: boolean;
}): number {
  const chars = opts?.chars ?? 6;
  const byHeight = (box.height - 32 /* поля Tile */ - 18 /* строка заголовка */) / Math.max(1, rows) * 0.5;
  const forDelta = opts?.delta === false ? 0 : 52; // процент + зазор перед ним
  // ⚠️ 0.62 на знак было той же оценкой на глаз, что и 0.78 у часов, — теперь замеренная
  // метрика. Знак валюты считаем шире цифры: «$» и «₽» действительно шире.
  const byWidth = (box.width - 32 - forDelta - 9) / (WIDE_EM + DIGIT_EM * chars);
  return Math.round(Math.max(13, Math.min(byHeight, byWidth, 26)));
}

export function RatesWidget({ size, box, fill, overImage, hero }: WidgetProps) {
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [prev, setPrev] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<number[]>([]);

  const chosen = loadNewTabSettings().rates.codes;
  // В тесной плитке — только первая валюта: две строки и заголовок в одну клетку высотой не
  // помещаются, и раньше они просто налезали друг на друга.
  const compact = box.height < COMPACT_H;
  const codes = (chosen.length ? chosen : ['USD', 'EUR']).slice(0, compact ? 1 : size.w >= 4 ? 3 : 2);
  const main = codes[0] ?? 'USD';

  useEffect(() => {
    let alive = true;
    void window.oblako.getCurrencyRates().then((r) => {
      if (!alive || !r.rates) return;
      setRates(r.rates as Record<string, number>);
      setPrev((r.prev ?? {}) as Record<string, number>);
    }).catch(() => { /* курс — украшение, молчим */ });
    return () => { alive = false; };
  }, []);

  // График строим по ПЕРВОЙ выбранной валюте: несколько линий в плитке такого размера
  // превратились бы в кашу, а одна показывает то, ради чего на курс и смотрят, — куда идёт.
  useEffect(() => {
    let alive = true;
    void window.oblako.getCurrencyHistory(main, 30).then((v) => {
      if (alive) setHistory(v);
    }).catch(() => { /* график необязателен */ });
    return () => { alive = false; };
  }, [main]);

  // «80.07» — пять знаков, но у слабых валют бывает и «1 234.56»; берём с запасом.
  const rowFs = rowFontSize(box, codes.length, { chars: 6 });
  const chartH = Math.max(30, Math.round(box.height * 0.26));

  return (
    <Tile surface toned overImage={overImage} hero={hero} fill={fill}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, flex: 'none' }}>
        <TileCaption>Курс ЦБ</TileCaption>
        {/* Подпись графика — только когда сам график виден. Иначе она сталкивалась с заголовком
            и обе превращались в кашу вроде «КУРС ЦБUSD · 30 дн». */}
        {history.length > 1 && !compact && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{main} · 30 дней</span>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5 }}>
        {codes.map((c) => {
          const now = rates?.[c];
          const before = prev[c];
          // Дельта за день: ЦБ отдаёт вчерашний курс в том же ответе, отдельный запрос не нужен.
          const delta = now !== undefined && before !== undefined && before > 0
            ? ((now - before) / before) * 100
            : null;
          return (
            <div key={c} style={{ display: 'flex', alignItems: 'baseline', gap: 9, whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: Math.round(rowFs * 0.78), width: '1.2em', opacity: 0.9, flex: 'none' }}>
                {RATE_SYMBOL[c] ?? c}
              </span>
              {/* ⚠️ Дисплейной гарнитурой — это ЧИСЛО, ради которого виджет и существует: на него
                  смотрят издалека, а не читают. В интерфейс эта гарнитура не заходит (см. DISPLAY
                  в styles/system.ts). */}
              <TileValue size={rowFs} hero={hero} style={{ color: CARD_INK, lineHeight: 1.15 }}>
                {now !== undefined ? now.toFixed(2) : '—'}
              </TileValue>
              {delta !== null && (
                <span style={{
                  fontSize: 'var(--fs-xs)', fontWeight: 600,
                  // ⚠️ Цвет тут не про «хорошо/плохо», а про направление: рубль дешевеет — это
                  // рост курса валюты. Красим сдержанно, без светофора на весь виджет.
                  color: delta >= 0 ? TONE_WARM : TONE_GREEN,
                }}>
                  {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(2)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      {history.length > 1 && box.height > 150 && (
        <Sparkline values={history} height={chartH} />
      )}
    </Tile>
  );
}

// ── Крипта ────────────────────────────────────────────────────────────────────
// Отдельный виджет, а не строки в «Курсе ЦБ» выше. Три причины, и все три — не про вкус:
//  • цвет означает противоположное (см. TONE_GREEN/TONE_WARM);
//  • у ЦБ курс живёт сутки, у биткоина — минуты, и общий кэш врал бы одному из двух;
//  • подпись «Курс ЦБ» перестала бы быть правдой — крипты у ЦБ нет.
// Плитка намеренно такая же белая, как соседняя: пёстрые острова рядом превращают стол в витрину.

// Цена в рублях компактно. ⚠️ Без этого BTC (~9 500 000 ₽) в toFixed(2) даёт «9512340.00» и
// разрывает плитку: в строке кегль под 26px, а цифр четырнадцать.
function formatRub(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} млн`;
  if (v >= 10_000)    return `${Math.round(v / 1000).toLocaleString('ru')} тыс`;
  if (v >= 100)       return Math.round(v).toLocaleString('ru');
  if (v >= 1)         return v.toFixed(2);
  return v.toFixed(4); // мелочь вроде DOGE — иначе на экране был бы честный, но бесполезный «0.00»
}

export function CryptoWidget({ size, box, fill, overImage, hero }: WidgetProps) {
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [change, setChange] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<number[]>([]);

  const chosen = loadNewTabSettings().crypto.codes;
  // Та же теснота и то же решение, что у курса ЦБ выше: одна строка вместо каши из двух.
  const compact = box.height < COMPACT_H;
  const codes = (chosen.length ? chosen : ['BTC', 'ETH']).slice(0, compact ? 1 : size.w >= 4 ? 3 : 2);
  const main = codes[0] ?? 'BTC';

  useEffect(() => {
    let alive = true;
    void window.oblako.getCryptoRates().then((r) => {
      if (!alive || !r.rates) return;
      setRates(r.rates);
      setChange(r.change24h ?? {});
    }).catch(() => { /* курс — украшение, молчим */ });
    return () => { alive = false; };
  }, []);

  // График — по ПЕРВОМУ выбранному активу, тот же довод, что у курса ЦБ: несколько линий
  // в плитке такого размера превращаются в кашу.
  useEffect(() => {
    let alive = true;
    void window.oblako.getCryptoHistory(main, 30).then((v) => {
      if (alive) setHistory(v);
    }).catch(() => { /* график необязателен */ });
    return () => { alive = false; };
  }, [main]);

  // Тренд по первому активу — им же красим спарклайн, чтобы линия и стрелка не спорили.
  const mainUp = (change[main] ?? 0) >= 0;
  // «5.12 млн» / «150 тыс» — длиннее курса ЦБ, и кегль обязан это учитывать (см. formatRub).
  const rowFs = rowFontSize(box, codes.length, { chars: 8 });
  const chartH = Math.max(30, Math.round(box.height * 0.26));

  return (
    <Tile surface toned overImage={overImage} hero={hero} fill={fill}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, flex: 'none' }}>
        {/* ⚠️ Валюта — в подписи, а не в каждой строке: «₿ 5.02 млн» без неё не отвечает на вопрос
            «миллиона чего» (у соседнего виджета символ слева говорит это сам — «$ 78.42» читается
            как «рублей за доллар»). В строке ₽ не помещался и переносил её на две. */}
        <TileCaption>Крипта, ₽</TileCaption>
        {history.length > 1 && !compact && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{main} · 30 дней</span>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5 }}>
        {codes.map((c) => {
          const now = rates?.[c];
          const delta = change[c];
          // nowrap: «5.02 млн» + процент в узкой плитке иначе переносятся на вторую строку и
          // ломают ровный столбец цифр. Лучше подрезать, чем разъехаться.
          return (
            <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 9, whiteSpace: 'nowrap' }}>
              {/* ⚠️ Значок — картинка с логотипом монеты, а не символ из шрифта (см.
                  CryptoIcon.tsx): «Ξ» и «Ð» шрифт рисует неузнаваемо, а у SOL/XRP/TON знака
                  в Unicode нет вовсе и там оставался голый тикер. Выравнивание строки при
                  этом сменилось с baseline на center: у картинки базовой линии нет. */}
              <CryptoIcon code={c} size={Math.round(rowFs * 0.86)} />
              <TileValue size={rowFs} hero={hero} style={{ color: CARD_INK, lineHeight: 1.15 }}>
                {now !== undefined ? formatRub(now) : '—'}
              </TileValue>
              {delta !== undefined && (
                <span style={{
                  fontSize: 'var(--fs-xs)', fontWeight: 600,
                  // Здесь, в отличие от соседнего виджета, зелёный = вырос: так это читают все.
                  color: delta >= 0 ? TONE_GREEN : TONE_WARM,
                }}>
                  {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(2)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      {history.length > 1 && box.height > 150 && (
        <Sparkline
          values={history}
          height={chartH}
          color={mainUp ? TONE_GREEN : TONE_WARM}
          fill={mainUp ? FILL_GREEN : FILL_WARM}
        />
      )}
    </Tile>
  );
}

/**
 * Спарклайн курса. Рисуем сами SVG-полилинией, а не библиотекой: линия из тридцати точек без
 * осей и подписей — это десяток строк, а любая charting-библиотека тянет за собой сотни
 * килобайт ради того же результата.
 */
let sparkSeq = 0;
export function Sparkline({ values, height, color = TONE_GREEN, fill = FILL_GREEN }: {
  values: number[];
  height: number;
  // Цвет задаётся снаружи ради виджета «Крипта»: там линия должна краснеть на падающем активе,
  // а у курса ЦБ смысл цвета обратный — единого «правильного» цвета у спарклайна нет.
  color?: string;
  fill?: string;
}) {
  // ⚠️ Свой id у каждого графика: два спарклайна на одном экране с общим id получили бы одну
  // и ту же заливку — градиент в SVG адресуется по идентификатору документа, а не по элементу.
  const [gradId] = useState(() => `spark-${++sparkSeq}`);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 100; // работаем в процентах вьюбокса — плитка резиновая
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = height - ((v - min) / span) * (height - 6) - 3;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, marginTop: 8, flex: 'none', overflow: 'visible' }}
    >
      {/* Заливка под линией — она и придаёт графику «вес», без неё это просто царапина.
          ⚠️ Заливка — ГРАДИЕНТ от линии к прозрачности, а не ровный цвет: ровная плашка под
          кривой читается вырезанной фигурой, градиент — воздухом под ней. Второй цвет берётся у
          СПУТНИКА акцента (см. --companion): пара цветов и есть то место системы «Высота», где
          цвету разрешено звучать. */}
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${pts.join(' ')} ${w},${height}`}
        fill={`url(#${gradId})`}
      />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Часто открываете ──────────────────────────────────────────────────────────

function hostLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/**
 * Иконка сайта внутри виджета. ⚠️ У сайта без favicon.ico картинка не грузится, и раньше на её
 * месте оставалась ДЫРА (visibility: hidden) — ряд выглядел дырявым и неряшливым. Теперь на это
 * место встаёт буква на цветной подложке: место занято всегда, а цвет выводится из имени домена,
 * поэтому у одного сайта он не меняется от запуска к запуску.
 */
function FaviconTile({ host, size }: { host: string; size: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span style={{
        width: size, height: size, borderRadius: RADIUS.box, flex: 'none',
        background: siteTint(host),
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.43), fontWeight: 600, color: '#fff',
      }}>{(host.charAt(0) || '?').toUpperCase()}</span>
    );
  }

  return (
    <img
      src={`https://${host}/favicon.ico`}
      alt=""
      onError={() => setFailed(true)}
      // ⚠️ Кромка и тень обязательны. Подложка под значком белая, и когда плитка перестала быть
      // тёмной (часы и топ-сайты теперь идут за темой), белое легло на белое: у значков со
      // светлым фоном — а это половина сайтов — пропала форма, остался висеть логотип без
      // границ. На тёмной плитке проблемы не было видно вовсе, поэтому и всплыло только сейчас.
      // Кромка токеном, а не литералом: в тёмной теме она обязана становиться светлой.
      style={{
        width: size, height: size, borderRadius: RADIUS.box, objectFit: 'contain', flex: 'none',
        background: 'rgba(255,255,255,0.94)', padding: Math.round(size * 0.16), boxSizing: 'border-box',
        border: '1px solid var(--divider)',
        boxShadow: '0 1px 2px rgba(16,20,40,0.10), 0 2px 6px rgba(16,20,40,0.08)',
      }}
    />
  );
}

export function TopSitesWidget({ box, cell, tiles, onOpen, fill, overImage, hero }: WidgetProps) {
  // ⚠️ Подпись — ДОМЕН, а не заголовок страницы. Первая версия ставила сюда title, и «Далай
  // лама: смотрите и скачивайте изображения — Яндекс Картинки» расползался на всю плитку,
  // налезая на соседние иконки. Домен короткий, узнаваемый и примерно одной длины у всех.
  const pad = padOf(densityOf(cell));
  // ⚠️ Ячейка ужимается вместе с клеткой стола: 76×80 были константой, и на узком окне сетка
  // сайтов оставалась прежней внутри уменьшившейся плитки — отсюда и налезание подписей.
  const { w: cellW, h: cellH } = tileGridCell(cell);
  const inner = box.width - pad * 2;
  const cols = Math.max(2, Math.floor((inner + 12) / (cellW + 12)));
  const rows = Math.max(1, Math.floor((box.height - pad * 2 - 26 + 12) / (cellH + 12)));
  const shown = tiles.slice(0, cols * rows);

  return (
    <Tile surface toned overImage={overImage} hero={hero} fill={fill}>
      <TileCaption>Часто открываете</TileCaption>
      {shown.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: 'var(--fs-sm)', opacity: 0.85 }}>
          Пока пусто — история наберётся сама.
        </div>
      ) : (
        <div style={{
          flex: 1, marginTop: 12, display: 'grid', gap: 12,
          gridTemplateColumns: `repeat(${cols}, 1fr)`, alignContent: 'start',
        }}>
          {shown.map((t) => (
            <button
              key={t.origin}
              onClick={() => onOpen(t.url)}
              title={t.title || hostLabel(t.url)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                background: 'transparent', border: 'none', cursor: 'default', padding: 0,
                minWidth: 0, color: 'inherit',
              }}
            >
              <FaviconTile host={hostLabel(t.url)} size={Math.round(cellW * 0.58)} />
              <span style={{
                maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontSize: 'var(--fs-xs)', opacity: 0.9,
              }}>{hostLabel(t.url)}</span>
            </button>
          ))}
        </div>
      )}
    </Tile>
  );
}

// ── Дела ──────────────────────────────────────────────────────────────────────
// Тоже белый остров — по той же причине, что и курс. Заодно снялся вопрос читаемости: тёмный
// текст на белом не требует подбора контраста вовсе.
// Акцент дел — тёплый янтарный: он остался в галочках и кнопке, где и нужен.
const TASKS_ACCENT = '#E08A1E';
const TASKS_KEY = 'oblako-desktop-tasks';

interface Task { id: string; text: string; done: boolean }

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as Task[]).filter((t) => t && typeof t.text === 'string') : [];
  } catch { return []; }
}

function saveTasks(list: Task[]): void {
  try { localStorage.setItem(TASKS_KEY, JSON.stringify(list)); } catch { /* квота — не критично */ }
}

/**
 * Список дел прямо на столе. Пока полностью локальный (localStorage): синхронизация с календарём
 * — отдельная задача с чужим API и учётными данными, и делать её вслепую под непроверенный
 * визуал не стоит. Формат записи выбран так, чтобы будущий источник событий добавил себе поле,
 * а не переписывал хранилище.
 */
export function TasksWidget({ box, fill, overImage, hero }: WidgetProps) {
  const [tasks, setTasks] = useState<Task[]>(loadTasks);
  const [draft, setDraft] = useState('');

  const update = (next: Task[]): void => { setTasks(next); saveTasks(next); };
  const toggle = (id: string): void => update(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: string): void => update(tasks.filter((t) => t.id !== id));
  const add = (): void => {
    const text = draft.trim();
    if (!text) return;
    update([...tasks, { id: `${Date.now()}`, text, done: false }]);
    setDraft('');
  };

  const capacity = Math.max(1, Math.floor((box.height - 96) / 28));
  const left = tasks.filter((t) => !t.done).length;

  return (
    <Tile surface toned overImage={overImage} hero={hero} fill={fill}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flex: 'none' }}>
        <TileCaption>Дела</TileCaption>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          {tasks.length === 0 ? '' : left ? `осталось ${left}` : 'всё сделано'}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {tasks.slice(0, capacity).map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => toggle(t.id)}
              title={t.done ? 'Вернуть в дела' : 'Сделано'}
              style={{
                width: 18, height: 18, flex: 'none', borderRadius: RADIUS.control, cursor: 'default',
                border: t.done ? 'none' : `1.5px solid ${TASKS_ACCENT}`,
                background: t.done ? TASKS_ACCENT : 'transparent',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              }}
            >{t.done && <Check size={12} style={{ color: '#fff' }} />}</button>
            <span style={{
              flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', textAlign: 'left',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textDecoration: t.done ? 'line-through' : 'none', opacity: t.done ? 0.6 : 1,
            }}>{t.text}</span>
            <button
              onClick={() => remove(t.id)}
              title="Убрать"
              style={{
                border: 'none', background: 'transparent', cursor: 'default', padding: 2,
                color: 'inherit', opacity: 0.55, display: 'inline-flex', flex: 'none',
              }}
            ><X size={13} /></button>
          </div>
        ))}
        {tasks.length === 0 && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Записывайте, что нужно не забыть.</div>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); add(); }}
        style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none', marginTop: 8 }}
      >
        <input
          className="oblako-tile-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Новое дело"
          // ⚠️ Поле осталось с тех пор, когда плитка была цветной: белый текст на почти чёрной
          // подложке. На белой плитке это давало белые буквы на светло-сером — набранное дело было
          // не видно вовсе. Теперь поле берёт колодец и текст из темы, как все поля в браузере.
          style={{
            flex: 1, minWidth: 0, height: 30, padding: '0 10px',
            borderRadius: RADIUS.pill, border: '1px solid var(--divider)',
            background: 'var(--surface-sunken)', color: 'var(--text-body)',
            fontSize: 'var(--fs-sm)', outline: 'none',
          }}
        />
        <button
          type="submit"
          title="Добавить"
          style={{
            width: 30, height: 30, flex: 'none', borderRadius: RADIUS.pill, border: 'none', cursor: 'default',
            background: TASKS_ACCENT, color: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        ><Plus size={16} /></button>
      </form>
    </Tile>
  );
}

// ── Музыка ────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ ВИДЖЕТ НЕ ЗНАЕТ НИ ОДНОГО СЕРВИСА ПОИМЁННО, и это главное решение. Он показывает то, что
// играет в браузере ПРЯМО СЕЙЧАС, читая стандартную медиасессию страницы (см.
// electron/MediaSessionManager.ts): Яндекс Музыка, Spotify, YouTube, VK, радио на случайном сайте
// — всё одинаково. Альтернатива была бы «поддержать три сервиса парсерами вёрстки» и чинить их
// после каждого редизайна.
//
// ⚠️ ОФОРМЛЕНИЕ ТОЖЕ ПРИХОДИТ ОТ СЕРВИСА: фон плитки — обложка альбома, поверх неё затемнение
// ради читаемости. Своей раскраски у виджета нет вовсе, поэтому он выглядит так, как выглядит
// то, что человек слушает, — и меняется вместе с треком.
const MUSIC_SERVICES: { label: string; url: string }[] = [
  { label: 'Яндекс Музыка', url: 'https://music.yandex.ru/' },
  { label: 'Spotify', url: 'https://open.spotify.com/' },
];
// Последний открытый отсюда сервис — чтобы во второй раз не выбирать заново.
const MUSIC_LAST_KEY = 'oblako-music-last';

export function MusicWidget({ box, cell, fill, overImage, hero: isHero, onOpen }: WidgetProps) {
  const [state, setState] = useState<MediaNowPlaying | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.oblako.getMediaState().then(setState).catch(() => { /* плитка только показывает */ });
    return window.oblako.onMediaState(setState);
  }, []);

  const playing = state?.playbackState === 'playing';
  const compact = box.height < 150;
  // ⚠️ Именно здесь на узком окне рождалось наложение со снимка: две кнопки сервисов переносились
  // на две строки, контент становился выше коробки, а центрирование при переполнении растит его
  // в ОБЕ стороны — верхняя строка уезжала под подпись плитки (см. shared/tileBudget.ts).
  const fit = musicFit(box, cell);

  async function cmd(action: MediaCommand) {
    setBusy(true);
    try { await window.oblako.sendMediaCommand(action); } finally { setBusy(false); }
  }

  function open(url: string) {
    try { localStorage.setItem(MUSIC_LAST_KEY, url); } catch { /* см. loadWallpaper */ }
    onOpen(url);
  }

  // ── Ничего не играет: предлагаем открыть сервис ──────────────────────────────────────────
  if (!state || !state.title) {
    let last = '';
    try { last = localStorage.getItem(MUSIC_LAST_KEY) ?? ''; } catch { /* см. loadWallpaper */ }
    const lastLabel = last ? (MUSIC_SERVICES.find((x) => x.url === last)?.label ?? hostLabel(last)) : '';
    return (
      <Tile surface toned overImage={overImage} hero={isHero} fill={fill} padding={padOf(densityOf(cell))}>
        <TileCaption>Музыка</TileCaption>
        {/* ⚠️ `safe center` — не косметика: обычный center при переполнении выталкивает содержимое
            за ОБА края, и первая строка садится на подпись плитки. Safe в тесноте прижимает к
            началу и обрезки не даёт вовсе. */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'safe center', gap: 8 }}>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--nt-text-muted, var(--text-muted))' }}>
            Ничего не играет
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {/* ⚠️ Кнопки открывают сервис ОБЫЧНОЙ ВКЛАДКОЙ, а не встроенным плеером: свой плеер
                означал бы чужой логин, чужую подписку и чужой DRM — то есть работу, которую уже
                сделал сам сервис. Наше дело — управлять тем, что он играет. */}
            {(lastLabel ? [{ label: lastLabel, url: last }] : MUSIC_SERVICES.slice(0, fit.services)).map((svc) => (
              <button
                key={svc.url}
                onClick={() => open(svc.url)}
                style={{
                  padding: '6px 10px', borderRadius: RADIUS.control, border: 'none',
                  background: 'var(--accent)', color: 'var(--on-accent)',
                  fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'default',
                }}
              >{svc.label}</button>
            ))}
          </div>
          {fit.hint && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--nt-text-muted, var(--text-muted))' }}>
              Подхватит любой сервис — виджет читает то, что играет во вкладке.
            </div>
          )}
        </div>
      </Tile>
    );
  }

  // ── Играет: обложка фоном, поверх — трек и кнопки ────────────────────────────────────────
  const btn = (icon: React.ReactNode, action: MediaCommand, primary = false, enabled = true) => (
    <button
      onClick={() => { if (enabled && !busy) void cmd(action); }}
      title={action === 'play' ? 'Играть' : action === 'pause' ? 'Пауза' : action === 'nexttrack' ? 'Следующий' : 'Предыдущий'}
      style={{
        width: primary ? fit.primary : fit.secondary, height: primary ? fit.primary : fit.secondary, flex: 'none',
        borderRadius: '50%', border: 'none', cursor: 'default',
        display: 'grid', placeItems: 'center',
        background: primary ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.18)',
        color: primary ? '#111114' : '#FFFFFF',
        opacity: enabled ? 1 : 0.35,
        transition: 'background var(--dur-fast) var(--ease-standard)',
      }}
    >{icon}</button>
  );

  const can = (a: MediaCommand) => state.actions.includes(a);

  return (
    <Tile overImage={overImage} hero={isHero} padding={0}>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'inherit' }}>
        {state.artwork ? (
          <img
            src={state.artwork}
            alt=""
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(165deg, #3B4350 0%, #23272F 100%)' }} />
        )}
        {/* ⚠️ Затемнение снизу, а не по всей площади: обложка должна остаться узнаваемой, а текст
            и кнопки живут в нижней трети — там и нужен контраст. */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, rgba(8,10,16,0.10) 0%, rgba(8,10,16,0.42) 46%, rgba(8,10,16,0.86) 100%)',
        }} />
      </div>

      <div style={{
        position: 'relative', height: '100%', display: 'flex', flexDirection: 'column',
        justifyContent: 'flex-end', gap: 8, padding: compact ? 12 : 16, color: '#FFFFFF',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 'var(--fs-xs)', opacity: 0.72, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{state.host}</div>
          <div style={{
            fontWeight: 600, fontSize: compact ? 'var(--fs-sm)' : 'var(--fs-md)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{state.title}</div>
          {!compact && state.artist && (
            <div style={{
              fontSize: 'var(--fs-sm)', opacity: 0.82, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{state.artist}</div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {btn(<SkipBack size={14} fill="currentColor" />, 'previoustrack', false, can('previoustrack'))}
          {/* ⚠️ Пауза и «играть» доступны ВСЕГДА: обработчик может быть не зарегистрирован, но
              нажать на сам медиаэлемент страницы мы умеем (фолбэк в preload-content.ts). */}
          {playing
            ? btn(<Pause size={16} fill="currentColor" />, 'pause', true)
            : btn(<Play size={16} fill="currentColor" style={{ marginLeft: 2 }} />, 'play', true)}
          {btn(<SkipForward size={14} fill="currentColor" />, 'nexttrack', false, can('nexttrack'))}
        </div>
      </div>
    </Tile>
  );
}


export const WIDGET_RENDERERS: Record<string, (p: WidgetProps) => React.ReactElement> = {
  clock: ClockWidget,
  weather: WeatherWidget,
  rates: RatesWidget,
  crypto: CryptoWidget,
  topsites: TopSitesWidget,
  tasks: TasksWidget,
  music: MusicWidget,
  // Без сети — см. localWidgets.tsx.
  moon: MoonWidget,
  shield: ShieldWidget,
  digest: DigestWidget,
  downloads: DownloadsWidget,
  holiday: HolidayWidget,
  tracking: TrackingWidget,
  calendar: CalendarWidget,
  timer: TimerWidget,
};
