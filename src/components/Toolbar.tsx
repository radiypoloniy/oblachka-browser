import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, RefreshCw, Lock, Search, Shield, Sparkles, Copy, Check, Download, ChevronDown, KeyRound, Languages, Loader2, Star, VenetianMask } from 'lucide-react';
import type { TabState, HistoryEntry, SuggestDropdownItem, PasswordIndicatorState, PageTranslateState, PageTranslateProgress } from '../../shared/ipc';
import { normalizeForOmnibox, scoreEntry } from '../../shared/frecency';
import { SEARCH_ENGINES, getSearchEngine, DEFAULT_SEARCH_ENGINE_ID } from '../../shared/searchEngines';
import type { SearchEngineId } from '../../shared/searchEngines';
import { islandPlate, islandBtn, navBtn } from '../styles/island';
import { setDefaultSearchEngine, subscribeDefaultSearchEngine } from '../searchEngineSetting';

// Высота тулбара — должна совпадать с CSS-значением (56px).
const TOOLBAR_HEIGHT = 56;
// Дебаунс запроса к истории (мс).
const SUGGEST_DEBOUNCE = 150;
// Максимум строк в дропдауне.
const SUGGEST_MAX = 8;

// ── VPN-пилюля: ступенчатое схлопывание ─────────────────────────────────────

type VpnMode = 'full' | 'short' | 'icon';

// Ширина тулбара (= ширина колонки), при которой переключаем режим.
// full  : полный лейбл «VPN · Финляндия» / «VPN выкл.»
// short : только «VPN» + цветной индикатор
// icon  : только иконка-щит + индикатор
const VPN_THRESHOLD_FULL  = 1150;
const VPN_THRESHOLD_SHORT =  900;

// Сколько пикселей от центра уходит правая группа кнопок (paddingRight 138 +
// кнопки + отступы) в каждом режиме. Используется для вычисления ширины омнибокса
// так, чтобы он не наезжал на правую группу (оба — вправо от центра на это значение).
// +40 к каждому режиму относительно версии без кнопки Download (32px тело + 8px gap).
const RIGHT_RESERVE: Record<VpnMode, number> = {
  full:  440, // 138 sys + ~160 VPN + 32×3 AI/Moon/DL + 32 gap ≈ 396 + запас
  short: 355, // 138 sys +  ~85 VPN + 32×3 AI/Moon/DL + 32 gap ≈ 351
  icon:  305, // 138 sys +  ~35 VPN + 32×3 AI/Moon/DL + 32 gap ≈ 301
};

// Гарантированный зазор (px) между краем омнибокса и каждым боковым блоком.
// Вычитается с обеих сторон, поэтому отнимает 2×GAP от суммарной ширины.
const OMNIBOX_SIDE_GAP = 12;

// Ниже PLACEHOLDER_HIDE плейсхолдер скрывается — текст не помещается, иконка остаётся.
// Выше PLACEHOLDER_SHOW — возвращается. Зазор 20px = гистерезис против мигания.
const PLACEHOLDER_HIDE_THRESHOLD = 200;
const PLACEHOLDER_SHOW_THRESHOLD = 220;

// ── Капсула поисковика: то же ступенчатое схлопывание, что у VPN-пилюли, но по
// ширине САМОГО омнибокса (omniboxWidth), т.к. капсула живёт внутри его «таблетки».
// full   : полное имя движка («DuckDuckGo») + шеврон
// compact: только первая буква названия + шеврон — умещается даже на дефолтном окне
//          (омнибокс в режиме VPN 'short' уже узкий, полное имя туда не влезает,
//          см. заход с капсулой — иначе капсула вылезает за скруглённый край пилюли)
// hidden : совсем убираем на очень узких окнах — приоритет у поля ввода
type CapsuleMode = 'full' | 'compact' | 'hidden';
const CAPSULE_FULL_THRESHOLD = 380;
const CAPSULE_HIDE_THRESHOLD = 200;

// ── Типы ─────────────────────────────────────────────────────────────────────

// Тот же тип, что шлётся во вью нативного дропдауна (shared/ipc.ts) — переиспользуем напрямую,
// чтобы форма подсказки не разъезжалась между двумя дропдаунами (chrome-DOM и native, заход 3/5).
type SuggestKind = SuggestDropdownItem['kind'];
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
  onTogglePageTranslate: () => void;
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
  pageTranslateState, pageTranslateProgress, onTogglePageTranslate, isLightWindow = false,
}: ToolbarProps) {
  const isHub = tab?.isHub ?? true;
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [toolbarWidth, setToolbarWidth] = useState(1280);
  const [placeholderVisible, setPlaceholderVisible] = useState(true);
  const [passwordIndicator, setPasswordIndicator] = useState<PasswordIndicatorState | null>(null);
  const [passwordPopoverOpen, setPasswordPopoverOpen] = useState(false);
  const [vpnPopoverOpen, setVpnPopoverOpen] = useState(false);
  const [downloadsPopoverOpen, setDownloadsPopoverOpen] = useState(false);
  const [sitePopoverOpen, setSitePopoverOpen] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  // Анимация прилёта файла в кнопку загрузок. Живёт ровно столько, сколько играет — держать
  // её состоянием после окончания незачем, а CSS-анимация без размонтирования не перезапустится
  // на вторую загрузку подряд.
  const [flying, setFlying] = useState(false);
  useEffect(() => {
    if (downloadStartTick === 0) return; // стартовое значение, загрузок ещё не было
    setFlying(true);
    const t = setTimeout(() => setFlying(false), 820);
    return () => clearTimeout(t);
  }, [downloadStartTick]);

  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? internalRef;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestSeqRef = useRef(0);
  // Черновик (набранный, но не отправленный текст) — по вкладке, переживает потерю фокуса и
  // переключение вкладок, как в популярных браузерах: просто отвлечься на другую вкладку не должно
  // стирать то, что печатали. Стирается явно — submit() (реальная навигация) и Escape (см.
  // handleKeyDown) — а не любым blur/setEditing(false) (клик мимо, фокус на контент, тоггл
  // поповера паролей/VPN и т.п. этот Map не трогают вовсе).
  const draftsRef = useRef<Map<string, string>>(new Map());
  // Последняя (id, url) АКТИВНОЙ вкладки — отличает «эта же вкладка реально куда-то перешла»
  // (черновик стал неактуален) от «просто переключились на другую вкладку» (черновик той вкладки
  // ещё жив и должен вернуться при переключении обратно). См. эффекты ниже.
  const lastNavTabRef = useRef<{ id: string; url: string } | undefined>(undefined);
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
  const toolbarRef = useRef<HTMLDivElement>(null);
  // «Таблетка» омнибокса (иконка+инпут+капсула/copy) — прямоугольник, под которым должен
  // вставать дропдаун подсказок. Пушится в main отдельным каналом (OMNIBOX_SET_BOUNDS) —
  // фундамент под будущую нативную вью дропдауна, сам дропдаун этот заход не трогает.
  const omniboxPillRef = useRef<HTMLDivElement>(null);
  const passwordControlRef = useRef<HTMLDivElement>(null);
  const vpnControlRef = useRef<HTMLDivElement>(null);
  const downloadsControlRef = useRef<HTMLDivElement>(null);
  const siteControlRef = useRef<HTMLButtonElement>(null);

  // Текущий выбранный поисковик — источник истины в main (SettingsManager); здесь только
  // читаем id и строим URL по общему шаблону (shared/searchEngines.ts), не хардкодим движок.
  const [searchEngineId, setSearchEngineId] = useState<SearchEngineId>(DEFAULT_SEARCH_ENGINE_ID);
  useEffect(() => {
    let mounted = true;
    window.oblako.getSearchEngine().then((id) => { if (mounted) setSearchEngineId(id); });
    // Тот же выбор есть в настройках («Браузер» → «Поиск по умолчанию»), а тулбар над открытыми
    // настройками остаётся на экране — без подписки капсула показывала бы прежний движок.
    const off = subscribeDefaultSearchEngine((id) => { if (mounted) setSearchEngineId(id); });
    return () => { mounted = false; off(); };
  }, []);

  // Капсула выбора поисковика — только на хабе (isHub), см. omnibox ниже.
  const [engineMenuOpen, setEngineMenuOpen] = useState(false);
  const engineBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!isHub) setEngineMenuOpen(false); }, [isHub]);

  const pickEngine = (id: SearchEngineId) => {
    setSearchEngineId(id);
    setEngineMenuOpen(false);
    setDefaultSearchEngine(id);
  };

  // Измеряем ширину тулбара для расчёта режима VPN и ширины омнибокса.
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const update = () => setToolbarWidth(el.offsetWidth);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, []);

  // Режим VPN-пилюли и ширина омнибокса вычисляются из ширины тулбара.
  // Омнибокс растёт по мере схлопывания VPN — центр не двигается (left:50%).
  const vpnMode: VpnMode = toolbarWidth >= VPN_THRESHOLD_FULL ? 'full'
    : toolbarWidth >= VPN_THRESHOLD_SHORT ? 'short'
    : 'icon';
  // Math.max(0, ...) — намеренно без нижнего предела: на совсем узком окне
  // омнибокс становится узким (до 0), но никогда не налезает на боковые блоки.
  const omniboxWidth = Math.min(620, Math.max(0, toolbarWidth - 2 * RIGHT_RESERVE[vpnMode] - 2 * OMNIBOX_SIDE_GAP));

  // Режим капсулы поисковика — см. константы выше. Приоритет у поля ввода:
  // капсула схлопывается первой, а не наоборот.
  const capsuleMode: CapsuleMode = omniboxWidth >= CAPSULE_FULL_THRESHOLD ? 'full'
    : omniboxWidth >= CAPSULE_HIDE_THRESHOLD ? 'compact'
    : 'hidden';

  // Пушим прямоугольник «таблетки» омнибокса в main (см. IPC.OMNIBOX_SET_BOUNDS) — координаты
  // окна, тот же getBoundingClientRect(), что и pushBounds в App.tsx для contentRef.
  // ResizeObserver ловит изменение РАЗМЕРА таблетки (ресайз окна, схлопывание VPN-пилюли — оба
  // меняют omniboxWidth и тем самым реальную ширину таблетки). Но НЕ ловит чистое смещение без
  // изменения размера: сворачивание сайдбара двигает тулбар по X (таблетка центрируется внутри
  // него), при этом её собственная ширина может в моменте не измениться — поэтому дублируем пуш
  // явным эффектом на toolbarWidth: он меняется во ВСЕХ трёх случаях (ресайз окна и сворачивание
  // сайдбара напрямую меняют ширину тулбара, порог VPN-пилюли — производная от неё же величина).
  // Единая точка пуша геометрии омнибокса. Мест вызова три, и они намеренно перекрываются (см.
  // комментарии рядом) — но перекрытие означало и дублирующий IPC: замер показал ровно два
  // одинаковых сообщения подряд на каждое изменение. Каждое такое сообщение в main двигает
  // WebContentsView дропдауна синхронно, поэтому отсекаем повтор здесь, а не считаем его дешёвым.
  // Сравнение с последним ОТПРАВЛЕННЫМ значением, не с текущим DOM: при перезагрузке чрома ref
  // обнулится и первый пуш уйдёт в любом случае.
  const lastOmniboxBoundsRef = useRef('');
  const pushOmniboxBounds = useCallback(() => {
    const el = omniboxPillRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const b = { x: r.left, y: r.top, width: r.width, height: r.height };
    const key = `${b.x},${b.y},${b.width},${b.height}`;
    if (key === lastOmniboxBoundsRef.current) return;
    lastOmniboxBoundsRef.current = key;
    void window.oblako.setOmniboxBounds(b);
  }, []);

  useEffect(() => {
    const el = omniboxPillRef.current;
    if (!el) return;
    pushOmniboxBounds();
    const ro = new ResizeObserver(pushOmniboxBounds);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pushOmniboxBounds]);

  useEffect(() => {
    pushOmniboxBounds();
  }, [toolbarWidth, pushOmniboxBounds]);

  // Гистерезис плейсхолдера: прячем когда поле узкое, возвращаем с запасом.
  useEffect(() => {
    if (omniboxWidth < PLACEHOLDER_HIDE_THRESHOLD) setPlaceholderVisible(false);
    else if (omniboxWidth >= PLACEHOLDER_SHOW_THRESHOLD) setPlaceholderVisible(true);
    // в зоне [200, 220) — не меняем, чтобы не мигало
  }, [omniboxWidth]);

  // Живой баг: переход из хаба создаёт НОВУЮ вкладку (хаб — фиксированный HUB_ID, не переиспользуется),
  // и у неё в первый момент url === '' (wc.getURL() до коммита навигации) — тот же пустой url, что
  // и у хаба. Раз значение строки ('' === '') не изменилось, эффект «реальная навигация», раньше
  // висевший отдельно на [tab?.url], НЕ срабатывал на само переключение и lastNavTabRef оставался
  // указывать на СТАРУЮ (хаб) вкладку. Когда чуть позже url реально приходил (тот же id, новый url),
  // это ошибочно классифицировалось как «другая вкладка» (сравнение шло со старым id) — и адрес так
  // и оставался пустым навсегда, до принудительного пересчёта переключением вкладок туда-обратно.
  // Единый эффект на [tab?.id, tab?.url] чинит это — lastNavTabRef обновляется на КАЖДЫЙ прогон,
  // включая сам момент переключения, поэтому последующий приход url всегда сверяется с АКТУАЛЬНЫМ id.
  useEffect(() => {
    if (!tab) return;
    const switchedTab = lastNavTabRef.current?.id !== tab.id;
    lastNavTabRef.current = { id: tab.id, url: tab.url };
    if (switchedTab) {
      // Переключение вкладки — поднимаем ЕЁ черновик, если печатали в ней раньше и не отправили,
      // иначе показываем её текущий url (может быть ещё пустым, если страница только начала
      // грузиться — эта же ветка при следующем реальном приходе url сама всё поправит, см. ниже).
      const draft = draftsRef.current.get(tab.id);
      setValue(draft !== undefined ? draft : tab.url);
      return;
    }
    // Та же вкладка — url изменился (реальная навигация либо url «доехал» уже после переключения
    // на ещё не догрузившуюся вкладку) — черновик неактуален. editing — защита от другого случая:
    // фоновая навигация той же вкладки не должна вырывать значение из-под рук, если человек как
    // раз печатает что-то новое поверх старого адреса.
    if (editing) return;
    draftsRef.current.delete(tab.id);
    setValue(tab.url);
  }, [tab?.id, tab?.url]);

  // Звезда «в закладках» — перепроверяем при каждой смене url активной вкладки. seq-ref —
  // тот же приём, что searchSeqRef в History.tsx: быстрое переключение вкладок не должно
  // позволить УСТАРЕВШЕМУ ответу isBookmarked(старый url) перезаписать состояние уже другой,
  // текущей вкладки.
  const bookmarkSeqRef = useRef(0);
  useEffect(() => {
    const url = !isHub ? tab?.url : undefined;
    const seq = ++bookmarkSeqRef.current;
    if (!url) { setBookmarked(false); return; }
    void window.oblako.isBookmarked(url).then((v) => {
      if (seq === bookmarkSeqRef.current) setBookmarked(v);
    });
  }, [isHub, tab?.url]);

  // Мутация где угодно (например, удалили закладку из панели закладок, пока эта же страница
  // ещё открыта в другой вкладке) — перепроверяем звезду ТЕКУЩЕЙ вкладки заново.
  useEffect(() => {
    return window.oblako.onBookmarksChanged(() => {
      const url = !isHub ? tab?.url : undefined;
      if (!url) return;
      const seq = ++bookmarkSeqRef.current;
      void window.oblako.isBookmarked(url).then((v) => {
        if (seq === bookmarkSeqRef.current) setBookmarked(v);
      });
    });
  }, [isHub, tab?.url]);

  // ⚠️ Звезда больше не ТУМБЛЕР. Прежнее поведение («нажал — сохранил в корень, нажал ещё —
  // удалил») не давало положить страницу в папку вовсе: единственным местом закладки был корень,
  // и разгребать его приходилось потом руками. Теперь клик сохраняет и сразу предлагает папку —
  // тем же меню, что и Ctrl+D. Удаление никуда не делось, оно последним пунктом того же меню.
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

  // Ref для closeDropdownFully — чтобы слушатель mousedown не пересоздавался при каждом изменении
  // колбэка, но всегда вызывал актуальную версию. Тот же приём, что pickSuggestionRef ниже.
  const closeDropdownFullyRef = useRef(closeDropdownFully);
  closeDropdownFullyRef.current = closeDropdownFully;

  const pushPasswordPopoverBounds = useCallback(() => {
    const el = passwordControlRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    void window.oblako.setPasswordPopoverAnchorBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, []);

  const togglePasswordPopover = useCallback(() => {
    if (!passwordIndicator) return;
    closeDropdownFully('password-indicator');
    if (passwordPopoverOpen) {
      setPasswordPopoverOpen(false);
      void window.oblako.closePasswordPopover();
      return;
    }
    pushPasswordPopoverBounds();
    setPasswordPopoverOpen(true);
    void window.oblako.showPasswordPopover(passwordIndicator);
  }, [closeDropdownFully, passwordIndicator, passwordPopoverOpen, pushPasswordPopoverBounds]);

  const pushVpnPopoverBounds = useCallback(() => {
    const el = vpnControlRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    void window.oblako.setVpnPopoverAnchorBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, []);

  const toggleVpnPopover = useCallback(() => {
    closeDropdownFully('vpn-indicator');
    if (passwordPopoverOpen) {
      setPasswordPopoverOpen(false);
      void window.oblako.closePasswordPopover();
    }
    if (vpnPopoverOpen) {
      setVpnPopoverOpen(false);
      void window.oblako.closeVpnPopover();
      return;
    }
    pushVpnPopoverBounds();
    setVpnPopoverOpen(true);
    // Домен активной вкладки — ДО showVpnPopover(), не после: адблок-секция поповера должна
    // увидеть актуальный URL уже к моменту первого показа (см. VpnPopoverManager.ts::lastActiveUrl).
    void window.oblako.setVpnPopoverActiveUrl(tab?.url ?? '');
    void window.oblako.showVpnPopover();
  }, [closeDropdownFully, passwordPopoverOpen, vpnPopoverOpen, pushVpnPopoverBounds, tab?.url]);

  const pushDownloadsPopoverBounds = useCallback(() => {
    const el = downloadsControlRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    void window.oblako.setDownloadsPopoverAnchorBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, []);

  const toggleDownloadsPopover = useCallback(() => {
    closeDropdownFully('downloads-button');
    // Двум поповерам в тулбаре одновременно места нет — открывая один, гасим соседей.
    if (passwordPopoverOpen) { setPasswordPopoverOpen(false); void window.oblako.closePasswordPopover(); }
    if (vpnPopoverOpen) { setVpnPopoverOpen(false); void window.oblako.closeVpnPopover(); }
    if (downloadsPopoverOpen) {
      setDownloadsPopoverOpen(false);
      void window.oblako.closeDownloadsPopover();
      return;
    }
    pushDownloadsPopoverBounds();
    setDownloadsPopoverOpen(true);
    void window.oblako.showDownloadsPopover();
  }, [closeDropdownFully, passwordPopoverOpen, vpnPopoverOpen, downloadsPopoverOpen, pushDownloadsPopoverBounds]);

  useEffect(() => window.oblako.onDownloadsPopoverClosed(() => setDownloadsPopoverOpen(false)), []);

  // Вопрос «этот файл уже скачан» — открываем поповер загрузок ровно тем же путём, что по клику
  // (с якорем и подсветкой кнопки). Сам вопрос уже лежит в main, карточка заберёт его сама.
  useEffect(() => window.oblako.onDownloadDuplicateAsk(() => {
    pushDownloadsPopoverBounds();
    setDownloadsPopoverOpen(true);
    void window.oblako.showDownloadsPopover();
  }), [pushDownloadsPopoverBounds]);

  // ── Поповер сведений о сайте (замочек слева в омнибоксе) ──────────────────────────────────
  // Раньше замок был просто картинкой. Теперь это точка входа в «что за сайт передо мной»:
  // защищено ли соединение, что ему разрешено, сколько вырезано трекеров и что похожего вы уже
  // читали. Механика ровно та же, что у поповеров VPN и загрузок — своя вью, якорь, клик мимо.
  const pushSitePopoverBounds = useCallback(() => {
    const el = siteControlRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    void window.oblako.setSitePopoverAnchorBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, []);

  const toggleSitePopover = useCallback(() => {
    closeDropdownFully('site-button');
    if (passwordPopoverOpen) { setPasswordPopoverOpen(false); void window.oblako.closePasswordPopover(); }
    if (vpnPopoverOpen) { setVpnPopoverOpen(false); void window.oblako.closeVpnPopover(); }
    if (downloadsPopoverOpen) { setDownloadsPopoverOpen(false); void window.oblako.closeDownloadsPopover(); }
    pushSitePopoverBounds();
    // Состояние приходит ответом самого toggle — второго источника правды не заводим.
    void window.oblako.toggleSitePopover().then(setSitePopoverOpen);
  }, [closeDropdownFully, passwordPopoverOpen, vpnPopoverOpen, downloadsPopoverOpen, pushSitePopoverBounds]);

  useEffect(() => window.oblako.onSitePopoverClosed(() => setSitePopoverOpen(false)), []);

  useEffect(() => {
    if (!sitePopoverOpen) return;
    pushSitePopoverBounds();
    const el = siteControlRef.current;
    if (!el) return;
    const ro = new ResizeObserver(pushSitePopoverBounds);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sitePopoverOpen, toolbarWidth, pushSitePopoverBounds]);

  useEffect(() => {
    if (!sitePopoverOpen) return;
    const onOutsideMouseDown = (e: MouseEvent) => {
      if (!siteControlRef.current?.contains(e.target as Node)) {
        setSitePopoverOpen(false);
        void window.oblako.toggleSitePopover();
      }
    };
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    return () => document.removeEventListener('mousedown', onOutsideMouseDown, true);
  }, [sitePopoverOpen]);

  useEffect(() => {
    if (!downloadsPopoverOpen) return;
    pushDownloadsPopoverBounds();
    const el = downloadsControlRef.current;
    if (!el) return;
    const ro = new ResizeObserver(pushDownloadsPopoverBounds);
    ro.observe(el);
    return () => ro.disconnect();
  }, [downloadsPopoverOpen, toolbarWidth, pushDownloadsPopoverBounds]);

  useEffect(() => {
    if (!downloadsPopoverOpen) return;
    const onOutsideMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!downloadsControlRef.current?.contains(target)) {
        setDownloadsPopoverOpen(false);
        void window.oblako.closeDownloadsPopover();
      }
    };
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    return () => document.removeEventListener('mousedown', onOutsideMouseDown, true);
  }, [downloadsPopoverOpen]);

  // Навигация в ТОЙ ЖЕ вкладке, пока поповер уже открыт (смена самой вкладки поповер закрывает
  // целиком, см. эффект по tab?.id ниже) — адблок-секция должна обновиться на новый домен, а не
  // показывать whitelist-статус/счётчик страницы, с которой уже ушли.
  useEffect(() => {
    if (!vpnPopoverOpen) return;
    void window.oblako.setVpnPopoverActiveUrl(tab?.url ?? '');
  }, [vpnPopoverOpen, tab?.url]);

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

  useEffect(() => {
    return window.oblako.onPasswordIndicatorChanged((state) => {
      setPasswordIndicator(state);
      if (!state) {
        setPasswordPopoverOpen(false);
        void window.oblako.closePasswordPopover();
      }
    });
  }, []);

  useEffect(() => window.oblako.onPasswordPopoverClosed(() => setPasswordPopoverOpen(false)), []);
  useEffect(() => window.oblako.onVpnPopoverClosed(() => setVpnPopoverOpen(false)), []);

  useEffect(() => {
    if (!passwordPopoverOpen) return;
    pushPasswordPopoverBounds();
    if (passwordIndicator) void window.oblako.showPasswordPopover(passwordIndicator);
    const el = passwordControlRef.current;
    if (!el) return;
    const ro = new ResizeObserver(pushPasswordPopoverBounds);
    ro.observe(el);
    return () => ro.disconnect();
  }, [passwordPopoverOpen, passwordIndicator, toolbarWidth, pushPasswordPopoverBounds]);

  useEffect(() => {
    if (!passwordPopoverOpen) return;
    const onOutsideMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!passwordControlRef.current?.contains(target)) {
        setPasswordPopoverOpen(false);
        void window.oblako.closePasswordPopover();
      }
    };
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    return () => document.removeEventListener('mousedown', onOutsideMouseDown, true);
  }, [passwordPopoverOpen]);

  useEffect(() => {
    if (!vpnPopoverOpen) return;
    pushVpnPopoverBounds();
    const el = vpnControlRef.current;
    if (!el) return;
    const ro = new ResizeObserver(pushVpnPopoverBounds);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vpnPopoverOpen, toolbarWidth, pushVpnPopoverBounds]);

  useEffect(() => {
    if (!vpnPopoverOpen) return;
    const onOutsideMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!vpnControlRef.current?.contains(target)) {
        setVpnPopoverOpen(false);
        void window.oblako.closeVpnPopover();
      }
    };
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    return () => document.removeEventListener('mousedown', onOutsideMouseDown, true);
  }, [vpnPopoverOpen]);

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
    if (passwordPopoverOpen) {
      setPasswordPopoverOpen(false);
      void window.oblako.closePasswordPopover();
    }
    if (vpnPopoverOpen) {
      setVpnPopoverOpen(false);
      void window.oblako.closeVpnPopover();
    }
    if (downloadsPopoverOpen) {
      setDownloadsPopoverOpen(false);
      void window.oblako.closeDownloadsPopover();
    }
  }, [tab?.id]);

  const buildSuggestions = useCallback(async (query: string, seq: number) => {
    if (!query.trim()) { closeDropdown('empty-query'); return; }
    const q = query.toLowerCase();

    // Заход 10: история и живые suggest-подсказки — параллельно, каждая изолирована через
    // Promise.allSettled (не Promise.all — сбой ОДНОЙ не должен обрушить ДРУГУЮ). fetchSuggestions
    // сама по себе никогда не бросает (см. SearchSuggestFetcher.ts — любая ошибка/таймаут/отмена
    // ловится там и превращается в []), но изоляция здесь дублируется намеренно: buildSuggestions
    // не должен зависеть от внутренней гарантии другого модуля, чтобы сбой suggest-API НИ ПРИ
    // КАКИХ обстоятельствах не уронил историю/вкладки.
    let histEntries: HistoryEntry[] = [];
    let suggestPhrases: string[] = [];
    const [histResult, suggestResult] = await Promise.allSettled([
      window.oblako.searchHistory(query),
      window.oblako.fetchSuggestions(query),
    ]);
    if (histResult.status === 'fulfilled') histEntries = histResult.value;
    if (suggestResult.status === 'fulfilled') suggestPhrases = suggestResult.value;
    if (seq !== suggestSeqRef.current) return;

    const now = Date.now();

    // Открытые вкладки — по нормализованному URL (не substring по url/title). Точный матч:
    // подсказка помечается kind='tab' только если её URL совпадает с URL реально открытой
    // вкладки — раньше widely-substring-матч по allTabs ловил произвольные вкладки (в т.ч.
    // поисковые result-страницы), из-за чего они подписывались «вкладка» независимо от
    // релевантности запросу.
    const tabIdByUrl = new Map<string, string>();
    for (const t of allTabs) {
      if (!t.isHub) tabIdByUrl.set(normalizeForOmnibox(t.url), t.id);
    }

    // Дедуп по нормализованному URL — одна запись на СТРАНИЦУ (не на домен, как раньше через
    // normalizeForTiles/origin). utm-параметры/якорь/завершающий слэш схлопываются в один ключ
    // (см. normalizeForOmnibox) — это убирает 5-6 «копий» одной и той же страницы, которые
    // history.sqlite хранит отдельными строками (там UNIQUE по точному URL, см. HistoryManager.ts).
    // Разные СТРАНИЦЫ одного домена (не дубли) по-прежнему остаются разными записями — их
    // взаимный порядок решает ранжирование ниже (homepage поднимается при прочих равных).
    const byUrl = new Map<string, HistoryEntry>();
    for (const e of histEntries) {
      const key = normalizeForOmnibox(e.url);
      const cur = byUrl.get(key);
      if (!cur || scoreEntry(e, now) > scoreEntry(cur, now)) byUrl.set(key, e);
    }

    // Матч «на границе слова» — то же, что делают HistoryQuickProvider в Chromium и
    // location-bar в Firefox (bugzilla #393678/#429531): вхождение ПОСРЕДИ слова (например «ko»
    // внутри «drugih» в транслитерированном пути) почти всегда СЛУЧАЙНО совпадает с запросом и
    // не значит ничего для пользователя — особенно на коротких (2-3 симв.) запросах против
    // транслитерированных кириллических путей. Вхождение В НАЧАЛЕ слова (kod.ru, /kotipizza) —
    // обычно и есть то, что имел в виду пользователь. Оба браузера показывают «где угодно»-
    // совпадения ТОЛЬКО как самый нижний фоллбэк — см. ту же идею ниже в calcMatchScore (tier 1).
    function matchesAtWordBoundary(haystack: string, needle: string): boolean {
      let idx = haystack.indexOf(needle);
      while (idx !== -1) {
        const prev = idx === 0 ? '' : haystack[idx - 1]!;
        if (!/[a-z0-9а-яё]/i.test(prev)) return true;
        idx = haystack.indexOf(needle, idx + 1);
      }
      return false;
    }

    // Живой тест на «ko» показал: граница слова САМА ПО СЕБЕ не спасает от мусора — URL-слаги
    // русскоязычных сайтов это транслитерация кириллицы (rossiyskih-KOmand, KOtoryh, KOgda...),
    // и короткий запрос — это ровно начало кучи бытовых русских слов-транслитераций, так что
    // «в начале слова» массово совпадает, просто не показывая, что для пользователя оно значит.
    // Домен/заголовок — курируемый текст (реальное имя сайта/статьи), а путь — машинный SEO-слаг,
    // поэтому именно путь режем по длине запроса: короче порога — в пути вообще не ищем, отдаём
    // площадь только домену/заголовку (которые остаются достаточно избирательны и на 2-3 символах).
    const MIN_PATH_MATCH_LEN = 4;
    // Верхний тир calcMatchScore — «запрос выглядит как имя домена целиком». Вынесен в константу,
    // т.к. используется ещё раз ниже (см. синтез домашней страницы у byHost) — держать оба места
    // в синхроне важнее, чем инлайнить магическое число дважды.
    const HOSTNAME_PREFIX_TIER = 6;

    // Match-score: тип совпадения — главный сортировщик, frecency — вторичный.
    // query/hash-параметры намеренно исключены: они источник ложных хитов
    // (e.g. «the» в ?q=... подтягивает нерелевантные страницы).
    function calcMatchScore(e: HistoryEntry): number {
      let hostname = '';
      let pathname = '';
      try {
        const u = new URL(e.url);
        hostname = u.hostname.replace(/^www\./, '').toLowerCase();
        pathname = u.pathname.toLowerCase();
      } catch { /* невалидный URL */ }
      const title = e.title.toLowerCase();
      const pathLongEnough = q.length >= MIN_PATH_MATCH_LEN;
      if (hostname.startsWith(q))              return HOSTNAME_PREFIX_TIER; // префикс домена → максимум
      if (title.startsWith(q))                 return 5; // префикс заголовка
      if (matchesAtWordBoundary(hostname, q) || matchesAtWordBoundary(title, q)) return 4; // слово в домене/заголовке
      if (pathLongEnough && matchesAtWordBoundary(pathname, q)) return 3; // слово в пути
      // Живой фидбэк («пусть меньше, но качественнее»): раньше здесь был ещё фоллбэк —
      // вхождение ГДЕ УГОДНО (в т.ч. посреди слова, без границы). Он и давал мусор вроде страниц
      // логина/авторизации и случайных фото из истории — их заголовки/hostname часто СОДЕРЖАТ
      // запрос как случайную подстроку (например «the» внутри «auTHEntication»), не имея к нему
      // никакого смыслового отношения. Без него страница либо совпадает по-настоящему (домен/
      // заголовок/путь на границе слова), либо не показывается вообще — короче список, но каждая
      // строка в нём объяснима.
      return 0; // вообще ничего не совпало — отфильтровываем
    }

    // Итоговый скор: ×10000 за тип совпадения даёт ему абсолютный приоритет над частотой.
    const MATCH_TIER = 10_000;
    // При прочих равных (тот же match-tier, тот же домен) — главная страница домена выше
    // вглубь-страниц того же домена, как в Chrome (example.com над example.com/article/123).
    // Множитель на freq, не плоская добавка — масштабируется вместе с реальной частотой визитов,
    // а не перевешивает её произвольной константой.
    const HOMEPAGE_BOOST = 1.5;
    function isHomepage(url: string): boolean {
      try { return new URL(url).pathname === '/'; } catch { return false; }
    }
    function hostnameOf(url: string): string {
      try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return url; }
    }

    // Единый ранжированный список — history и «вкладка» больше не строятся отдельно
    // (tabItems раньше шли ПЕРВЫМИ безусловно, до среза по SUGGEST_MAX, вытесняя
    // отранжированные по frecency записи истории независимо от их релевантности).
    const candidates = [...byUrl.entries()]
      .map(([key, e]) => ({
        e,
        match: calcMatchScore(e),
        freq: scoreEntry(e, now) * (isHomepage(e.url) ? HOMEPAGE_BOOST : 1),
        tabId: tabIdByUrl.get(key),
      }))
      .filter(({ match }) => match > 0);

    // Представитель домена (MAX_PER_HOSTNAME=1) — НЕ «первый после сортировки по скору»: живой
    // баг показал, что недавняя (сегодняшняя) статья почти всегда обгоняет главную страницу по
    // frecency (вес свежести ×4 против HOMEPAGE_BOOST ×1.5 — буст просто не отбивает разницу
    // бакетов), поэтому кап раньше исправно резал дубли, но оставлял вместо чистой guardian.com
    // случайную длинную статью. Матч по префиксу домена (tier 6, calcMatchScore) означает «это
    // про сайт целиком» — поэтому здесь представитель домена явно предпочитает главную страницу,
    // если она вообще есть среди совпавших кандидатов, и только при её отсутствии откатывается
    // на лучший по скору.
    const byHost = new Map<string, typeof candidates[number]>();
    for (const c of candidates) {
      const host = hostnameOf(c.e.url);
      const existing = byHost.get(host);
      if (!existing) { byHost.set(host, c); continue; }
      const cHome = isHomepage(c.e.url);
      const existingHome = isHomepage(existing.e.url);
      if (cHome && !existingHome) { byHost.set(host, c); continue; }
      if (!cHome && existingHome) continue;
      const cScore = c.match * MATCH_TIER + c.freq;
      const existingScore = existing.match * MATCH_TIER + existing.freq;
      if (cScore > existingScore) byHost.set(host, c);
    }

    // Живой тест на «the»: у Guardian реальная главная НИ РАЗУ не посещалась (только статьи) —
    // отбор выше честно откатывается на лучшую статью, но это по-прежнему случайная длинная
    // ссылка вместо чистого сайта. Матч tier 6 (calcMatchScore) означает «запрос похож на ИМЯ
    // САЙТА целиком», а не на конкретную статью — раз хомпейджа нет в истории, достраиваем его
    // адрес сами (тот же приём, что HistoryURLProvider в Chromium: инференс канонической ссылки
    // на сайт из одной только уверенности в домене, без обязательного точного визита на root).
    // Открытые вкладки (tabId) не трогаем — там клик всё равно ведёт по tabId, а не по url, но
    // подмена урла/тайтла исказила бы то, что реально показано во вкладке.
    for (const [host, c] of byHost) {
      if (c.tabId || c.match !== HOSTNAME_PREFIX_TIER || isHomepage(c.e.url)) continue;
      let root: string;
      try { root = `${new URL(c.e.url).protocol}//${host}/`; } catch { continue; }
      byHost.set(host, { ...c, e: { ...c.e, url: root, title: '' } });
    }

    const items: SuggestItem[] = [...byHost.values()]
      .sort((a, b) => (b.match * MATCH_TIER + b.freq) - (a.match * MATCH_TIER + a.freq))
      .slice(0, SUGGEST_MAX - 1)
      .map(({ e, tabId }) => (
        tabId
          ? { kind: 'tab' as SuggestKind, label: e.url, sub: e.title, url: e.url, tabId }
          : { kind: 'history' as SuggestKind, label: e.url, sub: e.title, url: e.url }
      ));

    // Живые веб-подсказки — ОТДЕЛЬНОЙ группой НИЖЕ истории/вкладок (точных совпадений), как в
    // Chrome: сначала твоё, потом веб-автодополнение. Не участвуют в frecency-ранжировании items
    // (это не посещённые страницы) — порядок такой, какой вернул сам suggest-API движка.
    // Фраза, совпадающая с самим введённым текстом, отфильтровывается — её уже покрывает searchItem.
    const suggestItems: SuggestItem[] = suggestPhrases
      .filter((phrase) => phrase.trim().toLowerCase() !== q)
      .map((phrase) => ({
        kind: 'suggest' as SuggestKind,
        label: phrase,
        url: getSearchEngine(searchEngineId).buildUrl(phrase),
      }));

    const searchItem: SuggestItem = {
      kind: 'search',
      label: `Искать: ${query}`,
      url: getSearchEngine(searchEngineId).buildUrl(query),
    };

    // Порядок секций — по образцу Яндекс.Браузера (см. живое сравнение): самый релевантный
    // результат наверху, СРАЗУ за ним — «искать в вебе» (это всегда доступный, надёжный
    // вариант, не обязательно ждать, пока пользователь долистает всю историю до него), и только
    // потом — остальные, менее уверенные совпадения из истории/вкладок и живые веб-подсказки
    // (те — с самым слабым сигналом, значение не привязано к посещённым страницам вообще).
    // ── Открытые вкладки, которых нет в истории ──────────────────────────────────────────────
    // ⚠️ Выше вкладка попадала в подсказки, ТОЛЬКО если её адрес нашёлся в истории (tabIdByUrl
    // навешивает пометку на запись истории). Открытая пять минут назад страница, до которой
    // frecency ещё не дорос, не показывалась вовсе — а именно её и ищут чаще всего.
    // Совпадение считаем сами, тем же правилом границы слова, что и для истории.
    const alreadyShown = new Set(items.map((i) => i.tabId).filter(Boolean));
    const liveTabItems: SuggestItem[] = allTabs
      .filter((t) => !t.isHub && !alreadyShown.has(t.id))
      .filter((t) => {
        const host = hostnameOf(t.url);
        const title = (t.title || '').toLowerCase();
        return host.startsWith(q) || title.startsWith(q)
          || matchesAtWordBoundary(host, q) || matchesAtWordBoundary(title, q);
      })
      .slice(0, 3)
      .map((t) => ({ kind: 'tab' as SuggestKind, label: t.url, sub: t.title, url: t.url, tabId: t.id }));

    const [topItem, ...restItems] = [...items, ...liveTabItems];
    // Подписи секций — по образцу Safari («Предложения Google» / «Закладки и история»), см. живое
    // сравнение. У героя (topItem) своей подписи нет — он и так визуально выделен отдельной
    // карточкой (RowIcon/hero-стиль в suggestdropdown.tsx), подпись над одной строкой была бы
    // лишним шумом. Ставим ТОЛЬКО на первый элемент каждой группы — вью просто рисует то, что
    // получила, сама ничего не группирует (см. комментарий у sectionHeader в shared/ipc.ts).
    if (restItems[0]) restItems[0] = { ...restItems[0], sectionHeader: 'История и вкладки' };
    if (suggestItems[0]) {
      suggestItems[0] = { ...suggestItems[0], sectionHeader: `Предложения ${getSearchEngine(searchEngineId).name}` };
    }
    const deduped = topItem
      ? [topItem, searchItem, ...restItems, ...suggestItems]
      : [searchItem, ...suggestItems];
    if (seq !== suggestSeqRef.current) return;
    setSuggestions(deduped);
    // ⚠️ Enter должен вести на ПЕРВУЮ строку, а не на набранные 2-4 символа — но только когда
    // первая строка это «герой» (лучшее совпадение из истории/вкладок). Жалоба была именно про
    // это: подсказка та самая, а Enter уходит на огрызок текста.
    //
    // ⚠️ Слепо выделять строку 0 НЕЛЬЗЯ. Без героя первой идёт searchItem («Искать: …»), и тогда
    // набранный адрес github.com ушёл бы В ПОИСК вместо перехода: разбор адреса живёт в
    // TabManager.resolveInput (схемы, хосты, бэнги), а сюда доезжает только готовая строка поиска.
    //
    // ⚠️ И даже с героем выделяем не всегда: если набранное похоже на адрес, «лучшее совпадение»
    // может оказаться ДРУГОЙ страницей того же сайта, и Enter увёл бы не туда. Признак нарочно
    // грубый и в спорную сторону — есть точка или схема, значит считаем адресом и оставляем
    // прежнее поведение. Дублировать здесь разбор resolveInput нельзя: две копии правил разъедутся
    // молча (в этом файле такое уже было с перечнем разделов настроек).
    const looksLikeAddress = /[.:]/.test(query.trim());
    const preselect = topItem && !looksLikeAddress ? 0 : -1;
    setSelectedIdx(preselect);
    openDropdown();
    // Тот же список — дополнительно в нативную вью дропдауна (заход 3/5, параллельно старому
    // React-дропдауну выше). Формирование списка (история/вкладки/frecency/дедуп) не меняется —
    // только эта отправка добавлена.
    void window.oblako.setSuggestDropdownItems(deduped);
    // Новый список — подсветку во вью выставляем синхронно с selectedIdx выше (заход 4/5):
    // иначе вью подсвечивала бы строку, которой уже нет/сместилась. Теперь тем же значением
    // едет и предвыбор героя — человек обязан ВИДЕТЬ, куда уйдёт Enter, иначе это фокус с
    // непредсказуемым исходом.
    void window.oblako.setSuggestDropdownHighlight(preselect);

    // ── Второй эшелон: вкладка ПО СМЫСЛУ (локальная модель, см. electron/TabSearch.ts) ────────
    //
    // ⚠️ Условия намеренно узкие, и каждое — про цену. Очередь генерации в проекте одна и общая,
    // прервать начатую генерацию node-llama-cpp не даёт, поэтому спрашивать модель на каждую
    // букву нельзя: она заняла бы себя устаревшими запросами, а человек ждал бы перевод.
    //  • ничего не нашлось обычным способом — иначе модель решает уже решённое;
    //  • запрос похож на ОПИСАНИЕ (есть пробел, от 6 символов), а не на начало адреса;
    //  • вкладок достаточно, чтобы их не было видно глазами.
    // Результат приезжает отдельным обновлением списка: ждать модель, ничего не показывая, нельзя.
    const hasTabHit = deduped.some((i) => i.kind === 'tab');
    if (!hasTabHit && q.includes(' ') && q.length >= 6 && allTabs.length >= 5) {
      const smartIds = await window.oblako.searchTabsSmart(query).catch(() => [] as string[]);
      if (seq !== suggestSeqRef.current || smartIds.length === 0) return;
      const byId = new Map(allTabs.map((t) => [t.id, t]));
      const smartItems: SuggestItem[] = smartIds
        .map((id) => byId.get(id))
        .filter((t): t is NonNullable<typeof t> => !!t)
        .map((t, idx) => ({
          kind: 'tab' as SuggestKind,
          label: t.url,
          sub: t.title,
          url: t.url,
          tabId: t.id,
          // Подпись честная: человек должен понимать, что эти строки нашлись НЕ по совпадению
          // слов, а моделью, — иначе они выглядят как случайные (слов запроса в них нет).
          ...(idx === 0 ? { sectionHeader: 'Вкладки по смыслу' } : {}),
        }));
      if (smartItems.length === 0) return;
      const withSmart = [...deduped, ...smartItems];
      setSuggestions(withSmart);
      void window.oblako.setSuggestDropdownItems(withSmart);
    }
  }, [allTabs, openDropdown, closeDropdown, searchEngineId]);

  // ⚠️ «Вы это уже читали» жило здесь и переехало в поповер замочка (SitePopoverManager.ts).
  // Причина — в омнибоксе оказались ДВЕ фоновые AI-функции сразу, и они мешали друг другу:
  // связанные страницы стартовали по клику в строку, поиск вкладки по смыслу — при наборе, а
  // модель, очередь и невозможность прервать генерацию у них общие. Подробности в onFocus ниже.

  const triggerSuggest = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { closeDropdown('empty-query-trigger'); return; }
    const seq = ++suggestSeqRef.current;
    debounceRef.current = setTimeout(() => { void buildSuggestions(q, seq); }, SUGGEST_DEBOUNCE);
  }, [buildSuggestions, closeDropdown]);

  const submit = (input: string) => {
    const v = input.trim();
    if (!v) return;
    onSubmit(v);
    inputRef.current?.blur();
    closeDropdownFully('submit');
    setValue(v);
    // Реальная навигация — черновик этой вкладки отправлен, хранить нечего (на случай, если
    // url ещё не успел обновиться в проп tab — эффект на tab?.url ниже подчистил бы его и сам,
    // но не сразу, а после того как навигация реально произойдёт).
    if (tab) draftsRef.current.delete(tab.id);
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
      void window.oblako.activateTab(item.tabId);
      closeDropdownFully('pick-tab');
    } else {
      submit(item.url);
    }
  };

  // Клик по строке ВО вью нативного дропдауна (другой webContents, заход 3/5) — main пересылает
  // выбор сюда, вызываем тот же pickSuggestion(), что и старый chrome-DOM дропдаун (не дублируем
  // его поведение). Ref — чтобы не пересобирать подписку на каждый рендер (pickSuggestion не
  // мемоизирована), тот же приём, что isHubRef/findOpenRef в App.tsx.
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
        if (tab) draftsRef.current.delete(tab.id);
        setValue(isHub ? '' : (tab?.url ?? ''));
        inputRef.current?.blur();
        closeDropdownFully('escape-clear');
      }
    }
  };

  return (
    <div
      ref={toolbarRef}
      className="drag"
      style={{
        // alignItems:'flex-start' + paddingTop:--gutter-shell — верхняя кромка плашек-островов
        // совпадает с верхней кромкой сайдбара-острова (тот же токен воздуха). Высота контейнера
        // (TOOLBAR_HEIGHT) не меняется — плашки просто прижаты к верху вместо центрирования.
        display: 'flex', alignItems: 'flex-start', gap: 10, height: TOOLBAR_HEIGHT, flex: 'none',
        paddingLeft: 16, paddingRight: 138, paddingTop: 'var(--gutter-shell)',
        position: 'relative',
      }}
    >
      {/* Кнопки навигации — парящая плашка-остров (glass/тень/скругление из поповера/AI-панели).
          Вписана в текущую высоту тулбара: паддинг плашки не увеличивает высоту кнопок. */}
      <div className="no-drag" style={{ ...islandPlate, display: 'flex', gap: 2, padding: 3, borderRadius: 'var(--radius-card)' }}>
        <button title="Назад" disabled={!tab?.canGoBack} onClick={onBack}
          style={navBtn(!tab?.canGoBack)}><ArrowLeft size={18} /></button>
        <button title="Вперёд" disabled={!tab?.canGoForward} onClick={onForward}
          style={navBtn(!tab?.canGoForward)}><ArrowRight size={18} /></button>
        <button title="Обновить" disabled={isHub} onClick={onReload}
          style={navBtn(isHub)}><RefreshCw size={17} /></button>
      </div>

      {/* Омнибокс: абсолютно по центру колонки (left:50%).
          Ширина растёт при схлопывании VPN — центральная ось неподвижна.
          pointer-events:none на внешней обёртке — боковые кнопки кликабельны насквозь. */}
      <div style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        // top сдвинут на --gutter-shell + flex-start — та же верхняя кромка, что и у
        // остальных плашек тулбара (омнибокс абсолютно спозиционирован и не участвует
        // в общем flex-потоке, поэтому выравнивается отдельно тем же токеном).
        top: 'var(--gutter-shell)', bottom: 0,
        display: 'flex', alignItems: 'flex-start',
        width: omniboxWidth,
        pointerEvents: 'none',
      }}>
        <div
          className="no-drag"
          style={{ width: '100%', position: 'relative', pointerEvents: 'auto' }}
        >
          <div ref={omniboxPillRef} style={{
            ...islandPlate,
            display: 'flex', alignItems: 'center', gap: 8, height: 38,
            padding: '0 12px', borderRadius: 'var(--radius-pill)',
          }}>
            {/* ⚠️ Замок — КНОПКА, а не украшение: по нему открывается карточка сайта (соединение,
                разрешения, заблокированные трекеры, «вы это уже читали» — см. SitePopoverManager.ts).
                На хабе и в приватной вкладке остаётся прежний неактивный значок: там нет сайта,
                про который можно что-то рассказать. */}
            {tab?.incognito || isHub || !tab?.url ? (
              <span style={{ color: tab?.incognito ? 'var(--text-body)' : 'var(--text-faint)', display: 'inline-flex' }}
                title={tab?.incognito ? 'Приватная вкладка' : undefined}>
                {tab?.incognito ? <VenetianMask size={14} /> : isHub ? <Search size={15} /> : <Lock size={14} />}
              </span>
            ) : (
              <button
                ref={siteControlRef}
                title="Сведения о сайте"
                onClick={toggleSitePopover}
                style={{
                  border: 'none', background: sitePopoverOpen ? 'var(--accent-soft)' : 'transparent',
                  cursor: 'default', padding: 3, borderRadius: 'var(--radius-sm)',
                  display: 'inline-flex', flex: 'none',
                  color: sitePopoverOpen ? 'var(--accent)' : 'var(--text-faint)',
                }}
              >
                <Lock size={14} />
              </button>
            )}
            <input
              ref={inputRef}
              value={value}
              placeholder={placeholderVisible ? 'Введите запрос или адрес' : ''}
              onChange={(e) => {
                const v = e.target.value;
                setValue(v);
                if (tab) draftsRef.current.set(tab.id, v);
                triggerSuggest(v);
              }}
              onMouseDown={(e) => {
                focusTracker.current.mouseDownOnInput = true;
                // Самосброс через RAF — если фокус НЕ сменился (клик в уже сфокусированное
                // поле, просто переставить курсор), onFocus не вызовется вообще и не консьюмит
                // флаг сам; без этого он завис бы «true» до следующего, уже НЕ обязательно
                // настоящего, focus-события.
                requestAnimationFrame(() => {
                  focusTracker.current.mouseDownOnInput = false;
                });
                // Выделение всего текста по клику — как в любом адресном поле. Только на ПЕРВОМ
                // клике, переводящем фокус в поле — иначе повторный клик по уже сфокусированному
                // полю не смог бы просто переставить курсор. preventDefault обязателен: браузер
                // иначе сам расставит курсор по месту клика на mouseup ПОСЛЕ нашего select() и
                // сотрёт выделение.
                if (!focusTracker.current.isRealFocus) {
                  e.preventDefault();
                  inputRef.current?.focus();
                  inputRef.current?.select();
                } else if (document.activeElement !== inputRef.current) {
                  // Повторный клик, но DOM-фокус фактически потерян. Ветка выше сюда не заходит
                  // (isRealFocus уже true), а полагаться на нативную фокусировку нельзя: пока
                  // открыт дропдаун, чром может не иметь OS-фокуса — тогда браузер выставит
                  // activeElement, но клавиши всё равно уйдут в другую вью. Возвращаем фокус явно
                  // и БЕЗ select(): повторный клик обязан просто ставить курсор, не выделять всё.
                  inputRef.current?.focus();
                }
                // Дропдаун подсказок — отдельная WebContentsView; её addChildView уводит OS-фокус
                // с чрома, а компенсация в main срабатывает только в МОМЕНТ открытия (см.
                // main.ts::SUGGEST_DROPDOWN_TOGGLE). Клик по инпуту при уже открытом дропдауне
                // компенсации не получал — отсюда «поле не активно, текст не дописать» после
                // навигации стрелками. Возвращаем OS-фокус явно; вызов идемпотентный.
                if (dropdownOpen) void window.oblako.focusChrome();
                focusTracker.current.isRealFocus = true;
              }}
              onFocus={() => {
                setEditing(true);
                // Реальный клик — mouseDownOnInput успел взвестись только что (onMouseDown на ЭТОМ
                // же инпуте синхронно предшествует onFocus). Спонтанный refocus (removeChildView
                // возвращает OS-фокус обратно на инпут) этого сигнала не имеет — дропдаун не
                // переоткрываем.
                // ⚠️ «Вы это уже читали» отсюда УБРАНО и переехало в поповер замочка
                // (SitePopoverManager.ts). Причина не в самой подсказке, а в том, что в омнибоксе
                // оказались ДВЕ фоновые AI-функции сразу: связанные страницы по клику и поиск
                // вкладки по смыслу при наборе. Модель одна, очередь на приложение одна, прервать
                // начатую генерацию нельзя — клик в строку занимал её ровно в тот момент, когда
                // человек начинал печатать, и второй подсказке доставались объедки. Теперь в
                // омнибоксе одна AI-функция, а связанные страницы открываются отдельным
                // осознанным действием, когда никто ничего не набирает.
                if (focusTracker.current.mouseDownOnInput && value.trim()) triggerSuggest(value);
                // Синхронный консюм флага после использования (как в исходной версии) — RAF-автосброс
                // из onMouseDown сработает только к следующему кадру, а спонтанный refocus от
                // removeChildView может прилететь раньше и увидеть залипший true.
                focusTracker.current.mouseDownOnInput = false;
              }}
              // ⚠️ Намеренно БЕЗ onBlur. blur — не триггер закрытия дропдауна ни в каком виде (см.
              // «Заход 5» выше — независимые сигналы вместо него). Раньше отсюда же сбрасывался
              // editing по любому blur — теперь это делают те же явные сигналы (клик мимо/фокус на
              // контент/смена вкладки), Esc и submit() сбрасывают editing отдельно, как и раньше.
              onKeyDown={handleKeyDown}
              style={{
                flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none',
                fontSize: 'var(--fs-sm)', color: 'var(--text-strong)',
                // Брендовый Golos и для адреса тоже. Моноширинный тут стоял ради ровных
                // символов URL, но выбивался из всего остального интерфейса — а адрес человек
                // читает как текст, а не как код.
                fontFamily: 'var(--font-sans)',
              }}
            />
            {!isHub && tab?.url && (
              passwordIndicator && (
                <div ref={passwordControlRef} style={{ display: 'inline-flex', flex: 'none' }}>
                  <button
                    title="Пароли"
                    onClick={togglePasswordPopover}
                    style={{
                      border: 'none', background: passwordPopoverOpen ? 'var(--accent-soft)' : 'transparent',
                      cursor: 'default', padding: 3, borderRadius: 'var(--radius-sm)',
                      display: 'inline-flex',
                      color: passwordPopoverOpen ? 'var(--accent)' : 'var(--text-muted)',
                      position: 'relative',
                    }}
                  >
                    <KeyRound size={14} />
                  </button>
                </div>
              )
            )}
            {!isHub && tab?.url && (
              <button title="Копировать адрес" onClick={copyUrl}
                style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 3,
                         display: 'inline-flex', color: copied ? 'var(--dot-local)' : 'var(--text-faint)' }}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            )}
            {!isHub && tab?.url && (
              <button title={bookmarked ? 'Удалить из закладок' : 'Добавить в закладки'}
                onClick={toggleBookmark}
                style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 3,
                         display: 'inline-flex', color: bookmarked ? 'var(--accent)' : 'var(--text-muted)' }}>
                <Star size={14} fill={bookmarked ? 'var(--accent)' : 'none'} />
              </button>
            )}
            {/* Капсула выбора поисковика — только на хабе, в контентных вкладках не рендерится вовсе.
                Схлопывается по тому же принципу, что VPN-пилюля (см. capsuleMode выше): на дефолтном
                окне омнибокс уже узкий (VPN-режим 'short' даёт ~278px) — полное имя туда не влезает
                и вылезает за скруглённый край пилюли, поэтому ниже CAPSULE_FULL_THRESHOLD показываем
                только первую букву названия. */}
            {isHub && capsuleMode !== 'hidden' && (
              <button
                ref={engineBtnRef}
                title={`Поисковик: ${getSearchEngine(searchEngineId).name}`}
                onClick={() => setEngineMenuOpen((v) => !v)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none',
                  border: 'none', cursor: 'default', padding: capsuleMode === 'full' ? '4px 8px' : '4px 6px',
                  borderRadius: 'var(--radius-sm)', background: 'var(--surface-hover)',
                  color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {capsuleMode === 'full'
                  ? getSearchEngine(searchEngineId).name
                  : getSearchEngine(searchEngineId).name.charAt(0)}
                <ChevronDown size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Меню выбора поисковика — портал в body (та же техника, что у дропдауна подсказок),
            прозрачный оверлей на весь экран закрывает по клику мимо, сам список — поверх него. */}
        {isHub && engineMenuOpen && (() => {
          const btnRect = engineBtnRef.current?.getBoundingClientRect();
          if (!btnRect) return null;
          return createPortal(
            <>
              <div
                onClick={() => setEngineMenuOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 9000 }}
              />
              <div style={{
                position: 'fixed', top: btnRect.bottom + 6, left: btnRect.right - 140,
                width: 140, zIndex: 9001,
                background: 'var(--surface-solid)',
                borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-pop)',
                border: '1px solid var(--glass-edge)',
                overflow: 'hidden', padding: 4,
              }}>
                {SEARCH_ENGINES.map((engine) => (
                  <div
                    key={engine.id}
                    onClick={() => pickEngine(engine.id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '7px 10px', borderRadius: 'var(--radius-sm)', cursor: 'default',
                      fontSize: 'var(--fs-sm)',
                      color: engine.id === searchEngineId ? 'var(--text-strong)' : 'var(--text-body)',
                      fontWeight: engine.id === searchEngineId ? 600 : 400,
                      background: engine.id === searchEngineId ? 'var(--surface-sunken)' : 'transparent',
                    }}
                    onMouseEnter={(e) => { if (engine.id !== searchEngineId) e.currentTarget.style.background = 'var(--surface-hover)'; }}
                    onMouseLeave={(e) => { if (engine.id !== searchEngineId) e.currentTarget.style.background = 'transparent'; }}
                  >
                    {engine.name}
                  </div>
                ))}
              </div>
            </>,
            document.body,
          );
        })()}
      </div>

      {/* Правая группа: пилюля «Защита» (VPN + адблок, схлопывается) + AI.
          marginLeft:auto прижимает к правому краю flex-контейнера. */}
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
        <div ref={vpnControlRef} style={{ display: 'inline-flex' }}>
          <VpnPill vpnOn={vpnOn} mode={vpnMode} onClick={toggleVpnPopover} active={vpnPopoverOpen} />
        </div>
        {/* Полностраничный перевод (см. PageTranslateManager.ts) — только на реальной странице,
            на хабе/истории/настройках переводить нечего. idle: приглушённая иконка, как адблок
            выкл. translating: спиннер, клик игнорируется (та же неактивность по смыслу, что
            disabled у кнопки «Обновить» на хабе — просто без атрибута disabled, там же логика
            игнора живёт в PageTranslateManager.ts::togglePageTranslate). translated: подсветка
            accent-soft — тот же тон, что у открытого поповера. */}
        {!isHub && tab?.url && !isLightWindow && (
          <button
            title={
              pageTranslateState === 'translating'
                ? (pageTranslateProgress
                    ? `Перевожу страницу… ${Math.min(pageTranslateProgress.batchIndex + 1, pageTranslateProgress.batchCount)}/${pageTranslateProgress.batchCount} · ${pageTranslateProgress.charsStreamed} симв.`
                    : 'Перевожу страницу…')
                : pageTranslateState === 'translated' ? 'Показать оригинал'
                : 'Перевести страницу'
            }
            onClick={onTogglePageTranslate}
            style={islandBtn(
              pageTranslateState === 'idle' ? 'var(--text-faint)' : 'var(--accent)',
              pageTranslateState === 'translated' ? 'var(--accent-soft)' : undefined,
            )}
          >
            {pageTranslateState === 'translating'
              ? <Loader2 size={18} style={{ animation: 'oblako-spin 1s linear infinite' }} />
              : <Languages size={18} />}
          </button>
        )}
        {/* Плашка-остров остаётся — как у всех кнопок тулбара. Меняется только ТОН: в покое
            нейтральный значок на обычной плашке, ровно как «назад/вперёд/обновить»; акцент
            загорается, когда панель открыта, то есть означает состояние, а не важность. */}
        {!isLightWindow && (
          <button title="AI-панель" onClick={onToggleAiPanel}
            style={aiPanelOpen
              ? islandBtn('var(--accent)', 'var(--accent-soft)')
              : islandBtn()}>
            <Sparkles size={18} />
          </button>
        )}
        {/* Кнопка загрузок: точка-индикатор когда есть активные загрузки. Иконка нейтральная
            всегда (заход 3) — акцент не для постоянных/переключаемых состояний, только точка
            новой активности остаётся акцентной (единичное уведомление, не постоянный статус).
            Клик открывает поповер с последними загрузками (см. DownloadsPopoverManager.ts), а не
            раздел целиком: посмотреть только что скачанный файл — самый частый повод сюда нажать,
            и ради него не должна уезжать открытая страница. Полный список — со дна поповера. */}
        <div ref={downloadsControlRef} style={{ display: 'inline-flex' }}>
          <button
            title="Загрузки"
            onClick={toggleDownloadsPopover}
            style={{
              ...(downloadsPopoverOpen ? islandBtn('var(--accent)', 'var(--accent-soft)') : islandBtn()),
              position: 'relative',
            }}
          >
            <Download size={18} style={flying ? { animation: 'oblako-dl-land 520ms var(--ease-out)' } : undefined} />

            {/* ⚠️ Прилетающий файл — единственный момент, когда человеку СООБЩАЮТ, что загрузка
                вообще началась: у нас нет ни системы тостов, ни полосы загрузок снизу, и раньше
                о начале скачивания говорила только точка 5×5 в углу кнопки, которую никто не
                замечал. Летит снизу-слева, со стороны страницы, — оттуда файл и «пришёл».
                Только transform и opacity: они не трогают раскладку и уходят в композитор. */}
            {flying && (
              <>
                <span
                  aria-hidden
                  style={{
                    position: 'absolute', inset: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    color: 'var(--accent)', pointerEvents: 'none', zIndex: 1,
                    animation: 'oblako-dl-fly 520ms var(--ease-out)',
                  }}
                >
                  <Download size={18} />
                </span>
                <span
                  aria-hidden
                  style={{
                    position: 'absolute', inset: 0, borderRadius: '50%',
                    pointerEvents: 'none',
                    animation: 'oblako-dl-halo 520ms var(--ease-out) 260ms',
                  }}
                />
              </>
            )}

            {/* Идёт скачивание — дуга прогресса по кругу кнопки. Прежняя статичная точка не
                отвечала на вопрос «идёт или нет»: она выглядела одинаково и на первом проценте,
                и на девяноста. Размер неизвестен (totalBytes = 0) — крутится бесконечная дуга,
                это честнее замершей шкалы. */}
            {downloadsActive && !downloadsPopoverOpen && (
              <ProgressRing value={downloadsProgress} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Дуга прогресса вокруг кнопки загрузок. value=null — размер файла неизвестен, крутим
// бесконечную дугу: замершая на месте шкала врала бы, что работа встала.
function ProgressRing({ value }: { value: number | null }) {
  const R = 13;
  const LEN = 2 * Math.PI * R;
  return (
    <svg
      viewBox="0 0 32 32" width={30} height={30} aria-hidden
      style={{
        position: 'absolute', inset: 0, margin: 'auto', pointerEvents: 'none',
        transform: 'rotate(-90deg)', // старт дуги сверху, а не справа
        animation: value === null ? 'oblako-dl-spin 1.1s linear infinite' : undefined,
      }}
    >
      <circle cx="16" cy="16" r={R} fill="none" stroke="var(--accent)" strokeOpacity={0.18} strokeWidth="2" />
      <circle
        cx="16" cy="16" r={R} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"
        strokeDasharray={LEN}
        strokeDashoffset={LEN * (1 - (value ?? 0.25))}
        style={{ transition: value === null ? undefined : 'stroke-dashoffset var(--dur-slow) var(--ease-standard)' }}
      />
    </svg>
  );
}

// ── Пилюля «Защита» (VPN + адблок) ────────────────────────────────────────────

// Открывает объединённый поповер «Защита» (VPN + адблок, см. vpnpopover.tsx) — раньше это была
// VPN-специфичная пилюля с именем подключённого сервера в подписи; заход «Защита» (шаг 4) убрал
// эту деталь из самой кнопки (осталась внутри поповера, VpnIndicatorPopover.tsx уже её показывает),
// т.к. кнопка теперь не только про VPN. Заливка щита по-прежнему = статус VPN (единственный
// сигнал, для которого у кнопки есть надёжный источник правды без похода в поповер).
function VpnPill({ vpnOn, mode, onClick, active }: { vpnOn: boolean; mode: VpnMode; onClick: () => void; active: boolean }) {
  const shieldColor = vpnOn ? 'var(--dot-vpn)' : 'var(--text-faint)';
  // Заливка самого щита зелёным при включённом VPN — вместо отдельной точки-индикатора рядом
  // (пользователь: «мне не нравится зеленая точка... почему бы просто не делать заливку щита»).
  const shieldIcon = <Shield size={15} style={{ color: shieldColor }} fill={vpnOn ? shieldColor : 'none'} />;
  // active — открыт поповер по клику на эту пилюлю: та же подсветка, что у кнопки паролей
  // (accent-soft), поверх обычного surface/surface-sunken тона вкл/выкл.
  const activeBg = active ? 'var(--accent-soft)' : undefined;

  if (mode === 'icon') {
    // Только щит (заливка = статус). Плашка-остров всегда, вкл/выкл различает тон фона.
    return (
      <button
        onClick={onClick}
        title="Защита"
        style={{
          // Остров на месте; акцентом отмечен только реально поднятый VPN.
          ...(vpnOn ? islandBtn('var(--accent)', 'var(--accent-soft)') : islandBtn()),
          position: 'relative',
          ...(activeBg ? { background: activeBg } : null),
        }}
      >
        {shieldIcon}
      </button>
    );
  }

  // short/full — раньше отличались длиной подписи (VPN vs VPN · Страна), сейчас подпись
  // фиксированная («Защита»), поэтому оба режима рендерят один и тот же widget; деление на
  // два порога (VPN_THRESHOLD_SHORT/FULL) осталось только в RIGHT_RESERVE-расчёте омнибокса.
  return (
    <button
      onClick={onClick}
      title="Защита"
      style={{
        ...islandPlate,
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 10px',
        borderRadius: 'var(--radius-pill)', cursor: 'default',
        // Плашка та же, что была; акцентом отмечен только поднятый VPN либо открытый поповер.
        background: activeBg ?? (vpnOn ? 'var(--accent-soft)' : 'var(--surface)'),
        fontSize: 'var(--fs-sm)', fontWeight: 500,
        color: vpnOn ? 'var(--accent)' : 'var(--text-muted)',
      }}
    >
      {shieldIcon}
      Защита
    </button>
  );
}

// islandPlate/islandBtn/navBtn — вынесены в src/styles/island.ts для переиспользования
// в других панелях (История/Настройки), см. импорт наверху файла. Вписаны в текущую высоту
// тулбара (TOOLBAR_HEIGHT не меняется) — сами токены стекла/тени/скругления не подбирались
// заново, те же, что уже отлажены в поповере/AI-панели.
