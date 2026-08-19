import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import {
  Shield, Sparkles, Check, Loader2, ArrowRight, ArrowLeft, FileUp,
  Globe, BrainCircuit, Link2, Search, Palette, LayoutGrid,
} from 'lucide-react';
import type {
  ImportSource, ImportDataType, ImportRunResult, ImportTypeResult,
  CatalogEntry, InstalledModel, DownloadProgress, BackfillProgress,
} from '../../shared/ipc';
import { islandPlate, untintedPlateVars } from '../styles/island';
import { btnPrimary, btnGhost } from './settings/kit';
import BrowserLogo from './BrowserLogo';
import { useScrim } from '../scrimState';
import { RADIUS, TEXT, DISPLAY, sp } from '../styles/system';

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
interface Slide {
  title: string;
  text: string;
  art: React.ReactNode;
}

// ── Иллюстрации ───────────────────────────────────────────────────────────────
// Рисуем разметкой, а не картинками: интерфейс здесь и есть предмет разговора, а нарисованный
// теми же токенами он совпадает с тем, что человек увидит через минуту.

/**
 * Облако — «лицо» продукта на первом экране.
 *
 * ⚠️ Раньше здесь стоял СИСТЕМНЫЙ ЭМОДЗИ ☁️ кеглем 112, и это была единственная картинка в
 * браузере, нарисованная не нами: глиф Segoe UI Emoji со своей палитрой, своей перспективой и
 * плоской синей заливкой. В любой теме он читался чужим — ни к логотипу, ни к палитре отношения
 * не имел, а на первом экране это первое, что видит человек.
 *
 * Рисуем сами и ТОКЕНАМИ: форма собрана из перекрывающихся кругов с одной заливкой (так контур
 * получается мягким без ручного пути), градиент идёт от осветлённого акцента к самому акценту,
 * блик сверху-слева задаёт объём. Меняется палитра — меняется облако, само собой.
 */
function CloudMark({ size = 200 }: { size?: number }) {
  const id = `oblako-cloud-${size}`;
  return (
    <svg
      width={size} height={size * 0.62} viewBox="0 0 240 150" aria-hidden
      style={{
        display: 'block', position: 'relative',
        // Тень тонирована акцентом, а не чёрным: облако должно казаться подсвеченным изнутри, а
        // не лежащим на столе. Тот же приём, что у --shadow-tint в системе.
        filter: 'drop-shadow(0 16px 28px color-mix(in srgb, var(--accent) 38%, transparent))',
      }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--accent) 42%, white)" />
          <stop offset="55%" stopColor="color-mix(in srgb, var(--accent) 88%, white)" />
          <stop offset="100%" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
      <g fill={`url(#${id})`}>
        <circle cx="92" cy="62" r="42" />
        <circle cx="146" cy="56" r="32" />
        <circle cx="178" cy="84" r="26" />
        <circle cx="64" cy="90" r="30" />
        <rect x="58" y="80" width="124" height="34" rx="17" />
      </g>
      {/* Блик — не белая клякса, а мягкое пятно на верхней кромке: даёт объём и не спорит с тоном. */}
      <ellipse cx="86" cy="42" rx="30" ry="16" fill="rgba(255,255,255,0.30)" />
    </svg>
  );
}

function ArtWelcome() {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      {/* Мягкое свечение за облаком — единственный декоративный элемент во всём экране. */}
      <div style={{
        position: 'absolute', width: 260, height: 260, borderRadius: '50%',
        background: 'radial-gradient(circle, color-mix(in srgb, var(--accent) 26%, transparent) 0%, transparent 70%)',
      }} />
      <div style={{ position: 'relative', animation: 'oblako-onb-float 6s var(--ease-standard) infinite' }}>
        <CloudMark size={210} />
      </div>
    </div>
  );
}

function ArtProtection() {
  return (
    <ArtStack>
      <div style={{
        width: 116, height: 116, borderRadius: 'var(--radius-pill)',
        background: 'color-mix(in srgb, var(--dot-vpn) 16%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Shield size={56} style={{ color: 'var(--dot-vpn)' }} fill="var(--dot-vpn)" />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Pill text="VPN включён" dot="var(--dot-vpn)" delay={120} />
        <Pill text="реклама скрыта" dot="var(--accent)" delay={220} />
      </div>
    </ArtStack>
  );
}

function ArtAi() {
  return (
    <ArtStack>
      <div style={{
        ...islandPlate, borderRadius: 'var(--radius-card)', padding: 16, width: 420,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>Выделенный текст</span>
        </div>
        {/* Три действия — одной строкой: перенос «Объяснить» на вторую строку читался как
            обрезанная вёрстка, а не как список. */}
        <div style={{ display: 'flex', gap: 7, justifyContent: 'center' }}>
          {['Перевести', 'Пересказать', 'Объяснить'].map((t, i) => (
            <Pill key={t} text={t} delay={120 + i * 90} />
          ))}
        </div>
      </div>
      <Pill text="работает на вашем компьютере" dot="var(--dot-local)" delay={420} />
    </ArtStack>
  );
}

function ArtTabs() {
  // Схема окна: слева полоса вкладок, справа две половины разделённого экрана.
  return (
    <ArtStack>
      <div style={{
        ...islandPlate, borderRadius: 'var(--radius-card)', padding: 12, width: 360, height: 176,
        display: 'flex', gap: 10,
      }}>
        <div style={{ width: 88, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{
              height: 19, borderRadius: 'var(--radius-sm)',
              background: i === 1 ? 'var(--accent)' : 'var(--surface-sunken)',
              opacity: i === 1 ? 1 : 0.75,
              animation: `oblako-onb-rise var(--dur-slow) var(--ease-out) ${80 + i * 70}ms backwards`,
            }} />
          ))}
        </div>
        <div style={{ flex: 1, display: 'flex', gap: 8 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{
              flex: 1, borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)',
              animation: `oblako-onb-rise var(--dur-slow) var(--ease-out) ${260 + i * 110}ms backwards`,
            }} />
          ))}
        </div>
      </div>
      <Pill text="группы, закрепление, разделение экрана" delay={430} />
    </ArtStack>
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

const SLIDES: Slide[] = [
  {
    title: 'Привет! Это Oblako',
    text: 'Браузер, в котором защита и ИИ уже внутри — ставить и настраивать ничего не нужно.',
    art: <ArtWelcome />,
  },
  {
    title: 'Реклама и слежка — мимо',
    text: 'Блокировщик работает с первой секунды, а VPN включается одной кнопкой «Защита» в верхней панели.',
    art: <ArtProtection />,
  },
  {
    title: 'ИИ под рукой, а не в облаке',
    text: 'Выделите текст — переведём, пересчитаем в пересказ или объясним. Модель работает прямо на вашем компьютере.',
    art: <ArtAi />,
  },
  {
    title: 'Вкладки сбоку, порядок в голове',
    text: 'Список вкладок слева и целиком виден. Складывайте их в группы, закрепляйте нужные, делите экран пополам.',
    art: <ArtTabs />,
  },
];

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
type StepKind = 'slide' | 'import' | 'model' | 'index' | 'guide';

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
  useScrim(); // затемняем и нативную зону системных кнопок, см. src/scrimState.ts
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
    const out: StepKind[] = SLIDES.map(() => 'slide' as const);
    out.push('import');
    if (modelStepShown) out.push('model');
    if (historyImported) out.push('index');
    // ⚠️ Гайд — БЕЗУСЛОВНЫЙ и последний. Соблазн привязать его к загрузке модели («расскажем, пока
    // качается») есть, но привязка означала бы, что человек, отказавшийся от модели, гайда не
    // увидит вовсе — а отказ от модели не должен ничего отнимать. Меняется только рамка разговора:
    // идёт загрузка — «пока качается», не идёт — просто «напоследок».
    out.push('guide');
    return out;
  }, [modelStepShown, historyImported]);

  const kind = steps[step] ?? 'slide';
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
      if (e.key === 'ArrowRight' && step < SLIDES.length) setStep((s) => s + 1);
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

  const slide = SLIDES[step];

  // Шапка шага: картинка, заголовок, подпись. ⚠️ Ровно одна точка на все виды шагов — раньше
  // здесь стоял тернарник «слайд или импорт», и любой третий вид шага уронил бы экран на
  // SLIDES[step].art, которого у него нет.
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
      art: slide.art, title: slide.title, text: slide.text,
    };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: 'var(--scrim, rgba(0,0,0,0.4))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      // Экран нельзя закрыть кликом мимо: это не диалог, а первый разговор — выход из него
      // есть, но осознанный («Пропустить»/«Начать»).
    }}>
      <div style={{
        position: 'relative',
        width: 680, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 80px)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
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

        {/* Сцена и текст — одним блоком с общим ключом по шагу: смена слайда проигрывает
            появление целиком, иначе картинка «переезжала» бы отдельно от подписи. */}
        <div key={step} style={{
          flex: 'none', animation: 'oblako-onb-rise var(--dur-slow) var(--ease-out)',
        }}>
          <div style={{ height: 260, padding: '28px 32px 0' }}>
            {head.art}
          </div>

          <div style={{ padding: '26px 56px 0', textAlign: 'center' }}>
            {/* Крупно: это первый экран, который человек видит, и читать его он будет с
                расстояния вытянутой руки, а не вчитываясь. */}
            {/* ⚠️ Дисплейная гарнитура — онбординг один из трёх экранов, где она разрешена (см.
                CLAUDE.md): это «лицо» продукта, а не интерфейс. lineHeight поднят против её
                фирменного 1: на двух строках заголовка плотный интерлиньяж слипается. */}
            <div style={{ ...DISPLAY, fontSize: 30, lineHeight: 1.2, color: 'var(--text-strong)' }}>
              {head.title}
            </div>
            <div style={{ marginTop: sp(2), fontSize: 'var(--fs-md)', color: 'var(--text-muted)', lineHeight: 1.55 }}>
              {head.text}
            </div>
          </div>
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
 * Иллюстрация гайда — схема окна с подсвеченными местами, о которых идёт речь: щит в адресной
 * строке, полоса вкладок слева, плитки рабочего стола, боковая ИИ-панель справа.
 *
 * ⚠️ Схема, а не значки в ряд: значки уже стоят в карточках под ней, и повторить их сверху значило
 * бы сказать то же самое дважды. Здесь работа другая — показать, ГДЕ это находится в окне.
 */
function ArtGuide() {
  const cell: React.CSSProperties = {
    borderRadius: RADIUS.control, background: 'var(--surface-sunken)',
  };
  return (
    <ArtStack>
      <div style={{
        ...islandPlate, borderRadius: 'var(--radius-card)', padding: sp(2), width: 400, height: 190,
        display: 'flex', flexDirection: 'column', gap: sp(2),
      }}>
        {/* Верхняя полоса: щит слева от адреса — то самое место из первой карточки. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: sp(1) }}>
          <span style={{
            width: 26, height: 26, borderRadius: RADIUS.control, flex: 'none',
            display: 'grid', placeItems: 'center',
            background: 'color-mix(in srgb, var(--dot-vpn) 18%, transparent)',
            animation: 'oblako-onb-rise var(--dur-slow) var(--ease-out) 80ms backwards',
          }}>
            <Shield size={15} style={{ color: 'var(--dot-vpn)' }} />
          </span>
          <div style={{ ...cell, flex: 1, height: 26 }} />
          <span style={{
            width: 26, height: 26, borderRadius: RADIUS.control, flex: 'none',
            display: 'grid', placeItems: 'center', background: 'var(--accent-soft)',
            animation: 'oblako-onb-rise var(--dur-slow) var(--ease-out) 300ms backwards',
          }}>
            <Sparkles size={15} style={{ color: 'var(--accent)' }} />
          </span>
        </div>

        <div style={{ flex: 1, display: 'flex', gap: sp(2), minHeight: 0 }}>
          {/* Полоса вкладок слева — она же место, где живут группы и закрепление. */}
          <div style={{ width: 64, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{
                ...cell, height: 16,
                background: i === 0 ? 'var(--accent)' : 'var(--surface-sunken)',
              }} />
            ))}
          </div>
          {/* Рабочий стол новой вкладки: плитки приложений и виджетов. */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} style={{
                ...cell,
                background: i === 1 || i === 4 ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'var(--surface-sunken)',
                animation: `oblako-onb-rise var(--dur-slow) var(--ease-out) ${140 + i * 45}ms backwards`,
              }} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: sp(1) }}>
        <Pill text="щит" dot="var(--dot-vpn)" delay={140} />
        <Pill text="приложения" delay={220} />
        <Pill text="цвет" dot="var(--accent)" delay={300} />
        <Pill text="ИИ-панель" delay={380} />
      </div>
    </ArtStack>
  );
}

// Иллюстрация шага переноса: данные перетекают из чужого браузера в наш.
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
        }}><CloudMark size={62} /></div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Pill text="закладки" delay={120} />
        <Pill text="история" delay={200} />
        <Pill text="пароли" delay={280} />
      </div>
    </ArtStack>
  );
}
