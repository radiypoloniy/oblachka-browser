import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  Shield, Sparkles, Check, Loader2, ArrowRight, ArrowLeft, FileUp,
  Globe, BrainCircuit, Link2, Search, Palette, LayoutGrid,
} from 'lucide-react';
import type {
  ImportSource, ImportDataType, ImportRunResult, ImportTypeResult,
  CatalogEntry, InstalledModel, DownloadProgress, BackfillProgress,
  ThemeMode, ThemePaletteId, ThemePrefs,
} from '../../shared/ipc';
import { isDarkTheme } from '../../shared/ipc';
import { islandPlate, untintedPlateVars } from '../styles/island';
import { btnPrimary, btnGhost } from './settings/kit';
import BrowserLogo from './BrowserLogo';
import { CAPS, RADIUS, TEXT, DISPLAY, grain, sp } from '../styles/system';

// Экран первого запуска: короткий рассказ о том, чем этот браузер отличается, и перенос данных
// из привычного браузера последним шагом.
//
// Почему рассказ идёт ПЕРЕД переносом: перенос — просьба к человеку, который ещё не понял, зачем
// ему эта программа. Сначала показываем, что он получит, потом просим доступ к его данным.
//
// ⚠️ Экран живёт в чроме (React), а не в своей вью, и это осознанно: на первом запуске активен
// хаб, страницы под ним нет, и нативной вью, которая перекрыла бы разметку, тоже нет. Как только
// человек закроет онбординг, всё вернётся к обычной жизни.

interface Props {
  onFinish: () => void;
}

// ⚠️ Эмодзи в заголовках больше нет. Они были единственной типографикой экрана, которую рисуем
// не мы: системный глиф со своей палитрой рядом с нашим набором читается наклейкой, а на первом
// экране это первое впечатление. Роль «о чём слайд» теперь целиком на иллюстрации.
// ── Иллюстрации ───────────────────────────────────────────────────────────────
// Рисуем разметкой, а не картинками: интерфейс здесь и есть предмет разговора, а нарисованный
// теми же токенами он совпадает с тем, что человек увидит через минуту.
/**
 * Логотип Oblako вектором.
 *
 * ⚠️ Это ПЕРЕРИСОВКА настоящего знака (build/logo-source.png), а не «облако с нуля»: рисовать
 * своё облако рядом с существующим логотипом — значит завести второй знак у одного продукта.
 * Первая попытка так и вышла: три круга и скруглённая плита читались диваном, а не облаком.
 *
 * Почему вектор, а не сам PNG: знак должен жить на любом кегле (210 px на первом экране, 62 px в
 * шаге переноса, дальше — где понадобится) и не мылиться на HiDPI, а растр под это пришлось бы
 * держать в трёх размерах.
 *
 * ⚠️ Цвета ФИРМЕННЫЕ и НЕ следуют палитре — в отличие от всего остального в интерфейсе. Логотип
 * узнают по цвету; перекрашенный под «Мяту» знак — это уже другой знак. Сиреневая ступень взята
 * из оригинала и держится на 252° — вне сектора, который стережёт conventions-check, и это не
 * обход правила: закон запрещает фиолетовый в СИСТЕМНЫХ ролях, а тут фирменный знак.
 */
function OblakoLogo({ size = 200 }: { size?: number }) {
  // id градиентов уникальны по размеру: два знака на одном экране (первый слайд и шаг переноса)
  // с одинаковыми id подхватили бы чужие defs.
  const uid = `oblako-logo-${size}`;
  return (
    <svg
      width={size} height={size} viewBox="0 0 200 200" aria-hidden
      style={{ display: 'block', filter: 'drop-shadow(0 14px 26px rgba(79, 111, 245, 0.28))' }}
    >
      <defs>
        {/* Небо: насыщенный синий сверху-слева, сиреневая ступень справа, светлая синь снизу. */}
        <linearGradient id={`${uid}-sky`} x1="0.08" y1="0.04" x2="0.92" y2="0.9">
          <stop offset="0%" stopColor="#4F6FF5" />
          <stop offset="40%" stopColor="#7C99FC" />
          <stop offset="70%" stopColor="#B7A8F0" />
          <stop offset="100%" stopColor="#9FC0FF" />
        </linearGradient>
        {/* Дальний ряд облаков — холоднее и темнее переднего, иначе слои сливаются в пятно. */}
        <linearGradient id={`${uid}-back`} x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#F1F4FE" />
          <stop offset="100%" stopColor="#D6E0F9" />
        </linearGradient>
        <linearGradient id={`${uid}-front`} x1="0.3" y1="0" x2="0.65" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="65%" stopColor="#F6F9FF" />
          <stop offset="100%" stopColor="#E4EBFC" />
        </linearGradient>
        {/* Облака обрезаны кругом — как в оригинале: знак читается «окном в небо». */}
        <clipPath id={`${uid}-clip`}><circle cx="100" cy="100" r="94" /></clipPath>
      </defs>

      <circle cx="100" cy="100" r="94" fill={`url(#${uid}-sky)`} />

      <g clipPath={`url(#${uid}-clip)`}>
        <g fill={`url(#${uid}-back)`}>
          <circle cx="137" cy="96" r="31" />
          <circle cx="171" cy="127" r="23" />
          <circle cx="53" cy="107" r="27" />
          <rect x="42" y="106" width="150" height="58" rx="29" />
        </g>
        {/* Верхний купол — главный объём знака. */}
        <circle cx="98" cy="88" r="47" fill={`url(#${uid}-front)`} />
        {/* Передняя гряда: два кома и общая плита-основание. */}
        <g fill={`url(#${uid}-front)`}>
          <circle cx="119" cy="141" r="47" />
          <circle cx="52" cy="147" r="31" />
          <rect x="28" y="141" width="162" height="72" rx="36" />
        </g>
      </g>
    </svg>
  );
}





function ArtStack({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 14,
    }}>{children}</div>
  );
}

function Pill({ text, dot, delay = 0 }: { text: string; dot?: string; delay?: number }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 11px', borderRadius: 'var(--radius-pill)',
      background: 'var(--surface-sunken)', color: 'var(--text-body)',
      fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap',
      animation: `oblako-onb-rise var(--dur-slow) var(--ease-out) ${delay}ms backwards`,
    }}>
      {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flex: 'none' }} />}
      {text}
    </span>
  );
}

// ── Схема окна для последнего шага ────────────────────────────────────────────
//
// ⚠️ РИСУНОК, А НЕ СКРИНШОТ, и это не лень: снимок протухнет на первом же редизайне и начнёт
// врать про собственный интерфейс. Схема собрана теми же токенами, что и настоящее окно, поэтому
// стареет вместе с ним.
//
// ⚠️ ПОЛОЖЕНИЕ СВЕРЕНО С КОДОМ, а не нарисовано по памяти — в первом макете подсветки стояли не
// там, и это делало схему хуже, чем её отсутствие:
//   • ЩИТ — внутри омнибокса, у его ЛЕВОГО края (Toolbar.tsx: значок замка перед полем ввода);
//   • ИИ — кнопка в ПРАВОМ кластере тулбара, открывает панель у правого края окна
//     (Toolbar.tsx::onToggleAiPanel, панель — AiPanelManager);
//   • ПРИЛОЖЕНИЯ — плитки на самом рабочем столе новой вкладки, в середине области контента
//     (DesktopScreen.tsx);
//   • НАСТРОЙКИ — в ПОДВАЛЕ сайдбара, рядом с «Новой вкладкой» и «Историей»
//     (Sidebar.tsx::iconBtn, onSettings).
// Координаты сверены с самой схемой ниже, а не подобраны на глаз:
//   полоса тулбара — top 0, height 44, padding 0 10, gap 6: кнопка сайдбара 18, навигация 46,
//   омнибокс тянется от x=86, правый кластер 42 у правого края;
//   сайдбар — left 10, top 50, bottom 10, width 96, подвал внизу;
//   область контента — left 116, top 50, плитки от x=126, y=60.
const MAP_SPOTS: { key: string; label: string; box: React.CSSProperties }[] = [
  // Щит стоит у ЛЕВОГО края омнибокса — там же, где замок в Toolbar.tsx.
  { key: 'shield',   label: 'Щит',        box: { left: 86,  top: 12,  width: 52,  height: 20 } },
  // ИИ — правый кластер тулбара; панель он открывает у правого края окна.
  { key: 'ai',       label: 'ИИ',         box: { right: 10, top: 12,  width: 42,  height: 20 } },
  // Приложения и виджеты — плитки на самом столе, в середине области контента.
  { key: 'apps',     label: 'Приложения', box: { left: 126, top: 58,  width: 150, height: 80 } },
  // Настройки — подвал сайдбара, рядом с «Новой вкладкой» и «Историей».
  { key: 'settings', label: 'Настройки',  box: { left: 14,  bottom: 13, width: 88, height: 18 } },
];

function WindowMap() {
  return (
    <div style={{
      position: 'relative', width: '100%', height: 214,
      borderRadius: RADIUS.content, border: '1px solid var(--divider)',
      background: 'var(--surface-sunken)', overflow: 'hidden',
    }}>
      {/* Полоса тулбара: слева кнопка сайдбара, затем навигация, омнибокс и правый кластер. */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 0, height: 44,
        display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
      }}>
        <span style={{ ...mapChip, width: 18 }} />
        <span style={{ ...mapChip, width: 46 }} />
        <span style={{ ...mapChip, flex: 1, background: 'var(--surface-solid)' }} />
        <span style={{ ...mapChip, width: 42 }} />
      </div>
      {/* Сайдбар: переключатель, сетка закреплённых, список вкладок и подвал. */}
      <div style={{
        position: 'absolute', left: 10, top: 50, bottom: 10, width: 96,
        borderRadius: RADIUS.control, background: 'var(--surface)',
        display: 'flex', flexDirection: 'column', gap: 4, padding: 7,
      }}>
        <span style={{ ...mapChip, height: 12 }} />
        <span style={{ ...mapChip, height: 20 }} />
        {[0, 1, 2, 3].map((i) => (
          <span key={i} style={{
            ...mapChip, height: 10,
            background: i === 0 ? 'color-mix(in srgb, var(--accent) 28%, transparent)' : undefined,
          }} />
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ ...mapChip, height: 12 }} />
      </div>
      {/* Область контента: рабочий стол с плитками. */}
      <div style={{
        position: 'absolute', left: 116, right: 10, top: 50, bottom: 10,
        borderRadius: RADIUS.control, background: 'var(--surface)',
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, padding: 10,
        alignContent: 'start',
      }}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <span key={i} style={{
            height: i < 4 ? 34 : 24, borderRadius: RADIUS.control,
            background: 'var(--surface-sunken)',
          }} />
        ))}
      </div>

      {/* Подсветки. ⚠️ Грубые намеренно: схема говорит «примерно здесь», и обещать пиксель в
          пиксель она не имеет права — окно у каждого своей ширины. */}
      {MAP_SPOTS.map((s) => (
        <span key={s.key} style={{
          position: 'absolute', ...s.box,
          border: '2px solid var(--poster-tangerine)', borderRadius: RADIUS.control,
          background: 'color-mix(in srgb, var(--poster-tangerine) 12%, transparent)',
          pointerEvents: 'none',
        }}>
          <span style={{
            position: 'absolute', top: -9, left: 5, ...CAPS,
            background: 'var(--poster-tangerine)', color: 'var(--on-poster-dark)',
            padding: '1px 6px', borderRadius: RADIUS.tight, whiteSpace: 'nowrap',
          }}>{s.label}</span>
        </span>
      ))}
    </div>
  );
}

const mapChip: React.CSSProperties = {
  height: 20, borderRadius: RADIUS.tight, background: 'var(--surface-sunken)', flex: 'none',
};

// ⚠️ ЧЕТЫРЕХ СЛАЙДОВ РАССКАЗА БОЛЬШЕ НЕТ. Они шли ПЕРЕД переносом закладок — то есть перед тем,
// ради чего браузер и ставят, — и до дела долистывали не все. Содержание не выброшено, а
// перенесено туда, где оно к месту: про защиту и вкладки сказано на схеме окна последним шагом,
// про локальный ИИ — на шаге модели. Рассказывать отдельно то, что человек через минуту увидит
// сам, и значит сделать экраны, которые пролистывают.

/** Плакатный тон шага. ⚠️ Закреплён за шагом — тот же приём, что SECTION_TONE в настройках. */
type StepTone = 'sky' | 'tea' | 'mustard' | 'lime' | 'tangerine';

// Пара «цвет + краска» обязательна: на небе, горчице, лайме и мандарине контраст чернил выше 7:1,
// а белого ниже 3:1; на чае наоборот (см. colors.css).
const TONE_INK: Record<StepTone, string> = {
  sky: 'var(--on-poster-dark)',
  mustard: 'var(--on-poster-dark)',
  lime: 'var(--on-poster-dark)',
  tangerine: 'var(--on-poster-dark)',
  tea: 'var(--on-poster-light)',
};

const TYPE_LABELS: Record<ImportDataType, string> = {
  bookmarks: 'Закладки',
  history: 'История',
  passwords: 'Пароли',
};

function resultLine(type: ImportDataType, res: ImportTypeResult | null): string {
  const label = TYPE_LABELS[type];
  if (res === null) return `${label}: не удалось прочитать`;
  const parts = [`перенесено ${res.inserted}`];
  if (res.skipped > 0) parts.push(`уже были ${res.skipped}`);
  if (res.unsupported && res.unsupported > 0) parts.push(`не поддержано ${res.unsupported}`);
  return `${label}: ${parts.join(', ')}`;
}

// Шаги мастера. ⚠️ Список СОБИРАЕТСЯ, а не пронумерован константами: два последних шага
// условные — модель не предлагаем, если она уже стоит или не поедет на этом железе, а индексацию
// не предлагаем, если человек не переносил историю. Оба добавляются ПОСЛЕ текущей позиции
// (появиться они могут только на шаге переноса или раньше), поэтому пересборка списка никогда не
// сдвигает шаг под ногами.
type StepKind = 'import' | 'model' | 'index' | 'look' | 'guide';

/**
 * Что показать в конце разговора — четыре места, ради которых стоит заглянуть в интерфейс.
 *
 * ⚠️ Ровно четыре и ни одним больше. Это не справка, а «куда смотреть в первую минуту»: список из
 * десяти пунктов на первом запуске не читают вовсе, а прочитанные четыре человек действительно
 * находит потом глазами. Всё остальное живёт в настройках и находится по ходу.
 */
const GUIDE: { icon: React.ReactNode; title: string; text: string }[] = [
  {
    icon: <Shield size={20} />,
    title: 'Щит в адресной строке',
    text: 'VPN и блокировщик живут под ним — там же счётчик заблокированного и переключатель для текущего сайта.',
  },
  {
    icon: <LayoutGrid size={20} />,
    title: 'Приложения на новой вкладке',
    text: 'Встроенные приложения, виджеты и любые сайты — плитками на рабочем столе. Добавляются кнопкой там же.',
  },
  {
    icon: <Palette size={20} />,
    title: 'Цвет браузера',
    text: 'Настройки → «Интерфейс»: шесть палитр, светлая и тёмная тема, обои новой вкладки.',
  },
  {
    icon: <Sparkles size={20} />,
    title: 'ИИ в боковой панели',
    text: 'Спросить о странице, перевести её целиком или разобрать выделенный текст — всё оттуда.',
  },
];

export default function Onboarding({ onFinish }: Props) {
  const [step, setStep] = useState(0);
  const [sources, setSources] = useState<ImportSource[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<ImportDataType>>(new Set());
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ImportRunResult | null>(null);
  // CSV-путь для паролей прямо в мастере: пароли современного Chrome с диска не переносятся
  // (App-Bound v20), поэтому после отчёта с нулём паролей предлагаем выбрать CSV, не выходя отсюда.
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvMsg, setCsvMsg] = useState('');

  // Модель: каталог и уже установленное. Оба грузим заранее, на слайдах, — как и источники
  // импорта: к своему шагу список обязан быть готов, а не появляться с задержкой.
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [installed, setInstalled] = useState<InstalledModel[] | null>(null);
  const [dl, setDl] = useState<DownloadProgress | null>(null);
  const [backfill, setBackfill] = useState<BackfillProgress | null>(null);
  const [indexAsked, setIndexAsked] = useState(false);

  // Что предлагаем скачать. ⚠️ Роль назначает КАТАЛОГ (см. shared/ipc.ts::ModelRole), а не этот
  // экран: там же живут замеры и резервы видеопамяти. Наше дело — показать 'recommended', то есть
  // самую лёгкую модель с измеренным качеством, и ничего не придумывать сверх.
  const modelOffer = useMemo(
    () => catalog?.find((e) => e.role === 'recommended') ?? catalog?.find((e) => e.role !== null) ?? null,
    [catalog],
  );
  // Шаг модели не показываем вовсе, если модель уже стоит: человек её не просил, и повторное
  // предложение выглядело бы навязчивым. Каталог ещё не приехал — шага тоже нет, дорисовывать его
  // задним числом посреди мастера незачем.
  // ⚠️ СЧИТАЕМ ТОЛЬКО СКАЧАННЫЕ ('downloaded'). Реестр моделей отдаёт ещё и бандловую из
  // resources/models/gguf с пометкой 'legacy' — она лежит на диске у КАЖДОГО, и по наивной проверке
  // «список непуст» этот шаг не показался бы никогда, то есть ровно на чистой машине, ради которой
  // он и сделан. Бандл — аварийный фолбэк на EuroLLM-1.7B, а не «у человека есть модель».
  const modelStepShown = installed !== null && catalog !== null
    && installed.every((m) => m.source !== 'downloaded');
  // Индексация — ТОЛЬКО если историю действительно перенесли и она непустая: без импорта
  // индексировать нечего, а предлагать работу над пустотой значит просить о бессмысленном.
  const historyImported = (report?.history?.inserted ?? 0) > 0;

  const steps = useMemo<StepKind[]>(() => {
    // ⚠️ ПЕРВЫМ идёт ПЕРЕНОС. Раньше перед ним стояли четыре слайда рассказа, и до дела, ради
    // которого браузер ставят, долистывали не все.
    const out: StepKind[] = ['import'];
    if (modelStepShown) out.push('model');
    if (historyImported) out.push('index');
    // Облик — безусловный: тему и палитру человек всё равно выбирает в первые минуты, а узнать
    // о них было неоткуда.
    out.push('look');
    // ⚠️ Гайд — БЕЗУСЛОВНЫЙ и последний. Соблазн привязать его к загрузке модели («расскажем, пока
    // качается») есть, но привязка означала бы, что человек, отказавшийся от модели, гайда не
    // увидит вовсе — а отказ от модели не должен ничего отнимать. Меняется только рамка разговора:
    // идёт загрузка — «пока качается», не идёт — просто «напоследок».
    out.push('guide');
    return out;
  }, [modelStepShown, historyImported]);

  const kind = steps[step] ?? 'import';
  const importStep = kind === 'import';
  const isLastStep = step >= steps.length - 1;
  // Загрузка ЗАВЕРШИЛАСЬ успешно. Отдельным именем, а не тройным условием в трёх местах: от него
  // зависят и текст в теле шага, и обе кнопки, и разъехаться им нельзя.
  const modelDone = !!dl && !dl.running && !dl.cancelled && !dl.error && dl.receivedBytes > 0;

  // Источники ищем заранее, ещё на слайдах: разбор профилей на диске занимает время, и к
  // последнему шагу список должен быть уже готов, а не появляться с задержкой.
  useEffect(() => {
    let alive = true;
    void window.oblako.listImportSources().then((list) => {
      if (!alive) return;
      setSources(list);
      if (list.length > 0) selectSource(list[0]);
    });
    return () => { alive = false; };
  }, []);

  // Каталог и установленные модели — тем же приёмом «готовим заранее», что и источники импорта.
  useEffect(() => {
    let alive = true;
    void window.oblako.getModelCatalog()
      .then((c) => { if (alive) setCatalog(c); })
      .catch(() => { if (alive) setCatalog([]); }); // не смогли посчитать железо — просто не предлагаем
    void window.oblako.getInstalledModels()
      .then((m) => { if (alive) setInstalled(m); })
      .catch(() => { if (alive) setInstalled([]); });
    return () => { alive = false; };
  }, []);

  // ⚠️ Обе долгие работы идут в MAIN и переживают закрытие этого экрана — в том и смысл. Здесь
  // только подписка на их прогресс, никакой отмены при размонтировании: человек нажал «скачать» и
  // ушёл пользоваться браузером, загрузка обязана продолжиться.
  useEffect(() => window.oblako.onModelDownloadProgress(setDl), []);
  useEffect(() => window.oblako.onHistoryContentBackfillProgress(setBackfill), []);

  const selected = useMemo(() => sources?.find((s) => s.id === selectedId) ?? null, [sources, selectedId]);

  // Стрелки — привычный способ листать презентацию. ⚠️ Назад с последнего шага разрешаем только
  // до отчёта: после переноса «вернуться» значило бы предложить сделать его ещё раз.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Вперёд стрелкой — только там, где шаг ничего не требует: на шаге переноса и модели
      // «дальше» это решение, и принимать его случайным нажатием стрелки нельзя.
      if (e.key === 'ArrowRight' && (kind === 'look' || kind === 'guide') && !isLastStep) setStep((s) => s + 1);
      if (e.key === 'ArrowLeft' && step > 0 && !report && !running) setStep((s) => s - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, report, running]);

  function selectSource(source: ImportSource) {
    setSelectedId(source.id);
    setChecked(new Set(source.dataTypes));
    setReport(null);
  }

  function toggleType(type: ImportDataType) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  async function handleRun() {
    if (!selected || checked.size === 0 || running) return;
    setRunning(true);
    setReport(null);
    try {
      const types = selected.dataTypes.filter((t) => checked.has(t));
      setReport(await window.oblako.runImport(selected.id, types));
      setCsvMsg('');
    } finally {
      setRunning(false);
    }
  }

  // Импорт паролей из CSV-экспорта браузера — тот же путь, что в разделе Пароли. Без парольной фразы.
  async function handleCsvImport() {
    if (csvBusy) return;
    setCsvBusy(true); setCsvMsg('');
    const res = await window.oblako.importPasswordsCsv();
    setCsvBusy(false);
    switch (res.status) {
      case 'canceled':          break;
      case 'ok':                setCsvMsg(res.inserted > 0
        ? `Перенесено паролей: ${res.inserted}. Удалите CSV-файл — пароли в нём открытым текстом.`
        : `Ничего не добавлено — все ${res.skipped} записей уже были.`); break;
      case 'empty':             setCsvMsg('В файле не нашлось паролей — это точно CSV-экспорт паролей?'); break;
      case 'read-error':        setCsvMsg('Не удалось прочитать файл.'); break;
      case 'vault-unavailable': setCsvMsg('Хранилище паролей недоступно.'); break;
    }
  }

  function handleDownload() {
    if (!modelOffer) return;
    const m = modelOffer.model;
    // fire-and-forget: startModelDownload — send, не invoke, ошибки приходят через progress.error
    // (тот же вызов, что в ModelsSection.tsx — второй способ скачать модель заводить незачем).
    window.oblako.startModelDownload({
      url: m.url, fileName: m.fileName, label: m.label, expectedSha256: m.expectedSha256,
    });
  }

  function handleIndex() {
    setIndexAsked(true);
    window.oblako.startHistoryContentBackfill();
  }

  // Шапка шага: тон, заголовок, подпись. ⚠️ Ровно одна точка на все виды шагов — раньше здесь
  // стоял тернарник «слайд или импорт», и любой третий вид шага уронил бы экран на слайде,
  // которого у него нет.
  //
  // ⚠️ `art` больше НЕ картинка сверху, а содержимое ПРАВОЙ половины: то, что на шаге делают.
  // Левая половина осталась плакатной и несёт только тон, заголовок и одну фразу.
  const head: { art: React.ReactNode; title: string; text: string } =
    kind === 'import' ? {
      art: <ArtImport />,
      title: 'Перенесём ваши данные?',
      text: 'Закладки, история и пароли переедут из привычного браузера. В нём ничего не изменится — данные только копируются.',
    } : kind === 'model' ? {
      art: <ArtModel />,
      title: modelOffer ? 'Скачать локальную модель?' : 'Про локальную модель',
      text: modelOffer
        ? 'Перевод, пересказ и поиск по смыслу работают прямо на вашем компьютере — для этого нужен один файл модели. Качается в фоне, пользоваться браузером можно сразу.'
        // ⚠️ «Не тянет» — честный ответ, а не повод предложить что-нибудь полегче: человек скачает
        // гигабайты и будет судить о браузере по результату, которого железо не вытянет.
        : 'На этом устройстве локальная модель не пойдёт — видеопамяти не хватит даже самой лёгкой. Всё остальное работает как обычно, без неё.',
    } : kind === 'guide' ? {
      art: <ArtGuide />,
      title: dl?.running ? 'Пока скачивается модель' : 'Напоследок — четыре места',
      text: dl?.running
        ? 'Загрузка идёт в фоне и переживёт этот экран — браузером можно пользоваться прямо сейчас. А пока покажем, где что лежит.'
        : 'Ничего настраивать не нужно, но эти четыре вещи стоит знать заранее — потом найдёте их глазами.',
    } : kind === 'index' ? {
      art: <ArtIndex />,
      title: 'Подготовить историю к поиску?',
      text: 'Из другого браузера переехали адреса и заголовки. Чтобы искать по смыслу — «та статья про ипотеку», — страницы нужно один раз прочитать.',
    } : {
      art: <LookStep />,
      title: 'Как ему выглядеть?',
      text: 'Тему и палитру можно поменять когда угодно — раздел «Интерфейс» в настройках.',
    };

  // Тон и номер шага. ⚠️ Тон закреплён за ВИДОМ шага, а не за его номером: список собирается, и
  // при отсутствии модели «третий шаг» — это уже другой шаг, а цвет обязан остаться его.
  const TONE: Record<StepKind, StepTone> = {
    import: 'sky', model: 'tea', index: 'tangerine', look: 'mustard', guide: 'lime',
  };
  const tone = TONE[kind];
  const ink = TONE_INK[tone];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: 'var(--scrim, rgba(0,0,0,0.4))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      // Экран нельзя закрыть кликом мимо: это не диалог, а первый разговор — выход из него
      // есть, но осознанный («Пропустить»/«Начать»).
    }}>
      {/* ⚠️ ДВЕ ПОЛОВИНЫ, а не картинка над текстом. Слева плакатная плоскость со своим тоном на
          каждый шаг, справа — то, что на шаге ДЕЛАЮТ. До этого все восемь шагов выглядели
          одинаково: белая карточка, иллюстрация 260 px, заголовок и абзац по центру, — и
          отличить «рассказ» от «сделай выбор» можно было только прочитав.
          ⚠️ Кнопки, списки и галочки на цвете НЕ лежат: выбор — это работа, а не плакат. Цветная
          половина отвечает за «где я и о чём речь», правая — за «что нажать».
          ⚠️ Полноэкранным экран не делается: он висит поверх уже восстановленной сессии, и
          содержимое под ним прячется отдельным флагом (setChromeModal в ProfilePicker/App) — это
          разобранный живой баг, а не запас осторожности. */}
      <div style={{
        position: 'relative',
        width: 880, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 80px)',
        display: 'flex', overflow: 'hidden',
        ...islandPlate,
        borderRadius: 'var(--radius-island)',
        boxShadow: 'var(--shadow-island)',
        ...untintedPlateVars,
        background: 'var(--surface-solid)',
      }}>
        {/* «Пропустить» — в углу, а не в ряду кнопок: это выход из разговора, а не шаг в нём.
            Внизу тогда остаются только «Назад» и «Дальше», и ряд читается как одно движение. */}
        <button
          onClick={onFinish}
          style={{
            position: 'absolute', top: 14, right: 18, zIndex: 1,
            border: 'none', background: 'transparent', cursor: 'default',
            color: 'var(--text-faint)', fontSize: 'var(--fs-sm)', padding: '6px 10px',
            borderRadius: 'var(--radius-sm)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; }}
        >
          Пропустить
        </button>

        {/* ── Левая половина: тон, номер шага, заголовок, одна фраза ── */}
        <div key={`side-${step}`} style={{
          width: '40%', flex: 'none', position: 'relative', overflow: 'hidden',
          background: `var(--poster-${tone})`, color: ink,
          padding: `${sp(6)}px ${sp(6)}px ${sp(6)}px`,
          display: 'flex', flexDirection: 'column',
          animation: 'oblako-onb-rise var(--dur-slow) var(--ease-out)',
        }}>
          {/* Зерно — та же текстура, что на шапках настроек и библиотеки: она и отличает
              «напечатано» от «залито в макете». */}
          <div style={grain} />
          <span style={{ ...CAPS, color: 'inherit', opacity: 0.66, position: 'relative' }}>
            Шаг {step + 1} из {steps.length}
          </span>
          {/* ⚠️ Дисплейная гарнитура — онбординг один из трёх экранов, где она разрешена (см.
              CLAUDE.md): это «лицо» продукта, а не интерфейс. lineHeight поднят против её
              фирменного 1: на двух строках заголовка плотный интерлиньяж слипается. */}
          <div style={{
            ...DISPLAY, fontSize: 34, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.05,
            marginTop: sp(3), color: 'inherit', position: 'relative',
          }}>
            {head.title}
          </div>
          <div style={{
            marginTop: sp(3), ...TEXT.body, lineHeight: 1.55, opacity: 0.82,
            color: 'inherit', position: 'relative', maxWidth: '34ch',
          }}>
            {head.text}
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', gap: 6, position: 'relative' }}>
            {steps.map((_, i) => (
              <span key={i} style={{
                width: i === step ? 22 : 7, height: 7, borderRadius: RADIUS.pill,
                background: 'currentColor', opacity: i === step ? 0.9 : 0.3,
                transition: 'width var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-standard)',
              }} />
            ))}
          </div>
        </div>

        {/* ── Правая половина: дело шага ── */}
        <div style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
          padding: `${sp(6)}px ${sp(6)}px ${sp(6)}px`,
        }}>
        <div key={step} style={{ flex: 'none', animation: 'oblako-onb-rise var(--dur-slow) var(--ease-out)' }}>
          {head.art}
        </div>

        {/* Тело шага переноса. На слайдах пусто — рассказ не должен прокручиваться.
            ⚠️ flex+minHeight:0 обязательны: карточка с overflow:hidden и фиксированной maxHeight
            обрезала бы длинный отчёт (у Chrome-аккаунта это отчёт + блок CSV), а голый overflowY:auto
            без ограниченной высоты не прокручивается — тело просто вылезало за обрез, и кнопка
            «Выбрать CSV-файл» уходила под край. Теперь тело занимает место между шапкой и подвалом
            и прокручивается внутри себя. */}
        {importStep && (
          <div style={{ flex: 1, minHeight: 0, padding: '18px 28px 6px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {sources === null ? (
              <Muted>Ищем браузеры на компьютере…</Muted>
            ) : sources.length === 0 ? (
              <Muted>Других браузеров с данными не нашлось — переносить нечего.</Muted>
            ) : (
              <>
                {/* Карточки тянутся по ширине ряда, а не стоят фиксированными марками по центру:
                    при двух найденных браузерах узкая пара в широком окне оставляла по бокам
                    пустоту и весь шаг выглядел незаполненным. */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {sources.map((source) => {
                    const active = source.id === selectedId;
                    return (
                      <button
                        key={source.id}
                        onClick={() => selectSource(source)}
                        style={{
                          flex: '1 1 150px', maxWidth: 260, minWidth: 140,
                          padding: '16px 12px', borderRadius: 'var(--radius-card)',
                          border: 'none', cursor: 'default',
                          background: active ? 'var(--surface)' : 'transparent',
                          boxShadow: active ? '0 0 0 2px var(--accent) inset' : '0 0 0 1px var(--divider) inset',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                          transition: 'box-shadow var(--dur-fast) var(--ease-standard)',
                        }}
                      >
                        <BrowserLogo vendorId={source.id.split('::')[0]} label={source.label} />
                        <span style={{
                          fontSize: 'var(--fs-xs)', color: 'var(--text-body)',
                          maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{source.label}</span>
                      </button>
                    );
                  })}
                </div>

                {selected && !report && (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {selected.dataTypes.map((type) => {
                      const on = checked.has(type);
                      return (
                        <button
                          key={type}
                          onClick={() => toggleType(type)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 7,
                            padding: '7px 13px', borderRadius: 'var(--radius-pill)', border: 'none',
                            cursor: 'default', fontSize: 'var(--fs-sm)',
                            background: on ? 'var(--accent-soft)' : 'var(--surface-sunken)',
                            color: on ? 'var(--text-strong)' : 'var(--text-muted)',
                          }}
                        >
                          <span style={{
                            width: 16, height: 16, borderRadius: RADIUS.tight, flex: 'none',
                            background: on ? 'var(--accent)' : 'transparent',
                            border: on ? 'none' : '1.5px solid var(--divider-strong)',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          }}>{on && <Check size={12} style={{ color: 'var(--on-accent)' }} />}</span>
                          {TYPE_LABELS[type]}
                        </button>
                      );
                    })}
                  </div>
                )}

                {report && (
                  <div style={{
                    ...islandPlate, borderRadius: 'var(--radius-sm)', padding: '12px 14px',
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}>
                    {(Object.keys(report) as ImportDataType[]).map((type) => (
                      <div key={type} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>
                        ✅ {resultLine(type, report[type] ?? null)}
                      </div>
                    ))}
                  </div>
                )}

                {/* Пароли просили, но перенеслось ноль — почти всегда это v20 (App-Bound) свежего
                    Chrome, диском их не взять. Не бросаем человека с необъяснённым нулём, а прямо
                    здесь даём рабочий путь через CSV — иначе он уйдёт из мастера без паролей и не
                    поймёт почему. */}
                {report && 'passwords' in report && (report.passwords?.inserted ?? 0) === 0 && (
                  <div style={{
                    ...islandPlate, borderRadius: 'var(--radius-sm)', padding: '12px 14px',
                    display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', lineHeight: 1.5 }}>
                      Пароли современного Chrome зашифрованы и напрямую не переносятся. Экспортируйте
                      их в браузере (<b>Настройки → Пароли → ⋮ → Экспорт паролей</b>) и выберите
                      CSV-файл здесь.
                    </span>
                    <button
                      onClick={() => void handleCsvImport()}
                      disabled={csvBusy}
                      style={{ ...bigGhost, alignSelf: 'flex-start', padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 7, opacity: csvBusy ? 0.5 : 1 }}
                    >
                      {csvBusy
                        ? <Loader2 size={15} style={{ animation: 'oblako-spin 1s linear infinite' }} />
                        : <FileUp size={15} />}
                      Выбрать CSV-файл
                    </button>
                    {csvMsg && (
                      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>{csvMsg}</span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Тело шага модели. */}
        {kind === 'model' && modelOffer && (
          <div style={{ padding: '18px 28px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              ...islandPlate, borderRadius: 'var(--radius-card)', padding: '14px 16px',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text-strong)' }}>
                  {modelOffer.model.label}
                </span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
                  {gb(modelOffer.model.sizeBytes)} · нужно {gb(modelOffer.minVramBytes)} видеопамяти
                </span>
              </div>
              {/* Строка «чем отличается» приходит ИЗ КАТАЛОГА: это пересказ наших замеров, и
                  расходиться описанию с числами нельзя (см. CatalogEntry.summary). */}
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {modelOffer.summary}
              </div>
            </div>

            {dl?.error ? (
              <Muted>Загрузка не удалась: {dl.error}. Можно повторить позже в «Настройки → ИИ».</Muted>
            ) : dl?.running ? (
              <Progress
                done={dl.receivedBytes} total={dl.totalBytes}
                label={dl.totalBytes ? `Качаем — ${gb(dl.receivedBytes)} из ${gb(dl.totalBytes)}` : 'Качаем…'}
                hint="Можно идти дальше: загрузка продолжится в фоне."
              />
            ) : modelDone ? (
              <Muted>✅ Модель скачана — локальный ИИ готов.</Muted>
            ) : null}
          </div>
        )}

        {/* Тело шага индексации. */}
        {kind === 'index' && (
          <div style={{ padding: '18px 28px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {backfill?.running ? (
              <Progress
                done={backfill.processed} total={backfill.total}
                label={`Читаем страницы — ${backfill.processed} из ${backfill.total}`}
                hint="Можно идти дальше: это продолжится в фоне."
              />
            ) : indexAsked ? (
              <Muted>✅ Запустили — дальше браузер сделает это сам.</Muted>
            ) : (
              // ⚠️ Говорим ПРЯМО, что для этого страницы будут открыты заново. Это сеть и это следы
              // в чужих логах — умолчать о таком в приватном браузере нельзя, а решение всё равно
              // остаётся за человеком.
              <Muted>
                Браузер по одной откроет перенесённые адреса, чтобы прочитать текст. Это займёт время
                и потребует сети; всё остальное в это время работает как обычно.
              </Muted>
            )}
          </div>
        )}

        {kind === 'guide' && (
          <div style={{ flex: 1, minHeight: 0, padding: `${sp(3)}px ${sp(4)}px 0`, overflowY: 'auto' }}>
            {/* ⚠️ Сетка 2×2, а не колонка на четыре строки: колонка не помещалась в экран вместе с
                шапкой и подвалом и заставляла прокручивать первый же разговор с браузером. */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: sp(2) }}>
              {GUIDE.map((g, i) => (
                <div key={g.title} style={{
                  display: 'flex', gap: sp(2), padding: sp(2),
                  borderRadius: RADIUS.box, background: 'var(--surface-sunken)',
                  animation: `oblako-onb-rise var(--dur-slow) var(--ease-out) ${80 + i * 70}ms backwards`,
                }}>
                  <span style={{
                    width: 34, height: 34, flex: 'none', borderRadius: RADIUS.control,
                    display: 'grid', placeItems: 'center',
                    background: 'var(--accent-soft)', color: 'var(--accent)',
                  }}>{g.icon}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ ...TEXT.section, display: 'block' }}>{g.title}</span>
                    <span style={{ ...TEXT.caption, display: 'block', marginTop: 2 }}>{g.text}</span>
                  </span>
                </div>
              ))}
            </div>

            {/* Ход загрузки — здесь же, а не на шаге модели: человек уже ушёл с него, а знать,
                что процесс идёт и переживёт закрытие экрана, ему по-прежнему нужно. */}
            {dl?.running && (
              <div style={{ marginTop: sp(3) }}>
                <Progress
                  done={dl.receivedBytes} total={dl.totalBytes}
                  label={`Модель качается — ${gb(dl.receivedBytes)}${dl.totalBytes ? ` из ${gb(dl.totalBytes)}` : ''}`}
                  hint="Можно закрывать этот экран: загрузка продолжится в фоне."
                />
              </div>
            )}
          </div>
        )}

        {/* Подвал. ⚠️ Всё по ЦЕНТРУ, в колонку: точки слева и кнопка справа тянули взгляд к
            краям, хотя весь экран выстроен по центральной оси, — от этого он и читался
            перекошенным. Здесь одна ось, и она совпадает с осью текста. */}
        <div style={{
          marginTop: 'auto', padding: '26px 32px 30px', flex: 'none',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
        }}>
          <div style={{ display: 'flex', gap: 7 }}>
            {steps.map((_, i) => (
              <span key={i} style={{
                width: i === step ? 20 : 7, height: 7, borderRadius: 'var(--radius-pill)',
                background: i === step ? 'var(--accent)' : 'var(--divider-strong)',
                transition: 'width var(--dur-base) var(--ease-out), background var(--dur-base) var(--ease-standard)',
              }} />
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Назад. ⚠️ Прячем только там, где возвращаться некуда (первый шаг) или уже
                бессмысленно (перенос сделан): предлагать «назад» после отчёта значило бы
                звать повторить импорт. */}
            {step > 0 && !report && !running && (
              <button
                style={{ ...bigGhost, display: 'inline-flex', alignItems: 'center', gap: 7 }}
                onClick={() => setStep((s) => s - 1)}
              >
                <ArrowLeft size={16} /> Назад
              </button>
            )}
            {/* Тихий отказ от предложения этого шага. ⚠️ Ведёт ДАЛЬШЕ по мастеру, а не наружу:
                отказаться от переноса — не то же самое, что закончить разговор, а следом может
                идти предложение модели, которого человек ещё не видел. */}
            {((importStep && !report && sources && sources.length > 0)
              || (kind === 'model' && modelOffer && !dl?.running && !modelDone)
              || (kind === 'index' && !backfill?.running && !indexAsked)) && (
              <button style={bigGhost} onClick={() => (isLastStep ? onFinish() : setStep((s) => s + 1))}>
                Не сейчас
              </button>
            )}

            {importStep && sources && sources.length > 0 && !report ? (
              <button
                style={{ ...bigPrimary, opacity: (checked.size === 0 || running) ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}
                onClick={() => void handleRun()}
              >
                {running && <Loader2 size={15} style={{ animation: 'oblako-spin 1s linear infinite' }} />}
                {running ? 'Переносим…' : 'Перенести'}
              </button>
            ) : kind === 'model' && modelOffer && !dl?.running && !modelDone ? (
              <button style={bigPrimary} onClick={() => handleDownload()}>Скачать модель</button>
            ) : kind === 'index' && !backfill?.running && !indexAsked ? (
              <button style={bigPrimary} onClick={() => handleIndex()}>Проиндексировать</button>
            ) : isLastStep ? (
              <button style={bigPrimary} onClick={onFinish}>Начать пользоваться</button>
            ) : (
              <button
                style={{ ...bigPrimary, display: 'inline-flex', alignItems: 'center', gap: 8 }}
                onClick={() => setStep((s) => s + 1)}
              >
                Дальше <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

// Главная кнопка экрана крупнее обычной из kit.tsx: здесь она единственное действие на весь
// экран, и мелкая пилюля рядом с 26-пиксельным заголовком выглядела бы приставленной.
const bigPrimary: React.CSSProperties = {
  ...btnPrimary,
  padding: '11px 22px',
  fontSize: 'var(--fs-md)',
};

// Пара к ней: тихие кнопки того же роста, иначе ряд «Назад | Дальше» выглядит ступенькой.
const bigGhost: React.CSSProperties = {
  ...btnGhost,
  padding: '11px 18px',
  fontSize: 'var(--fs-md)',
};

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', textAlign: 'center' }}>{children}</div>;
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} ГБ`;
}

// Полоса хода работы — общая для загрузки модели и чтения истории: обе долгие, обе продолжаются
// в фоне, и подпись про фон здесь не украшение, а единственное место, где человек узнаёт, что
// уходить со страницы можно.
function Progress({ done, total, label, hint }: { done: number; total: number | null; label: string; hint: string }) {
  const pct = total && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--surface-sunken)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 'var(--radius-pill)', background: 'var(--accent)',
          // Неизвестная длина — не повод врать полосой: показываем узкую «живую» вместо доли.
          width: pct === null ? '25%' : `${pct}%`,
          transition: 'width var(--dur-base) var(--ease-out)',
        }} />
      </div>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', textAlign: 'center' }}>{label}</div>
      <Muted>{hint}</Muted>
    </div>
  );
}

// Иллюстрация шага модели: файл приезжает на сам компьютер, а не в облако.
function ArtModel() {
  return (
    <ArtStack>
      <div style={{
        width: 120, height: 88, borderRadius: 'var(--radius-card)',
        background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}><BrainCircuit size={38} style={{ color: 'var(--accent)' }} /></div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Pill text="перевод" delay={120} />
        <Pill text="пересказ" delay={200} />
        <Pill text="поиск по смыслу" dot="var(--dot-local)" delay={280} />
      </div>
    </ArtStack>
  );
}

// Иллюстрация шага индексации: список адресов превращается в то, по чему можно искать словами.
function ArtIndex() {
  return (
    <ArtStack>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{
          width: 88, height: 88, borderRadius: 'var(--radius-card)', background: 'var(--surface-sunken)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Link2 size={34} style={{ color: 'var(--text-muted)' }} /></div>
        <ArrowRight size={30} style={{ color: 'var(--accent)', animation: 'oblako-onb-nudge 1.6s var(--ease-standard) infinite' }} />
        <div style={{
          width: 88, height: 88, borderRadius: 'var(--radius-card)',
          background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Search size={34} style={{ color: 'var(--accent)' }} /></div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Pill text="«та статья про ипотеку»" delay={160} />
      </div>
    </ArtStack>
  );
}

/**
 * Схема окна для гайда.
 *
 * ⚠️ Схема обязана СОВПАДАТЬ С РЕАЛЬНЫМ ОКНОМ, иначе она вредна: человек ищет глазами то, что
 * увидел здесь, и не находит. Первая версия была абстрактным набором прямоугольников (полоса
 * вкладок слева во всю высоту, плитки по центру, значки где придётся) — «нагромождение», которое
 * ни на что не показывало. Здесь повторена настоящая раскладка Oblako:
 *   • верхняя полоса ВО ВСЮ ШИРИНУ: кнопка сайдбара, стрелки навигации, широкая пилюля адреса со
 *     ЩИТОМ внутри слева, справа кластер значков (последний — ИИ);
 *   • ниже слева сайдбар: пара «Вкладки | Закладки» сверху, список, кнопка «Новая вкладка» внизу;
 *   • справа сцена с плитками рабочего стола;
 *   • у правого края — полоса ИИ-панели.
 * Подсвечены ровно те три места, на которые показывают карточки под схемой; четвёртая карточка
 * (цвет) ведёт в настройки, и подсвечивать в окне ей нечего — врать точкой на схеме не будем.
 */
// Последний шаг: САМО ОКНО с подсветками, а не четыре строки со значками.
//
// ⚠️ Человек ищет эти места потом ГЛАЗАМИ, а не по памяти о списке. Список из четырёх абзацев
// он прочитает и забудет; схему — узнает, когда через минуту увидит настоящее окно.
function ArtGuide() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3) }}>
      <WindowMap />
      <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
        {GUIDE.map((g) => (
          <div key={g.title} style={{ display: 'flex', gap: sp(2), alignItems: 'baseline' }}>
            <span style={{ ...TEXT.body, fontWeight: 650, color: 'var(--text-strong)', flex: 'none' }}>
              {g.title}
            </span>
            <span style={{ ...TEXT.caption, color: 'var(--text-muted)', minWidth: 0 }}>{g.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Иллюстрация шага переноса: данные перетекают из чужого браузера в наш.
// ── Шаг «Облик»: тема и палитра ───────────────────────────────────────────────
//
// ⚠️ ЕДИНСТВЕННЫЙ ДОБАВЛЕННЫЙ ШАГ, и он заменяет собой четыре слайда рассказа. Причина не в
// красоте: тему и палитру человек всё равно выбирает в первые минуты, а узнать о них было
// неоткуда — он находил их в настройках сам, если находил.
//
// ⚠️ Выбор ПРИМЕНЯЕТСЯ СРАЗУ, а не запоминается «на потом»: тема живёт в main и красит всё окно,
// поэтому результат виден в ту же секунду прямо за карточкой. Отложенное применение здесь
// означало бы выбор вслепую.
//
// ⚠️ Образцы рисуются ТОЙ ЖЕ лестницей, что настоящий интерфейс (земля → остров → строка текста),
// и значения продублированы из palettes.css: прочитать переменные НЕ применённой сейчас палитры
// нельзя в принципе. Ровно тот же приём и тот же разбор, что в разделе «Интерфейс».
const LOOK_PALETTES: { id: ThemePaletteId; label: string; light: [string, string, string]; dark: [string, string, string] }[] = [
  { id: 'charcoal', label: 'Уголь',  light: ['#F2F2F7', '#FFFFFF', '#3C3C43'], dark: ['#121214', '#1C1C1E', '#EBEBF5'] },
  { id: 'graphite', label: 'Графит', light: ['#ECECEC', '#FFFFFF', '#3C3C43'], dark: ['#1E1E1E', '#2C2C2C', '#EBEBF5'] },
  { id: 'slate',    label: 'Сланец', light: ['#E5E9F0', '#FFFFFF', '#3B4252'], dark: ['#2E3440', '#3B4252', '#E5E9F0'] },
  { id: 'paper',    label: 'Бумага', light: ['#F1EDE4', '#FDFBF6', '#3A332A'], dark: ['#14120F', '#1C1917', '#E9E3D9'] },
  { id: 'mint',     label: 'Мята',   light: ['#E9F2EC', '#FFFFFF', '#2C3A31'], dark: ['#101613', '#18201B', '#DDE9E1'] },
  { id: 'sky',      label: 'Небо',   light: ['#E8EEFA', '#FFFFFF', '#2C3550'], dark: ['#0F1319', '#171C24', '#DEE5F0'] },
];

const LOOK_MODES: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: 'Светлая' },
  { id: 'dark', label: 'Тёмная' },
  { id: 'system', label: 'Как в системе' },
];

function LookSwatch({ swatch }: { swatch: [string, string, string] }) {
  const [ground, surface, text] = swatch;
  return (
    <span style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      width: '100%', height: 46, borderRadius: RADIUS.box, background: ground,
      paddingBottom: 7, boxShadow: 'inset 0 0 0 1px var(--divider)', boxSizing: 'border-box',
    }}>
      <span style={{
        width: 46, height: 22, borderRadius: RADIUS.control, background: surface,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, padding: '0 6px',
        boxSizing: 'border-box',
      }}>
        <span style={{ height: 3, borderRadius: RADIUS.tight, background: text, opacity: 0.85 }} />
        <span style={{ height: 3, borderRadius: RADIUS.tight, background: text, opacity: 0.45, width: '65%' }} />
      </span>
    </span>
  );
}

function LookStep() {
  const [theme, setTheme] = useState<ThemePrefs>({ mode: 'light', palette: 'charcoal', systemDark: false });
  useEffect(() => {
    void window.oblako.getTheme().then(setTheme).catch(() => { /* останется дефолт */ });
    return window.oblako.onThemeChanged(setTheme);
  }, []);
  const apply = (mode: ThemeMode, palette: ThemePaletteId) => {
    setTheme((t) => ({ ...t, mode, palette }));   // сразу, не дожидаясь ответа: кнопка не должна залипать
    void window.oblako.setTheme(mode, palette);
  };
  const dark = isDarkTheme(theme);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(4) }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
        <span style={{ ...CAPS }}>Тема</span>
        <div style={{ display: 'flex', gap: sp(2) }}>
          {LOOK_MODES.map((m) => {
            const on = theme.mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => apply(m.id, theme.palette)}
                style={{
                  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: sp(2),
                  padding: sp(2), borderRadius: RADIUS.box, cursor: 'default', textAlign: 'left',
                  border: on ? '2px solid var(--text-strong)' : '2px solid var(--divider)',
                  background: 'transparent', boxSizing: 'border-box',
                }}
              >
                {/* «Как в системе» показана РАЗРЕЗАННОЙ пополам: смысл варианта в том, что вид
                    меняется сам, и показывать только нынешнюю половину значило бы рисовать её
                    неотличимой от «Светлой». */}
                {m.id === 'system' ? (
                  <span style={{
                    display: 'flex', width: '100%', height: 46, borderRadius: RADIUS.box,
                    overflow: 'hidden', boxShadow: 'inset 0 0 0 1px var(--divider)',
                  }}>
                    <span style={{ width: '50%', background: '#F2F2F7' }} />
                    <span style={{ width: '50%', background: '#1C1C1E' }} />
                  </span>
                ) : (
                  <LookSwatch swatch={m.id === 'dark' ? LOOK_PALETTES[0].dark : LOOK_PALETTES[0].light} />
                )}
                <span style={{ ...TEXT.body, fontWeight: on ? 650 : 450, color: 'var(--text-strong)' }}>
                  {m.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
        <span style={{ ...CAPS }}>Палитра</span>
        <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
          {LOOK_PALETTES.map((pal) => {
            const on = theme.palette === pal.id;
            return (
              <button
                key={pal.id}
                title={pal.label}
                onClick={() => apply(theme.mode, pal.id)}
                style={{
                  width: 76, padding: 0, border: 'none', background: 'none', cursor: 'default',
                  display: 'flex', flexDirection: 'column', gap: sp(1), alignItems: 'center',
                }}
              >
                <span style={{
                  width: '100%', borderRadius: RADIUS.box, display: 'block',
                  outline: on ? '2px solid var(--text-strong)' : '2px solid transparent',
                  outlineOffset: 2,
                }}>
                  <LookSwatch swatch={dark ? pal.dark : pal.light} />
                </span>
                <span style={{ ...TEXT.caption, color: on ? 'var(--text-strong)' : 'var(--text-muted)' }}>
                  {pal.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ArtImport() {
  return (
    <ArtStack>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{
          width: 88, height: 88, borderRadius: 'var(--radius-card)', background: 'var(--surface-sunken)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Globe size={36} style={{ color: 'var(--text-muted)' }} /></div>
        <ArrowRight size={30} style={{
          color: 'var(--accent)',
          animation: 'oblako-onb-nudge 1.6s var(--ease-standard) infinite',
        }} />
        <div style={{
          width: 88, height: 88, borderRadius: 'var(--radius-card)',
          background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><OblakoLogo size={62} /></div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Pill text="закладки" delay={120} />
        <Pill text="история" delay={200} />
        <Pill text="пароли" delay={280} />
      </div>
    </ArtStack>
  );
}
