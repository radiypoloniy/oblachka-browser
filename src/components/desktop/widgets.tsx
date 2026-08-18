import { useEffect, useState } from 'react';
import type React from 'react';
import { Check, Plus, X } from 'lucide-react';
import type { TileSite } from '../../../shared/frecency';
import type { CellSize } from '../../newtab/desktop';
import { card, cardGlass, grain, RADIUS, DISPLAY, CARD_COLOR_ENABLED, CARD_INK, altitude, ALTITUDE, HERO_ENABLED } from '../../styles/system';
import { loadNewTabSettings } from '../../newtab/settings';
import CryptoIcon from '../CryptoIcon';
import { siteTint } from './siteTint';
import { MoonWidget, ShieldWidget, DownloadsWidget, HolidayWidget, DigestWidget, TrackingWidget } from './localWidgets';

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
export const WIDGET_FILLS: { id: string; label: string; css: string | null }[] = [
  { id: 'theme',  label: 'Как тема', css: null },
  { id: 'blue',   label: 'Синий',    css: 'linear-gradient(165deg, #4E92E8 0%, #2E6FC4 100%)' },
  { id: 'teal',   label: 'Бирюза',   css: 'linear-gradient(165deg, #35B6C4 0%, #2391A4 100%)' },
  { id: 'green',  label: 'Зелёный',  css: 'linear-gradient(165deg, #46BE7A 0%, #2FA063 100%)' },
  { id: 'orange', label: 'Оранж',    css: 'linear-gradient(165deg, #FFA53D 0%, #F1811A 100%)' },
  { id: 'pink',   label: 'Розовый',  css: 'linear-gradient(165deg, #F2708F 0%, #DF5175 100%)' },
  { id: 'slate',  label: 'Графит',   css: 'linear-gradient(165deg, #5A6472 0%, #3B4350 100%)' },
];

// ⚠️ Образец цвета в пикере — ПЛОСКИЙ, а не тот же градиент, что на плитке. На кружке 22 px
// градиент не читается как объём: он превращается в грязное пятно с невнятной серединой, и
// набор таких кружков выглядит дёшево. Плитка при этом остаётся с градиентом — там он работает,
// потому что поверхность большая.
export const FILL_SWATCH: Record<string, string> = {
  theme:  'var(--surface-sunken)',
  blue:   '#3C81DA',
  teal:   '#2AA0B0',
  green:  '#3AAE6D',
  orange: '#F5931F',
  pink:   '#E8617F',
  slate:  '#4C5665',
};

export function fillCss(id: string | undefined): string | null {
  return WIDGET_FILLS.find((f) => f.id === id)?.css ?? null;
}

export function Tile({ children, tint, padding = 16, surface, fill, toned, overImage, hero, onActivate }: {
  children: React.ReactNode;
  /** Заливка цветной плитки. Игнорируется при surface. */
  tint?: string;
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
  const useGlass = !custom && !useHero && surface && !!overImage;
  const useCard = !custom && !useHero && surface && !!toned && !useGlass && CARD_COLOR_ENABLED;
  const heroStyle = useHero ? altitude(ALTITUDE.hero, { content: true }) : null;
  const toneStyle = heroStyle ?? (useGlass ? cardGlass() : useCard ? card(toned === 'high') : null);
  const onSurface = surface && !custom && !useCard && !useGlass && !useHero;
  return (
    <div onClick={onActivate} style={{
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
      // На выбранной заливке текст всегда белый: все заливки набора тёмные настолько, что
      // --text-body на них не читался бы.
      color: toneStyle?.color ?? (onSurface ? 'var(--text-body)' : '#fff'),
      padding,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Зерно: тонкая текстура поверх заливки — она и отличает материал от плоской заливки из
          макета. Только на тонированных плитках: на своей картинке человека и на фото дня зерно
          было бы грязью. */}
      {useCard && <div style={grain} />}
      {children}
    </div>
  );
}

export function TileCaption({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
      textTransform: 'uppercase', opacity: 0.75, flex: 'none',
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
const CLOCK_SECOND = '#FF9F0A';

function tinyDial(box: { width: number; height: number }, avail: number, dateH: number): number {
  const small = box.height < 150;
  const reserved = small ? 0 : 20 + dateH;
  return Math.max(44, Math.min(avail, box.height - (small ? 24 : 32) - reserved));
}

export function ClockWidget({ box, fill, city, overImage, hero }: WidgetProps) {
  const [now, setNow] = useState(() => new Date());
  const opts = loadNewTabSettings().clock;
  const analog = opts.face !== 'digital';

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), opts.seconds ? 1_000 : 15_000);
    return () => clearInterval(t);
  }, [opts.seconds]);

  // ⚠️ Дуга дня — САМОСТОЯТЕЛЬНЫЙ широкий вид, а не альтернатива циферблату, и показывается в
  // растянутой плитке НЕЗАВИСИМО от выбора аналог/цифры. Причина: широкий аналоговый циферблат —
  // это круг с пустотой в половину плитки по бокам, а человек, растянувший часы, просил ровно
  // «в растянутом виде даёт больше». Восход/закат берём из погоды (уже кэшируется, тот же город) —
  // своей геолокации часам не заводим. Порог по пропорции, не по числу клеток: «заметно шире, чем
  // высокая» — ровно тот случай, где появляется место под горизонтальную дугу. Нет города или
  // данных — откат на обычный вид (аналог/цифры) ниже.
  const wide = box.width > box.height * 1.7;
  const sun = useSunTimes(wide ? city : '');
  if (wide && sun) {
    return <DayArcClock box={box} fill={fill} now={now} sunrise={sun.rise} sunset={sun.set}
      time={fmtTime(now, opts)} weekday={now.toLocaleDateString('ru-RU', { weekday: 'long' })} />;
  }

  const time = fmtTime(now, opts);
  const weekday = now.toLocaleDateString('ru-RU', { weekday: 'long' });
  const dayMonth = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  // Кегль считаем от ДЛИНЫ строки, а не от одной ширины плитки: «18:50» и «18:50:07» занимают
  // разное место, и общий коэффициент неизбежно ошибается на одном из них — в маленьком виджете
  // время упиралось в край. 0.56 — доля ширины цифры от кегля у моноширинных цифр (tabular-nums)
  // нашего шрифта, замерена по факту. Потолок по высоте и общий потолок остаются.
  const avail = box.width - 32; // минус паддинги плитки
  const fs = Math.round(Math.min(box.height * 0.42, avail / (time.length * 0.56), 92));

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
  return (
    <Tile surface toned overImage={overImage} hero={hero} fill={fill} padding={tiny ? 12 : 16}>
      {!tiny && <TileCaption>{weekday}</TileCaption>}
      {analog ? (
        <div style={{
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <AnalogFace size={dial} now={now} seconds={opts.seconds} />
          {opts.date && !tiny && (
            <div style={{ fontSize: 13, opacity: 0.8, textAlign: 'center' }}>{dayMonth}</div>
          )}
        </div>
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
          <div style={{
            fontSize: fs, fontWeight: 250, lineHeight: 1,
            fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
          }}>{time}</div>
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

/**
 * Циферблат. Рисуем сами SVG в системе координат 100×100 и масштабируем размером самого <svg> —
 * так же, как спарклайн ниже: круг, дюжина рисок и три стрелки не стоят внешней зависимости, а
 * фиксированный вьюбокс избавляет от пересчёта всех координат под резиновую плитку.
 */
function AnalogFace({ size, now, seconds }: { size: number; now: Date; seconds: boolean }) {
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();
  // Часовая идёт ПЛАВНО за минутами (+0.5° на минуту), минутная — за секундами. Иначе в 10:59
  // часовая всё ещё указывала бы ровно на 10, и время читалось бы неверно на целый час.
  const hourAngle = h * 30 + m * 0.5;
  const minAngle  = m * 6 + s * 0.1;
  const secAngle  = s * 6;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: 'block', flex: 'none' }}>
      {/* ⚠️ Циферблат рисуется currentColor, а не белым. Он делался под тёмную плитку, и когда часы
          пошли за темой, весь циферблат стал белым по белому — со стороны это выглядело как
          «аналоговые часы не работают», хотя они исправно рисовались невидимыми. currentColor
          наследуется от плитки: тёмный на светлой поверхности, белый на выбранной заливке. */}
      <circle cx="50" cy="50" r="47" fill="currentColor" fillOpacity="0.05" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1" />
      {/* Двенадцать рисок; каждая третья (12/3/6/9) крупнее — по ним глаз и цепляется. */}
      {Array.from({ length: 12 }, (_, i) => {
        const major = i % 3 === 0;
        return (
          <line
            key={i}
            x1="50" y1={major ? 8 : 9.5} x2="50" y2={major ? 15 : 13}
            stroke="currentColor" strokeOpacity={major ? 0.85 : 0.4}
            strokeWidth={major ? 2.6 : 1.4} strokeLinecap="round"
            transform={`rotate(${i * 30} 50 50)`}
          />
        );
      })}
      <Hand angle={hourAngle} length={25} width={4.8} color="currentColor" />
      <Hand angle={minAngle}  length={36} width={3.2} color="currentColor" />
      {seconds && <Hand angle={secAngle} length={40} width={1.3} color={CLOCK_SECOND} tail={9} />}
      <circle cx="50" cy="50" r="3" fill="currentColor" />
      {seconds && <circle cx="50" cy="50" r="1.5" fill={CLOCK_SECOND} />}
    </svg>
  );
}

// Стрелка — линия из центра вверх, повёрнутая на угол. tail — хвостик за центром (есть только у
// секундной, как у настоящих часов).
function Hand({ angle, length, width, color, tail = 0 }: {
  angle: number; length: number; width: number; color: string; tail?: number;
}) {
  return (
    <line
      x1="50" y1={50 + tail} x2="50" y2={50 - length}
      stroke={color} strokeWidth={width} strokeLinecap="round"
      transform={`rotate(${angle} 50 50)`}
    />
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

// Дуга дня: небо-градиент, дуга от восхода до заката, светило (солнце днём / луна ночью) на позиции
// текущего момента. Время и день — в углу. Показывается только в широком виде (см. ClockWidget).
function DayArcClock({ box, fill, now, sunrise, sunset, time, weekday }: {
  box: { width: number; height: number };
  fill?: string;
  now: Date;
  sunrise: number; // минуты от полуночи
  sunset: number;
  time: string;
  weekday: string;
}) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isDay = nowMin >= sunrise && nowMin <= sunset;
  // Доля пути: днём — вдоль дуги от восхода к закату; ночью — вдоль «подземной» части от заката к
  // восходу следующего дня. Так светило непрерывно обходит круг за сутки, а не прыгает.
  const dayLen = sunset - sunrise;
  const nightLen = 24 * 60 - dayLen;
  const frac = isDay
    ? (nowMin - sunrise) / dayLen
    : ((nowMin < sunrise ? nowMin + 24 * 60 : nowMin) - sunset) / nightLen;

  // Геометрия в координатах 200×100: дуга — полукруг радиуса 78 с центром у нижнего края, горизонт
  // на y=88. Днём светило идёт по ВЕРХНЕЙ дуге (слева направо), ночью — символически ниже горизонта.
  const cx = 100, cy = 88, r = 78;
  const angle = Math.PI * (isDay ? frac : frac); // 0…π
  const bodyX = cx - r * Math.cos(angle);
  const bodyY = isDay ? cy - r * Math.sin(angle) : cy + 8 + 6 * Math.sin(angle);
  const riseX = cx - r, setX = cx + r;

  const skyDay = 'linear-gradient(160deg, #4A90D9 0%, #7EB6E8 55%, #F5C777 100%)';
  const skyNight = 'linear-gradient(165deg, #1B2A4A 0%, #2C3E63 60%, #4A5578 100%)';

  const remain = isDay ? sunset - nowMin : sunrise - (nowMin < sunrise ? nowMin : nowMin - 24 * 60);
  const remainH = Math.floor(Math.abs(remain) / 60), remainM = Math.abs(remain) % 60;
  const remainLabel = isDay
    ? `светло ещё ${remainH ? remainH + ' ч' : ''}${remainM ? ' ' + remainM + ' мин' : ''}`.trim()
    : `рассвет через ${remainH ? remainH + ' ч' : ''}${remainM ? ' ' + remainM + ' мин' : ''}`.trim();

  const pad = 16;
  const svgH = box.height - pad * 2 - 28; // минус строка времени сверху

  return (
    // Заливку человека уважаем (fill перебивает небо) — тот же приём, что у остальных плиток; иначе
    // рисуем живое небо. Само небо — не токен темы: это носитель настроения, как цвет у погоды.
    <Tile tint={fill ?? (isDay ? skyDay : skyNight)} fill={fill} padding={pad}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flex: 'none' }}>
        <span style={{ fontSize: Math.min(box.height * 0.24, 34), fontWeight: 300, lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{time}</span>
        <span style={{ fontSize: 'var(--fs-sm)', opacity: 0.85, textTransform: 'capitalize' }}>{weekday}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'flex-end' }}>
        <svg width="100%" height={Math.max(60, svgH)} viewBox="0 0 200 100" preserveAspectRatio="xMidYMax meet" style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            <linearGradient id="arcTrack" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0.25" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0.6" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.25" />
            </linearGradient>
          </defs>
          {/* Линия горизонта */}
          <line x1="8" y1={cy} x2="192" y2={cy} stroke="#fff" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="2 3" />
          {/* Дуга дневного пути */}
          <path d={`M ${riseX} ${cy} A ${r} ${r} 0 0 1 ${setX} ${cy}`} fill="none" stroke="url(#arcTrack)" strokeWidth="2" strokeLinecap="round" />
          {/* Пройденная часть дуги — до текущего светила, ярче (только днём) */}
          {isDay && (
            <path d={`M ${riseX} ${cy} A ${r} ${r} 0 0 1 ${bodyX} ${bodyY}`} fill="none" stroke="#FFE9A8" strokeWidth="2.6" strokeLinecap="round" />
          )}
          {/* Метки восхода/заката */}
          <circle cx={riseX} cy={cy} r="2.4" fill="#fff" fillOpacity="0.75" />
          <circle cx={setX} cy={cy} r="2.4" fill="#fff" fillOpacity="0.75" />
          {/* Светило */}
          {isDay ? (
            <g>
              <circle cx={bodyX} cy={bodyY} r="9" fill="#FFD65C" />
              <circle cx={bodyX} cy={bodyY} r="14" fill="#FFD65C" fillOpacity="0.25" />
            </g>
          ) : (
            // Луна — круг с «откушенным» краем через маску, читается лунным серпом даже мелко.
            <g>
              <defs>
                <mask id="moon"><rect x="0" y="0" width="200" height="100" fill="#fff" /><circle cx={bodyX + 4} cy={bodyY - 3} r="8" fill="#000" /></mask>
              </defs>
              <circle cx={bodyX} cy={bodyY} r="7.5" fill="#E8ECF5" mask="url(#moon)" />
            </g>
          )}
        </svg>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-xs)', opacity: 0.85, flex: 'none', marginTop: 2 }}>
        <span>🌅 {minutesToHHMM(sunrise)}</span>
        <span style={{ opacity: 0.9 }}>{remainLabel}</span>
        <span>{minutesToHHMM(sunset)} 🌇</span>
      </div>
    </Tile>
  );
}

function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60), min = m % 60;
  return `${h}:${String(min).padStart(2, '0')}`;
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
function weatherTint(code: number, isDay: boolean): string {
  if (!isDay) return 'linear-gradient(160deg, #2B3B5B 0%, #1B2437 65%, #141A28 100%)';
  if (code >= 71) return 'linear-gradient(160deg, #8FA6C4 0%, #5C77A0 100%)';
  if (code >= 51) return 'linear-gradient(160deg, #6E86A8 0%, #47597B 100%)';
  if (code >= 3)  return 'linear-gradient(160deg, #7C93B4 0%, #566A8C 100%)';
  return 'linear-gradient(160deg, #4FA3E3 0%, #2E7BC4 55%, #2463A8 100%)';
}

export function WeatherWidget({ size, box, city, hero }: WidgetProps) {
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
      <Tile tint="linear-gradient(160deg, #7C93B4 0%, #566A8C 100%)" hero={hero}>
        <TileCaption>Погода</TileCaption>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: 'var(--fs-sm)', opacity: 0.9, lineHeight: 1.4 }}>
          {city ? 'Не удалось загрузить' : 'Укажите город в настройках интерфейса'}
        </div>
      </Tile>
    );
  }

  const wide = size.w >= 4;
  const tempSize = Math.round(Math.min(box.height * (wide ? 0.3 : 0.34), 64));
  const hours = data?.hours.slice(0, wide ? 6 : 3) ?? [];

  return (
    <Tile tint={weatherTint(data?.code ?? 0, data?.isDay ?? true)} hero={hero}>
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
        <span style={hero
          ? { ...DISPLAY, fontSize: Math.round(tempSize * 1.1), fontWeight: 600 }
          : { fontSize: tempSize, fontWeight: 250, lineHeight: 1, letterSpacing: '-0.03em' }}>
          {data ? `${data.t}°` : '—'}
        </span>
        <WeatherIcon code={data?.code ?? 0} day={data?.isDay ?? true} size={Math.round(tempSize * 1.05)} />
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
      {(data?.aqi !== undefined || data?.sunrise) && box.height > 120 && (
        <div style={{
          display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap',
          fontSize: 'var(--fs-xs)', opacity: 0.85,
        }}>
          {data.aqi !== undefined && <span>Воздух: {data.aqi} · {aqiLabel(data.aqi)}</span>}
          {data.sunrise && data.sunset && <span>↑ {data.sunrise} ↓ {data.sunset}</span>}
        </div>
      )}

      {/* Почасовой ряд — то, чем виджет Apple заполняет нижнюю половину. Появляется, только
          если место под него реально есть: втиснутый в низкую плитку он был бы кашей. */}
      {hours.length > 0 && box.height > 150 && (
        <div style={{
          marginTop: 'auto', paddingTop: 10, display: 'flex', justifyContent: 'space-between',
          borderTop: '1px solid rgba(255,255,255,0.18)',
        }}>
          {hours.map((h) => (
            <div key={h.hour} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.8 }}>{String(h.hour).padStart(2, '0')}</span>
              <WeatherIcon code={h.code} day={h.hour >= 7 && h.hour <= 20} size={30} />
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
  const byWidth = (box.width - 32 - forDelta - 9) / (1.1 + 0.62 * chars);
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
              <span style={{ ...DISPLAY, fontSize: rowFs, lineHeight: 1.15, color: CARD_INK }}>
                {now !== undefined ? now.toFixed(2) : '—'}
              </span>
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
              <span style={{ ...DISPLAY, fontSize: rowFs, lineHeight: 1.15, color: CARD_INK }}>
                {now !== undefined ? formatRub(now) : '—'}
              </span>
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
export function Sparkline({ values, height, color = TONE_GREEN, fill = FILL_GREEN }: {
  values: number[];
  height: number;
  // Цвет задаётся снаружи ради виджета «Крипта»: там линия должна краснеть на падающем активе,
  // а у курса ЦБ смысл цвета обратный — единого «правильного» цвета у спарклайна нет.
  color?: string;
  fill?: string;
}) {
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
      {/* Заливка под линией — она и придаёт графику «вес», без неё это просто царапина. */}
      <polygon
        points={`0,${height} ${pts.join(' ')} ${w},${height}`}
        fill={fill}
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
function FaviconTile({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span style={{
        width: 44, height: 44, borderRadius: 12, flex: 'none',
        background: siteTint(host),
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 19, fontWeight: 600, color: '#fff',
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
        width: 44, height: 44, borderRadius: 12, objectFit: 'contain', flex: 'none',
        background: 'rgba(255,255,255,0.94)', padding: 7, boxSizing: 'border-box',
        border: '1px solid var(--divider)',
        boxShadow: '0 1px 2px rgba(16,20,40,0.10), 0 2px 6px rgba(16,20,40,0.08)',
      }}
    />
  );
}

export function TopSitesWidget({ box, tiles, onOpen, fill, overImage, hero }: WidgetProps) {
  // ⚠️ Подпись — ДОМЕН, а не заголовок страницы. Первая версия ставила сюда title, и «Далай
  // лама: смотрите и скачивайте изображения — Яндекс Картинки» расползался на всю плитку,
  // налезая на соседние иконки. Домен короткий, узнаваемый и примерно одной длины у всех.
  const pad = 16;
  const cellW = 76;
  const cellH = 80;
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
              <FaviconTile host={hostLabel(t.url)} />
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
                width: 18, height: 18, flex: 'none', borderRadius: 6, cursor: 'default',
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
            borderRadius: 999, border: '1px solid var(--divider)',
            background: 'var(--surface-sunken)', color: 'var(--text-body)',
            fontSize: 'var(--fs-sm)', outline: 'none',
          }}
        />
        <button
          type="submit"
          title="Добавить"
          style={{
            width: 30, height: 30, flex: 'none', borderRadius: 999, border: 'none', cursor: 'default',
            background: TASKS_ACCENT, color: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        ><Plus size={16} /></button>
      </form>
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
  // Без сети — см. localWidgets.tsx.
  moon: MoonWidget,
  shield: ShieldWidget,
  digest: DigestWidget,
  downloads: DownloadsWidget,
  holiday: HolidayWidget,
  tracking: TrackingWidget,
};
