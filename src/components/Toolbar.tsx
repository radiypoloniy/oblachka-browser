import React, { useEffect, useRef, useState, useCallback } from 'react';
// ⚠️ Значки, которые человек видит каждую минуту, — свои (штрих плюс тело, см. glyphs.tsx).
// Остальное остаётся на lucide: в глубине интерфейса характер набора никто не заметит, а
// перерисовка всего означала бы правку импортов в шести десятках файлов ради того же результата.
import type { TabState, SuggestDropdownItem, PageTranslateState, PageTranslateProgress } from '../../shared/ipc';
import { CHROME_OVERLAY_PX } from '../../shared/chromeGround';
// Жизненный цикл и разговор с main — в хуках рядом (docs/architecture-code.md, §Хук).
import { useSearchEngine } from './toolbar/useSearchEngine';
import { useClipboardCount } from './toolbar/useClipboardCount';
import { useBookmarked } from './toolbar/useBookmarked';
import { useOmniboxGeometry } from './toolbar/useOmniboxGeometry';
import { useOmniboxPanel } from './toolbar/useOmniboxPanel';
import { useOmniboxSuggestions } from './toolbar/useOmniboxSuggestions';
import { useProfileBadge } from './toolbar/useProfileBadge';
import { useDownloadFlight } from './toolbar/useDownloadFlight';
import { useEngineMenu } from './toolbar/useEngineMenu';
import { NavCluster } from './toolbar/NavCluster';
import { RightCluster } from './toolbar/RightCluster';
import { usePopoverFlags } from './toolbar/usePopoverFlags';
import { usePermissionHint } from './toolbar/usePermissionHint';
import { usePasswordIndicator } from './toolbar/usePasswordIndicator';
import { useOmniboxValue } from './toolbar/useOmniboxValue';
import { useToolbarPopovers } from './toolbar/useToolbarPopovers';
import { OmniboxPill } from './toolbar/OmniboxPill';

// Высота тулбара = высота полосы системных кнопок Windows. Если разъедутся, кнопки
// ОС сядут на другой цвет, чем остальная шапка.
const TOOLBAR_HEIGHT = CHROME_OVERLAY_PX;

// ⚠️ Здесь стояла ПИЛЮЛЯ «Защита» со ступенчатым схлопыванием (full → short → icon по двум
// порогам ширины). Пилюли больше нет: VPN и адблок переехали под щит в адресной строке, потому
// что щит и замок отвечали на один и тот же вопрос — «что защищает меня прямо сейчас». Вместе с
// пилюлёй ушли и пороги: схлопывать нечего, у щита один размер.

// ⚠️ Здесь стояла таблица RIGHT_RESERVE: сколько пикселей от ЦЕНТРА занимает правая группа
// кнопок в каждом режиме VPN. Омнибокс был абсолютно спозиционирован по центру окна
// (left:50%), и его ширина считалась как `toolbarWidth − 2×RIGHT_RESERVE − 2×GAP` — резерв
// вычитался СИММЕТРИЧНО, иначе центрированная таблетка наехала бы на правую группу.
//
// Отсюда и брался провал в полосе. Слева от центра стоит только плашка навигации (~130px), а
// резервировалось под неё столько же, сколько нужно правой группе (до 440px) — просто потому,
// что элемент центрирован. Триста пикселей пустоты были не недосмотром вёрстки, а прямым
// следствием центрирования: убрать их, сохранив центр, было невозможно в принципе.
//
// Теперь омнибокс живёт во flex-потоке между навигацией и правой группой. Flex не умеет
// накладывать элементы друг на друга — то есть гарантия «не наезжает» стала конструктивной, а
// не арифметической, и ручная таблица резервов больше не нужна ни в каком виде.

// ⚠️ Предела ширины у омнибокса намеренно НЕТ. Прежние 620px подбирались под центрированную
// таблетку, и в потоке любой предел просто переносит провал вправо: остаток ширины уходит в
// marginLeft:auto правой группы, то есть пустота переезжает из-под навигации под «Защиту».
// Замерено на 2560px — дыра выходила больше тысячи пикселей. Поэтому строка занимает всё
// свободное место, как в Chrome, Edge и Safari.

// ⚠️ Пороги схлопывания (плейсхолдер, капсула поисковика) переехали в useOmniboxGeometry —
// туда же, где живут замеры, из которых они читаются. Смысл ступеней там же:
// full — полное имя движка, compact — первая буква, hidden — приоритет у поля ввода.

// ── Типы ─────────────────────────────────────────────────────────────────────

// Тот же тип, что шлётся во вью нативного дропдауна (shared/ipc.ts) — переиспользуем напрямую,
// чтобы форма подсказки не разъезжалась между двумя дропдаунами (chrome-DOM и native, заход 3/5).
type SuggestItem = SuggestDropdownItem;

interface ToolbarProps {
  tab: TabState | undefined;
  allTabs: TabState[];
  // Заливка щита пилюли «Защита» — реальный статус VPN (VpnConnectionState.state === 'running'),
  // не захардкоженный плейсхолдер (см. живой аудит: фейковый лейбл, не привязанный к реальному
  // состоянию, — это то самое ложное чувство защищённости, от которого fail-closed на шаге 3
  // явно уходит). Название сервера в саму пилюлю больше не выводим (заход «Защита», шаг 4) —
  // оно осталось внутри поповера (VpnIndicatorPopover.tsx), кнопка объединяет VPN + адблок и
  // больше не размечена под конкретный сервер.
  vpnOn: boolean;
  omniboxRef?: React.RefObject<HTMLInputElement>;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onSubmit: (input: string) => void;
  onSuggestToggle?: (open: boolean) => void;
  downloadsActive: boolean;   // есть хотя бы одна активная загрузка
  downloadsProgress: number | null; // совокупный прогресс 0..1; null — размер неизвестен
  downloadStartTick: number;  // растёт на КАЖДУЮ новую загрузку — триггер анимации прилёта
  onToggleAiPanel: () => void; // тоггл правой AI-панели (оверлей, см. AiPanelManager.ts)
  aiPanelOpen: boolean;       // панель открыта — кнопка подсвечена акцентом
  pageTranslateState: PageTranslateState; // см. PageTranslateManager.ts
  pageTranslateProgress: PageTranslateProgress | null; // батч N/M + живой счётчик символов, только пока translating
  // Роль окна: в лёгком окне AI-панели и перевода страниц нет — обе службы живут в приложении
  // в одном экземпляре и принадлежат полному окну (см. WindowRegistry.ts). Показывать кнопку,
  // которая полезет в чужие вкладки, хуже, чем не показывать её вовсе.
  isLightWindow?: boolean;
}

// ── Компонент ─────────────────────────────────────────────────────────────────

export default function Toolbar({
  // dark/onToggleDark из пропсов убраны совсем: кнопку темы отсюда сняли ещё раньше, а теперь у
  // темы есть настоящий дом — раздел «Интерфейс» (см. AppearanceSection.tsx). Держать мёртвую
  // пару пропсов «на всякий случай» значило бы оставить второй, ни к чему не подключённый способ
  // менять тему.
  tab, allTabs, vpnOn, omniboxRef: externalRef,
  onBack, onForward, onReload, onSubmit, onSuggestToggle,
  downloadsActive, downloadsProgress, downloadStartTick, onToggleAiPanel, aiPanelOpen,
  pageTranslateState, pageTranslateProgress, isLightWindow = false,
}: ToolbarProps) {
  const isHub = tab?.isHub ?? true;
  const [editing, setEditing] = useState(false);
  // Что показано в строке и что человек набрал, но не отправил — см. useOmniboxValue.
  const { value, setValue, forgetDraft, draftsRef } = useOmniboxValue(tab, editing);
  // Пока строку правят, Escape принадлежит омнибоксу, а не странице (разбор — в TabManager).
  useEffect(() => { window.oblako.setOmniboxEditing(editing); }, [editing]);

  const [copied, setCopied] = useState(false);
  // Четыре поповера тулбара и их синхронизация с main — см. usePopoverFlags.
  const popovers = usePopoverFlags();
  // Ключик менеджера паролей у строки — своё состояние и своё содержимое поповера
  // (см. usePasswordIndicator). Якорь и клик мимо держит useAnchoredPopover, как у соседей.
  const passwordIndicator = usePasswordIndicator(popovers.password, popovers.setPassword);
  const [suggestions, setSuggestions] = useState<SuggestItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const clipboardCount = useClipboardCount();
  const flying = useDownloadFlight(downloadStartTick);

  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? internalRef;
  // Поколение запроса подсказок. ⚠️ Живёт ЗДЕСЬ, а не в одном из хуков: панель нетронутой строки
  // (useOmniboxPanel) и подсказки по тексту (useOmniboxSuggestions) пишут в ОДИН список, и
  // отбрасывать протухшие ответы обязаны одним и тем же счётчиком. Заведи каждый свой — и
  // медленная дорисовка панели затирала бы уже набранные подсказки.
  const suggestSeqRef = useRef(0);
  // «Отставить» у машины подсказок — см. closeDropdown ниже, почему через ref.
  const cancelSuggestRef = useRef<() => void>(() => {});
  // Момент последней отправки. Нужен фокус-циклу ниже: submit() снимает фокус НАМЕРЕННО, и
  // возвращать его в этот момент нельзя — иначе строка перехватывает фокус у только что
  // открытой страницы (и держит editing, из-за чего набранный текст не сменялся адресом).
  const submittedAtRef = useRef(0);
  // Первый показ хаба за жизнь окна — старт приложения. Ему нужно окно ожидания длиннее (см.
  // эффект фокуса ниже), поэтому случай отличается флагом, а не таймером «на всякий случай».
  const firstHubRef = useRef(true);
  // Unified focus tracker: объединяет realMouseDownRef + hasRealFocusRef в один объект.
  // Отличает настоящий клик пользователя от спонтанных событий фокуса при addChildView/removeChildView
  // нативной WebContentsView дропдауна. isRealFocus = true выставляется ТОЛЬКО настоящим mousedown
  // по инпуту, false — только когда мы САМИ явно закончили редактирование (см. closeDropdownFully).
  // mouseDownOnInput — кратковременный флаг (автосброс через RAF), различающий «клик в инпут» от
  // «спонтанный refocus после removeChildView» (тот не предшествует синхронному mousedown).
  const focusTracker = useRef({
    isRealFocus: false,
    mouseDownOnInput: false,
  });
  // ⚠️ «Выделить всё» ЖДЁТ ОТПУСКАНИЯ КНОПКИ, а не решается на нажатии, — так работает адресная
  // строка Chrome, и разница принципиальная. Клик по несфокусированной строке выделяет всё; но
  // если человек нажал и ПОТЯНУЛ, он выделяет ровно то, что протянул. Отличить одно от другого в
  // момент нажатия физически нельзя — протяжки ещё не было.
  const selectAllPendingRef = useRef(false);
  // Кнопка мыши зажата внутри строки — на это время цикл автофокуса хаба обязан молчать (см. ниже).
  const pointerInInputRef = useRef(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // «Таблетка» омнибокса (иконка+инпут+капсула/copy) — прямоугольник, под которым должен
  // вставать дропдаун подсказок. Пушится в main отдельным каналом (OMNIBOX_SET_BOUNDS) —
  // фундамент под будущую нативную вью дропдауна, сам дропдаун этот заход не трогает.
  const omniboxPillRef = useRef<HTMLDivElement>(null);
  const passwordControlRef = useRef<HTMLDivElement>(null);
  const downloadsControlRef = useRef<HTMLDivElement>(null);
  const clipboardControlRef = useRef<HTMLDivElement>(null);
  const siteControlRef = useRef<HTMLButtonElement>(null);

  // Замеры тулбара и таблетки, пороги схлопывания и отправка геометрии дропдауну — всё вместе,
  // потому что это одна тема: пороги читаются только из этих замеров (см. useOmniboxGeometry).
  const { toolbarWidth, capsuleMode, placeholderVisible, pushOmniboxBounds } =
    useOmniboxGeometry(toolbarRef, omniboxPillRef);

  const searchEngineId = useSearchEngine();
  // ⚠️ Пара, а не одно значение: клик по звезде ставит признак ОПТИМИСТИЧНО, а BOOKMARK_CHANGED
  // затем подтверждает или поправляет — иначе звезда загоралась бы с задержкой в круг IPC.
  const [bookmarked, setBookmarked] = useBookmarked(!isHub ? tab?.url : undefined);
  // Состояние разрешений сайта для точки на щите (см. usePermissionHint).
  const permHint = usePermissionHint(isHub ? '' : (tab?.url ?? ''));

  // Капсула выбора поисковика — только на хабе (см. useEngineMenu).
  const {
    open: engineMenuOpen, setOpen: setEngineMenuOpen, btnRef: engineBtnRef, pick: pickEngine,
  } = useEngineMenu(isHub);


  // Новая вкладка — сразу можно печатать: фокус в адресной строке.
  //
  // ⚠️ Живёт ЗДЕСЬ, а не в App.tsx, и это не вкусовщина. Первая версия правки стояла в App.tsx
  // и спорила с submit(), который блёрит строку намеренно: человек нажимал Enter на хабе, строка
  // теряла фокус — и тут же получала его обратно от чужого цикла. Политика фокуса адресной
  // строки обязана жить там, где известно про отправку, черновики и editing.
  //
  // ⚠️ Ждём `tab`, а не полагаемся на isHub. При старте приложения tab ещё не приехал из main,
  // а isHub по умолчанию true — эффект отрабатывал вхолостую до появления самой строки, и
  // браузер, открывшийся на новой вкладке, оставался без фокуса. Это была вторая жалоба.
  //
  // ⚠️ Одного focus() не хватает: замер показал, что строка получает фокус и теряет его через
  // пару миллисекунд — хром перерисовывается на приход списка вкладок из main, и поле в этот
  // момент пересоздаётся. Поэтому фокус подтверждается несколько кадров подряд. Отступаем, если
  // фокус занял ДРУГОЕ поле ввода (человек сам выбрал, куда печатать) — но не если его держит
  // кнопка: вкладку открывают кликом по «Новая вкладка», и она остаётся сфокусированной.
  // ⚠️ ЗАПУСК ПРИЛОЖЕНИЯ — отдельный случай с длинным окном. Обычная смена вкладки успокаивается
  // за пару кадров, а старт — нет: одновременно восстанавливается сессия, создаются вью вкладок,
  // окно только получает фокус ОС. Короткого окна там не хватало, и браузер, открывшийся на новой
  // вкладке, оставался без фокуса — при том что переключение на новую вкладку уже работало.
  // Плюс перезапуск по событию фокуса окна: если фокус ОС пришёл позже нашего окна ожидания,
  // без этого он бы уже никого не застал.
  useEffect(() => {
    if (!isHub || !tab) return;
    let raf = 0;
    const isTypingTarget = (el: Element | null) =>
      !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
        || (el as HTMLElement).isContentEditable);
    const run = (windowMs: number) => {
      const deadline = performance.now() + windowMs;
      const settle = () => {
        // Только что отправили запрос — blur был осознанным, не отбираем его обратно.
        // ⚠️ Окно короче срока жизни цикла намеренно: длиннее — и «Enter, сразу новая вкладка»
        // не получил бы фокуса вовсе, потому что подавление пережило бы весь цикл. Дольше
        // держать и не нужно — после отправки хаб перестаёт быть активным, и цикл гаснет сам.
        if (performance.now() - submittedAtRef.current < 300) return;
        // ⚠️ Пока кнопка мыши зажата в строке, цикл обязан молчать: он делает focus()+select()
        // каждый кадр, то есть попал бы ровно в середину протяжки и выделил всё вместо
        // протянутого. На хабе это окно активно первые 400 мс (и до 3 с на старте) — как раз
        // тогда, когда человек первым делом и лезет в адресную строку.
        if (pointerInInputRef.current) return;
        const input = inputRef.current;
        const active = document.activeElement;
        if (input && active !== input && isTypingTarget(active)) return; // выбор человека — не спорим
        if (input && active !== input) { input.focus(); input.select(); }
        if (performance.now() < deadline) raf = requestAnimationFrame(settle);
      };
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(settle);
    };
    run(firstHubRef.current ? 3000 : 400);
    firstHubRef.current = false;
    const onWindowFocus = () => run(400);
    window.addEventListener('focus', onWindowFocus);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('focus', onWindowFocus); };
  }, [isHub, tab?.id]);

  // ⚠️ Звезда больше не ТУМБЛЕР. Прежнее поведение («нажал — сохранил в корень, нажал ещё —
  // удалил») не давало положить страницу в папку вовсе: единственным местом закладки был корень,
  // и разгребать его приходилось потом руками. Теперь клик сохраняет и сразу предлагает папку —
  // тем же меню, что и Ctrl+D. Удаление никуда не делось, оно последним пунктом того же меню.
  // ⚠️ Индикатор товара отсюда убран: отслеживание цены переехало в меню «⋯» адресной строки,
  // и состояние для него main держит у себя — renderer его больше не запрашивает вовсе.

  const toggleBookmark = () => {
    if (!tab?.url) return;
    setBookmarked(true); // оптимистично — BOOKMARK_CHANGED подтвердит или поправит
    void window.oblako.showBookmarkMenu();
  };

  const openDropdown = useCallback(() => {
    // Живой баг: изредка на самом старте браузера (тяжёлый main-процесс — восстановление сессии,
    // индексация истории и т.п. одновременно) дропдаун вообще не появлялся. Причина — гонка:
    // прямоугольник омнибокса пушится в main отдельным эффектом на mount (см. useEffect выше),
    // а main держит его как lastOmniboxBounds с дефолтом {0,0,0,0} до первого прихода. Если
    // дропдаун открывается РАНЬШЕ, чем этот самый первый push успел долететь (при загруженном
    // старте — не микросекунды, а заметная задержка), showSuggestDropdown считает bounds от
    // нулевого прямоугольника — вью реально создаётся и крепится, просто в невидимой точке (0,0)
    // вместо места под полем. Досылаем свежий прямоугольник СИНХРОННО прямо здесь, непосредственно
    // перед открытием — тем же вызовом getBoundingClientRect(), что и в эффекте, но гарантированно
    // не позже сигнала на открытие (тот же процесс, тот же тик — Electron сохраняет порядок IPC
    // одного канала между одной парой процессов).
    // Через ту же дедуплицирующую точку: если прямоугольник не менялся, main уже знает верное
    // значение и повторное сообщение ничего не добавляет (сам смысл этого досыла — не оставить
    // main со СТАРЫМ/нулевым прямоугольником, а не отправить именно ещё один пакет).
    pushOmniboxBounds();
    setDropdownOpen(true);
    onSuggestToggle?.(true);
  }, [onSuggestToggle, pushOmniboxBounds]);

  // Унифицированное закрытие дропдауна — единая точка для ВСЕХ путей закрытия (клик мимо,
  // Esc, выбор, смена вкладки, фокус на контент и т.д.). Синхронизирует React-состояние,
  // нативную вью (setSuggestDropdownOpen) и состояние редактирования в одном месте.
  const closeDropdown = useCallback((_reason = 'unknown') => {
    suggestSeqRef.current++;
    // Гасим и сам отложенный пересчёт. ⚠️ Через ref, а не прямым вызовом: таймер и признак
    // «список показан» переехали в useOmniboxSuggestions, а тот получает эту же closeDropdown
    // аргументом — прямая ссылка замкнула бы их друг на друга. Ref проставляется ниже, к моменту
    // первого закрытия он уже настоящий.
    cancelSuggestRef.current();
    setDropdownOpen(false);
    setSuggestions([]);
    setSelectedIdx(-1);
    onSuggestToggle?.(false);
    // Открепление нативной вью — НЕ через опциональный onSuggestToggle (тот существует для
    // внешней синхронизации App.tsx, но closeDropdown не должен ЗАВИСЕТЬ от того, передан ли он
    // вообще). Прямой вызов того же канала, что открытие — единственная точка закрытия (эту
    // функцию), гарантированно доводит React-состояние и факт прикрепления вью (isAttached() в
    // SuggestDropdownManager.ts) до одного и того же результата на КАЖДОМ пути закрытия.
    void window.oblako.setSuggestDropdownOpen(false);
    // Снимаем клавиатурную подсветку во вью — иначе при следующем открытии на миг мелькнёт
    // подсветка строки от предыдущей сессии.
    void window.oblako.setSuggestDropdownHighlight(-1);
  }, [onSuggestToggle]);

  // Полное закрытие дропдауна + завершение редактирования — используется когда пользователь
  // действительно закончил работу с омнибоксом (клик мимо, фокус на контент, смена вкладки).
  // Синхронно гасит focusTracker.isRealFocus — так спонтанный refocus от removeChildView,
  // даже молча вернув document.activeElement на инпут, не может обмануть следующий реальный
  // клик: isRealFocus остаётся false, пока сюда не заглянет САМ пользователь новым mousedown.
  const closeDropdownFully = useCallback((reason: string) => {
    closeDropdown(reason);
    setEditing(false);
    focusTracker.current.isRealFocus = false;
  }, [closeDropdown]);

  // ⚠️ Отпустить кнопку можно и ЗА пределами строки — протяжка через край обычное дело. Тогда
  // onMouseUp самой строки не придёт вовсе, и флаг «кнопка зажата» остался бы висеть, навсегда
  // заглушив цикл автофокуса хаба. Слушаем документ, не строку.
  useEffect(() => {
    const clear = () => { pointerInInputRef.current = false; };
    document.addEventListener('mouseup', clear, true);
    return () => document.removeEventListener('mouseup', clear, true);
  }, []);

  // Ref для closeDropdownFully — чтобы слушатель mousedown не пересоздавался при каждом изменении
  // колбэка, но всегда вызывал актуальную версию. Тот же приём, что pickSuggestionRef ниже.
  const closeDropdownFullyRef = useRef(closeDropdownFully);
  closeDropdownFullyRef.current = closeDropdownFully;

  const profile = useProfileBadge();
  // Четыре поповера тулбара — в useToolbarPopovers (механика у всех одна).
  const {
    togglePasswordPopover, toggleDownloadsPopover, toggleClipboardPopover, toggleSitePopover,
  } = useToolbarPopovers({
    popovers, closeDropdownFully, passwordIndicator, toolbarWidth,
    passwordControlRef, downloadsControlRef, clipboardControlRef, siteControlRef,
  });


  // ── Заход 5 (кардинальный фикс): закрытие БЕЗ blur ──────────────────────────────────────────
  // blur омнибокса — НЕ триггер закрытия (по образцу FindBar/поповера/AI-панели, см. BACKLOG.md:
  // «blur НИКОГДА не использовать как механику закрытия» — addChildView новой вью дропдауна шлёт
  // спонтанный blur, неотличимый от реального без хрупкого флага-подпорки). Вместо этого —
  // независимые явные сигналы «фокус реально ушёл»:

  // Все три сигнала ниже висят, пока омнибокс в режиме редактирования (editing), А НЕ пока
  // dropdownOpen — иначе фокус-в-поле-без-набора-текста (dropdownOpen так и остаётся false)
  // никогда не увидел бы «клик мимо» и editing завис бы навсегда (поле перестало бы отражать
  // реальный URL вкладки, см. useEffect на tab?.url/editing выше). closeDropdown() внутри —
  // безопасный no-op, если дропдаун и так уже закрыт.

  // (1) Клик МИМО внутри ЭТОГО ЖЕ webContents (chromeView: тулбар/сайдбар/хаб) — обычный
  // однопроцессный DOM mousedown, никакой гонки addChildView тут нет (её вызывает исключительно
  // показ ОТДЕЛЬНОЙ вью дропдауна, а не клик внутри уже существующего chromeView). Слушатель висит
  // ТОЛЬКО пока идёт редактирование — сам момент фокусировки (клик в омнибокс) уже завершён к
  // моменту, когда React успевает навесить этот эффект, самозакрытия на открывающем клике не будет.
  useEffect(() => {
    if (!editing) return;
    const onOutsideMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // Клик внутри самого омнибокса — не закрывать (продолжаем редактирование)
      const insidePill = omniboxPillRef.current?.contains(target);
      if (insidePill) return;

      // Клик мимо — закрываем дропдаун и завершаем редактирование
      closeDropdownFullyRef.current('outside-click');
    };
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    return () => document.removeEventListener('mousedown', onOutsideMouseDown, true);
  }, [editing]);

  // (2) Реальный OS-фокус ушёл на контент активной вкладки (ДРУГОЙ webContents — клик мышью по
  // странице) — main шлёт это из TabManager.wirePageEvents::wc.on('focus'), см. shared/ipc.ts::
  // SUGGEST_DROPDOWN_CONTENT_FOCUS.
  useEffect(() => {
    if (!editing) return;
    return window.oblako.onSuggestDropdownContentFocus(() => {
      closeDropdownFullyRef.current('content-focus');
    });
  }, [editing]);

  // (3) Смена активной вкладки (мышью по сайдбару — уже покрыто (1); Ctrl+Tab/Ctrl+1-9 — нет) —
  // дропдаун анкорен к прежнему контексту, смысла в нём больше нет (тот же принцип, что
  // closeTranslatePopoverOnTabSwitch у поповера перевода).
  // ⚠️ Зависимость — ТОЛЬКО tab?.id, намеренно: эффект должен стрелять исключительно на смену
  // вкладки. editing/поповеры здесь читаются из замыкания последнего рендера (эффект выполняется
  // после него, значения актуальны). Добавить editing в deps = эффект срабатывает на сам вход в
  // режим редактирования и мгновенно его гасит — омнибокс становится неуправляемым.
  useEffect(() => {
    if (editing) { closeDropdownFullyRef.current('tab-switch'); }
    if (popovers.password) {
      popovers.setPassword(false);
      void window.oblako.closePasswordPopover();
    }
    if (popovers.site) {
      popovers.setSite(false);
      void window.oblako.toggleSitePopover();
    }
    if (popovers.downloads) {
      popovers.setDownloads(false);
      void window.oblako.closeDownloadsPopover();
    }
  }, [tab?.id]);


  // Панель по клику в НЕТРОНУТУЮ строку — плитки часто посещаемых, набор «Рекомендуемые»,
  // полоска сайта и «вы это уже читали». Живёт хуком рядом (см. useOmniboxPanel), сюда возвращает
  // одну функцию. ⚠️ Счётчик поколений отдаём ОБЩИЙ: панель и подсказки пишут в один список, и
  // отбрасывать протухшие ответы они обязаны одинаково.
  // Подсказки по набранному тексту — история, вкладки, живые подсказки поисковика, разделы
  // настроек, поиск вкладки по смыслу. Живут хуком рядом (см. useOmniboxSuggestions).
  const { triggerSuggest, cancelPending } = useOmniboxSuggestions({
    allTabs,
    searchEngineId,
    seqRef: suggestSeqRef,
    openDropdown,
    closeDropdown,
    setSuggestions,
    setSelectedIdx,
  });

  cancelSuggestRef.current = cancelPending;

  const { showTopSites } = useOmniboxPanel({
    tabUrl: tab?.url,
    isHub,
    seqRef: suggestSeqRef,
    openDropdown,
    closeDropdown,
    setSuggestions,
    setSelectedIdx,
  });

  const submit = (input: string) => {
    const v = input.trim();
    if (!v) return;
    onSubmit(v);
    submittedAtRef.current = performance.now();
    inputRef.current?.blur();
    closeDropdownFully('submit');
    setValue(v);
    // Реальная навигация — черновик этой вкладки отправлен, хранить нечего (на случай, если
    // url ещё не успел обновиться в проп tab — эффект на tab?.url ниже подчистил бы его и сам,
    // но не сразу, а после того как навигация реально произойдёт).
    if (tab) forgetDraft(tab.id);
  };

  const copyUrl = async () => {
    if (!tab?.url) return;
    try {
      await navigator.clipboard.writeText(tab.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* noop */ }
  };

  const pickSuggestion = (item: SuggestItem) => {
    if (item.kind === 'tab' && item.tabId) {
      // Вкладка чужого окна переключается своим каналом: TAB_ACTIVATE адресуется окну-отправителю
      // и такой вкладки у себя не найдёт (см. AI-IDEAS.md №8).
      if (item.windowId !== undefined) void window.oblako.activateTabInWindow(item.windowId, item.tabId);
      else void window.oblako.activateTab(item.tabId);
      closeDropdownFully('pick-tab');
    } else {
      submit(item.url);
    }
  };

  // Клик по строке ВО вью нативного дропдауна (другой webContents, заход 3/5) — main пересылает
  // выбор сюда, вызываем тот же pickSuggestion(), что и старый chrome-DOM дропдаун (не дублируем
  // его поведение). Ref — чтобы не пересобирать подписку на каждый рендер (pickSuggestion не
  // мемоизирована), тот же приём, что allTabsRef в app/useTabOrganizer.ts.
  const pickSuggestionRef = useRef(pickSuggestion);
  pickSuggestionRef.current = pickSuggestion;
  useEffect(() => {
    return window.oblako.onSuggestDropdownPicked((item) => { pickSuggestionRef.current(item); });
  }, []);

  // Клавиатурная навигация. e.code — раскладконезависимо.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (dropdownOpen && suggestions.length > 0) {
      if (e.code === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(selectedIdx + 1, suggestions.length - 1);
        setSelectedIdx(next);
        void window.oblako.setSuggestDropdownHighlight(next);
        return;
      }
      if (e.code === 'ArrowUp') {
        e.preventDefault();
        const next = Math.max(selectedIdx - 1, -1);
        setSelectedIdx(next);
        void window.oblako.setSuggestDropdownHighlight(next);
        return;
      }
      if (e.code === 'Home') {
        e.preventDefault();
        setSelectedIdx(0);
        void window.oblako.setSuggestDropdownHighlight(0);
        return;
      }
      if (e.code === 'End') {
        e.preventDefault();
        const last = suggestions.length - 1;
        setSelectedIdx(last);
        void window.oblako.setSuggestDropdownHighlight(last);
        return;
      }
      if (e.code === 'Enter') {
        e.preventDefault();
        if (selectedIdx >= 0 && selectedIdx < suggestions.length) {
          pickSuggestion(suggestions[selectedIdx]);
        } else {
          submit(value);
        }
        return;
      }
    } else if (e.code === 'Enter') {
      submit(value);
      return;
    }
    if (e.code === 'Escape') {
      if (dropdownOpen) {
        closeDropdown('escape');
      } else {
        // Escape — явная отмена: в отличие от обычного клика мимо (тот черновик сохраняет),
        // здесь пользователь осознанно откатывает правку, как и в любом браузере.
        if (tab) forgetDraft(tab.id);
        setValue(isHub ? '' : (tab?.url ?? ''));
        inputRef.current?.blur();
        closeDropdownFully('escape-clear');
      }
    }
  };

  return (
    <div
      ref={toolbarRef}
      className="drag chrome-icons"
      style={{
        // alignItems:'flex-start' + paddingTop:--gutter-shell — верхняя кромка плашек-островов
        // совпадает с верхней кромкой сайдбара-острова (тот же токен воздуха). Высота контейнера
        // (TOOLBAR_HEIGHT) не меняется — плашки просто прижаты к верху вместо центрирования.
        display: 'flex', alignItems: 'flex-start', gap: 10, height: TOOLBAR_HEIGHT, flex: 'none',
        paddingLeft: 16, paddingRight: 138, paddingTop: 'var(--gutter-shell)',
        position: 'relative',
      }}
    >
      {/* Кнопки навигации — парящая плашка-остров (см. toolbar/NavCluster.tsx). */}
      <NavCluster
        canGoBack={!!tab?.canGoBack}
        canGoForward={!!tab?.canGoForward}
        isHub={isHub}
        onBack={onBack}
        onForward={onForward}
        onReload={onReload}
      />

      {/* Омнибокс — главный объект полосы, и теперь он занимает всё свободное место между
          навигацией и правой группой (см. разбор у OMNIBOX_MAX_WIDTH: прежнее центрирование
          по окну и порождало провал слева).
          pointer-events:none на обёртке больше не нужен: в потоке она ни на что не налезает,
          а значит и «пропускать клики насквозь» не через что. */}
      <div style={{
        // Обычный участник flex-потока: занимает всё, что осталось между навигацией и правой
        // группой, но не больше предела. Верхняя кромка приходит от родителя
        // (alignItems:'flex-start' + paddingTop) — отдельное выравнивание больше не нужно.
        flex: 1, minWidth: 0,
        display: 'flex', alignItems: 'flex-start',
      }}>
        <div
          className="no-drag"
          style={{ width: '100%', position: 'relative' }}
        >
          {/* Высота — из общего ISLAND_HEIGHT, не своим числом: раньше здесь стояло 38, а плашки
              рядом вырастали из содержимого в 40, и полоса выглядела собранной кое-как. */}
          <OmniboxPill
            tab={tab} isHub={isHub} value={value} copied={copied}
            bookmarked={bookmarked} vpnOn={vpnOn} profile={profile} permHint={permHint}
            popovers={popovers} passwordIndicator={passwordIndicator} searchEngineId={searchEngineId}
            inputRef={inputRef} omniboxPillRef={omniboxPillRef} siteControlRef={siteControlRef}
            passwordControlRef={passwordControlRef} draftsRef={draftsRef}
            focusTracker={focusTracker} pointerInInputRef={pointerInInputRef}
            selectAllPendingRef={selectAllPendingRef}
            setValue={setValue} setEditing={setEditing} copyUrl={() => void copyUrl()}
            toggleBookmark={toggleBookmark} triggerSuggest={triggerSuggest}
            showTopSites={() => void showTopSites()} handleKeyDown={handleKeyDown}
            togglePasswordPopover={togglePasswordPopover} toggleSitePopover={toggleSitePopover}
            capsuleMode={capsuleMode} placeholderVisible={placeholderVisible}
            engineMenuOpen={engineMenuOpen} setEngineMenuOpen={setEngineMenuOpen}
            engineBtnRef={engineBtnRef} pickEngine={pickEngine}
            pageTranslateState={pageTranslateState} pageTranslateProgress={pageTranslateProgress}
          />
        </div>

      </div>

      <RightCluster
        isLightWindow={isLightWindow}
        aiPanelOpen={aiPanelOpen}
        onToggleAiPanel={onToggleAiPanel}
        clipboardRef={clipboardControlRef}
        clipboardCount={clipboardCount}
        clipboardOpen={popovers.clipboard}
        onToggleClipboard={toggleClipboardPopover}
        onHoverClipboard={() => { if (clipboardCount > 0) window.oblako.prewarmPopover('clipboard'); }}
        downloadsRef={downloadsControlRef}
        downloadsOpen={popovers.downloads}
        onToggleDownloads={toggleDownloadsPopover}
        flying={flying}
        downloadsActive={downloadsActive}
        downloadsProgress={downloadsProgress}
      />
    </div>
  );
}

// Дуга прогресса вокруг кнопки загрузок. value=null — размер файла неизвестен, крутим
// бесконечную дугу: замершая на месте шкала врала бы, что работа встала.

// ── Пилюля «Защита» (VPN + адблок) ────────────────────────────────────────────

// islandPlate/islandBtn/navBtn — вынесены в src/styles/island.ts для переиспользования
// в других панелях (История/Настройки), см. импорт наверху файла. Вписаны в текущую высоту
// тулбара (TOOLBAR_HEIGHT не меняется) — сами токены стекла/тени/скругления не подбирались
// заново, те же, что уже отлажены в поповере/AI-панели.

