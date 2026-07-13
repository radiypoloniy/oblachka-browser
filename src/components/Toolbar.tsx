import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, RefreshCw, Lock, Search, Shield, Sparkles, Ban, Copy, Check, Download, ChevronDown, KeyRound, Languages, Loader2 } from 'lucide-react';
import type { TabState, HistoryEntry, SuggestDropdownItem, SemanticSearchResult, PasswordIndicatorState, PageTranslateState, PageTranslateProgress } from '../../shared/ipc';
import { normalizeForOmnibox, scoreEntry } from '../../shared/frecency';
import { stripEmoji } from '../../shared/text';
import { SEARCH_ENGINES, getSearchEngine, DEFAULT_SEARCH_ENGINE_ID } from '../../shared/searchEngines';
import type { SearchEngineId } from '../../shared/searchEngines';
import { islandPlate, islandBtn, navBtn } from '../styles/island';

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
  vpnOn: boolean;
  // Реальный remark подключённого сервера (VpnConnectionState.serverRemark) — не показываем
  // ничего, пока не подключено, вместо захардкоженной страны-плейсхолдера (см. живой аудит:
  // фейковый лейбл, не привязанный к реальному состоянию, — это то самое ложное чувство
  // защищённости, от которого fail-closed на шаге 3 явно уходит).
  vpnLabel: string | null;
  adBlockOn: boolean;         // AdBlockState.enabled — источник в App.tsx (getAdBlockState/onAdBlockStateChanged)
  onToggleAdBlock: () => void;
  dark: boolean;
  omniboxRef?: React.RefObject<HTMLInputElement>;
  onToggleDark: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onSubmit: (input: string) => void;
  onSuggestToggle?: (open: boolean) => void;
  downloadsActive: boolean;   // есть хотя бы одна активная загрузка
  downloadsOpen: boolean;     // панель загрузок сейчас открыта
  onToggleDownloads: () => void;
  onToggleAiPanel: () => void; // тоггл правой AI-панели (оверлей, см. AiPanelManager.ts)
  pageTranslateState: PageTranslateState; // см. PageTranslateManager.ts
  pageTranslateProgress: PageTranslateProgress | null; // батч N/M + живой счётчик символов, только пока translating
  onTogglePageTranslate: () => void;
}

// ── Компонент ─────────────────────────────────────────────────────────────────

export default function Toolbar({
  // dark/onToggleDark остаются в контракте пропсов (механизм темы не трогаем,
  // см. задачу) — сама кнопка убрана из разметки, поэтому здесь они не нужны.
  tab, allTabs, vpnOn, vpnLabel, adBlockOn, onToggleAdBlock, omniboxRef: externalRef,
  onBack, onForward, onReload, onSubmit, onSuggestToggle,
  downloadsActive, downloadsOpen, onToggleDownloads, onToggleAiPanel,
  pageTranslateState, pageTranslateProgress, onTogglePageTranslate,
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
  // Заход 8 (реальный баг): дропдаун закрывался корректно, но САМ ОТКРЫВАЛСЯ ЗАНОВО при переходе
  // на страницу / клике по сайдбару — потому что закрытие (removeChildView нативной вью дропдауна
  // в main) отдаёт OS-фокус ОБРАТНО омниноксу (тот же класс поведения, что задокументированная
  // спонтанная blur-пара при addChildView — тут симметрично, спонтанный focus при removeChildView).
  // onFocus ниже слепо перезапускал triggerSuggest(value), если в поле ещё оставался старый текст —
  // при спонтанном refocus это ОТКРЫВАЛО дропдаун заново без участия пользователя. Различаем
  // настоящий клик от спонтанного refocus: настоящий клик ВСЕГДА даёт mousedown НА ЭТОМ инпуте
  // непосредственно перед focus (синхронно, тот же тик) — спонтанный refocus от removeChildView
  // этому не предшествует.
  const realMouseDownRef = useRef(false);
  // Живой баг: выделение всего текста по клику (см. onMouseDown ниже) проверялось через
  // document.activeElement — но тот же спонтанный refocus от removeChildView (см. комментарий у
  // realMouseDownRef выше), который молча возвращает OS-фокус на инпут, ТАКЖЕ молча возвращает
  // document.activeElement на него, хотя пользователь ничего не кликал. Из-за этого следующий
  // РЕАЛЬНЫЙ клик видел «уже сфокусировано» и просто переставлял курсор, а не выделял всё. Здесь —
  // собственный, не подделываемый спонтанным событием источник истины: true выставляется ТОЛЬКО
  // настоящим mousedown по инпуту, false — только в местах, где мы САМИ явно решили закончить
  // редактирование (см. stopEditing ниже), не блуром/фокусом как таковыми.
  const hasRealFocusRef = useRef(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // «Таблетка» омнибокса (иконка+инпут+капсула/copy) — прямоугольник, под которым должен
  // вставать дропдаун подсказок. Пушится в main отдельным каналом (OMNIBOX_SET_BOUNDS) —
  // фундамент под будущую нативную вью дропдауна, сам дропдаун этот заход не трогает.
  const omniboxPillRef = useRef<HTMLDivElement>(null);
  const passwordControlRef = useRef<HTMLDivElement>(null);
  const vpnControlRef = useRef<HTMLDivElement>(null);

  // Текущий выбранный поисковик — источник истины в main (SettingsManager); здесь только
  // читаем id и строим URL по общему шаблону (shared/searchEngines.ts), не хардкодим движок.
  const [searchEngineId, setSearchEngineId] = useState<SearchEngineId>(DEFAULT_SEARCH_ENGINE_ID);
  useEffect(() => {
    let mounted = true;
    window.oblako.getSearchEngine().then((id) => { if (mounted) setSearchEngineId(id); });
    return () => { mounted = false; };
  }, []);

  // Капсула выбора поисковика — только на хабе (isHub), см. omnibox ниже.
  const [engineMenuOpen, setEngineMenuOpen] = useState(false);
  const engineBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!isHub) setEngineMenuOpen(false); }, [isHub]);

  const pickEngine = (id: SearchEngineId) => {
    setSearchEngineId(id);
    setEngineMenuOpen(false);
    void window.oblako.setSearchEngine(id);
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
  useEffect(() => {
    const el = omniboxPillRef.current;
    if (!el) return;
    const push = () => {
      const r = el.getBoundingClientRect();
      void window.oblako.setOmniboxBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = omniboxPillRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    void window.oblako.setOmniboxBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, [toolbarWidth]);

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
    const el = omniboxPillRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      void window.oblako.setOmniboxBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
    }
    setDropdownOpen(true);
    onSuggestToggle?.(true);
  }, [onSuggestToggle]);

  const closeDropdown = useCallback((reason = 'unknown') => {
    suggestSeqRef.current++;
    (window as any).ddlog?.log(`closeDropdown called reason=${reason}`); // ВРЕМЕННЫЙ лог диагностики
    setDropdownOpen(false);
    setSuggestions([]);
    setSelectedIdx(-1);
    onSuggestToggle?.(false);
    // Заход 6: открепление нативной вью — НЕ через опциональный onSuggestToggle (тот
    // существует для внешней синхронизации App.tsx, но closeDropdown не должен ЗАВИСЕТЬ от
    // того, передан ли он вообще). Прямой вызов того же канала, что открытие — единственная
    // точка закрытия (эту функцию), гарантированно доводит React-состояние и факт прикрепления
    // вью (isAttached() в SuggestDropdownManager.ts) до одного и того же результата на КАЖДОМ
    // пути закрытия (клик-вне, Esc, выбор, очистка ввода — все идут через closeDropdown).
    void window.oblako.setSuggestDropdownOpen(false);
    // Снимаем клавиатурную подсветку во вью — иначе при следующем открытии на миг мелькнёт
    // подсветка строки от предыдущей сессии (заход 4/5).
    void window.oblako.setSuggestDropdownHighlight(-1);
  }, [onSuggestToggle]);

  // Единая точка «редактирование действительно закончилось» — вместо разрозненных setEditing(false)
  // по всем местам. Синхронно гасит hasRealFocusRef (см. комментарий у него) — так спонтанный
  // refocus от removeChildView, даже молча вернув document.activeElement на инпут, не может
  // обмануть следующий реальный клик: hasRealFocusRef остаётся false, пока сюда не заглянет САМ
  // пользователь новым mousedown.
  const stopEditing = useCallback(() => {
    setEditing(false);
    hasRealFocusRef.current = false;
  }, []);

  const pushPasswordPopoverBounds = useCallback(() => {
    const el = passwordControlRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    void window.oblako.setPasswordPopoverAnchorBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, []);

  const togglePasswordPopover = useCallback(() => {
    if (!passwordIndicator) return;
    closeDropdown('password-indicator');
    stopEditing();
    if (passwordPopoverOpen) {
      setPasswordPopoverOpen(false);
      void window.oblako.closePasswordPopover();
      return;
    }
    pushPasswordPopoverBounds();
    setPasswordPopoverOpen(true);
    void window.oblako.showPasswordPopover(passwordIndicator);
  }, [closeDropdown, stopEditing, passwordIndicator, passwordPopoverOpen, pushPasswordPopoverBounds]);

  const pushVpnPopoverBounds = useCallback(() => {
    const el = vpnControlRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    void window.oblako.setVpnPopoverAnchorBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, []);

  const toggleVpnPopover = useCallback(() => {
    closeDropdown('vpn-indicator');
    stopEditing();
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
    void window.oblako.showVpnPopover();
  }, [closeDropdown, stopEditing, passwordPopoverOpen, vpnPopoverOpen, pushVpnPopoverBounds]);

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
      const insidePill = omniboxPillRef.current?.contains(target) ?? false;
      // ВРЕМЕННЫЙ лог диагностики — видно КАЖДЫЙ mousedown в chromeView, пока editing=true,
      // и что именно решил слушатель (insidePill=true -> игнор, false -> должен закрыть).
      (window as any).ddlog?.log(`outside-click detected insidePill=${insidePill} target=${(target as HTMLElement)?.tagName ?? '?'}`);
      if (!insidePill) {
        closeDropdown('outside-click');
        stopEditing();
      }
    };
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    return () => document.removeEventListener('mousedown', onOutsideMouseDown, true);
  }, [editing, closeDropdown, stopEditing]);

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
      (window as any).ddlog?.log('content-focus signal received'); // ВРЕМЕННЫЙ лог диагностики
      closeDropdown('content-focus');
      stopEditing();
    });
  }, [editing, closeDropdown, stopEditing]);

  // (3) Смена активной вкладки (мышью по сайдбару — уже покрыто (1); Ctrl+Tab/Ctrl+1-9 — нет) —
  // дропдаун анкорен к прежнему контексту, смысла в нём больше нет (тот же принцип, что
  // closeTranslatePopoverOnTabSwitch у поповера перевода).
  useEffect(() => {
    if (editing) { closeDropdown('tab-switch'); stopEditing(); }
    if (passwordPopoverOpen) {
      setPasswordPopoverOpen(false);
      void window.oblako.closePasswordPopover();
    }
    if (vpnPopoverOpen) {
      setVpnPopoverOpen(false);
      void window.oblako.closeVpnPopover();
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
    // Заход G, блок 7: семантический поиск — третья ветка в том же allSettled, та же изоляция
    // (embed-мост может отвалиться по таймауту/недоступности chromeView — не должен уронить
    // ни обычную историю, ни живые подсказки).
    // ⚠️ Promise.allSettled ждёт САМУЮ МЕДЛЕННУЮ ветку — без обёртки ниже холодный старт
    // эмбеддинг-модели (3-6с, см. замеры захода F) держал бы показ УЖЕ готовых history/suggest
    // результатов, хотя раньше омнибокс отвечал мгновенно. Таймаут — только на семантическую
    // ветку: если не успела за 400мс, просто не участвует в ЭТОМ показе (не отменяет сам запрос —
    // он может тихо доработать в фоне, результат достанется следующему keystroke, если такой будет).
    const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

    let histEntries: HistoryEntry[] = [];
    let suggestPhrases: string[] = [];
    let semanticEntries: SemanticSearchResult[] = [];
    const [histResult, suggestResult, semanticResult] = await Promise.allSettled([
      window.oblako.searchHistory(query),
      window.oblako.fetchSuggestions(query),
      withTimeout(window.oblako.searchHistorySemantic(query), 400, [] as SemanticSearchResult[]),
    ]);
    if (histResult.status === 'fulfilled') histEntries = histResult.value;
    if (suggestResult.status === 'fulfilled') suggestPhrases = suggestResult.value;
    if (semanticResult.status === 'fulfilled') semanticEntries = semanticResult.value;
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

    // Заход G, блок 7: семантические результаты сливаются в тот же byUrl-конвейер — дедуп по
    // URL срабатывает автоматически (если страница уже есть от обычного поиска по истории,
    // семантическое совпадение её не дублирует). Порог 0.5 — общие короткие заголовки
    // (логины, главные страницы) не должны лезть во всё подряд, как показал живой тест блока 6:
    // короткие тайтлы вроде "ChatGPT"/"Twitch"/"Авторизация" систематически давали высокий
    // cosine независимо от смысла запроса — отсечка убирает часть таких ложных срабатываний,
    // не устраняя саму причину (сигнал title+hostname), это осталось на будущее.
    const SEMANTIC_MIN_SCORE = 0.5;
    const semanticKeys = new Set<string>();
    for (const s of semanticEntries) {
      if (s.score < SEMANTIC_MIN_SCORE) continue;
      const key = normalizeForOmnibox(s.url);
      semanticKeys.add(key);
      const cur = byUrl.get(key);
      const asEntry: HistoryEntry = { id: s.id, url: s.url, title: s.title, lastVisit: s.lastVisit, visitCount: s.visitCount };
      if (!cur || scoreEntry(asEntry, now) > scoreEntry(cur, now)) byUrl.set(key, asEntry);
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
      // Семантическое совпадение (заход G, блок 7) — ниже «настоящих» текстовых совпадений (3-6).
      if (semanticKeys.has(normalizeForOmnibox(e.url))) return 2;
      // Живой фидбэк («пусть меньше, но качественнее»): раньше здесь был ещё фоллбэк —
      // вхождение ГДЕ УГОДНО (в т.ч. посреди слова, без границы). Он и давал мусор вроде страниц
      // логина/авторизации и случайных фото из истории — их заголовки/hostname часто СОДЕРЖАТ
      // запрос как случайную подстроку (например «the» внутри «auTHEntication»), не имея к нему
      // никакого смыслового отношения. Без него страница либо совпадает по-настоящему (домен/
      // заголовок/путь на границе слова) или семантически, либо не показывается вообще — короче
      // список, но каждая строка в нём объяснима.
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
    const [topItem, ...restItems] = items;
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
    setSelectedIdx(-1);
    openDropdown();
    // Тот же список — дополнительно в нативную вью дропдауна (заход 3/5, параллельно старому
    // React-дропдауну выше). Формирование списка (история/вкладки/frecency/дедуп) не меняется —
    // только эта отправка добавлена.
    void window.oblako.setSuggestDropdownItems(deduped);
    // Новый список — снимаем клавиатурную подсветку синхронно со сбросом selectedIdx выше
    // (заход 4/5): иначе вью продолжила бы подсвечивать строку, которой уже нет/сместилась.
    void window.oblako.setSuggestDropdownHighlight(-1);
  }, [allTabs, openDropdown, closeDropdown, searchEngineId]);

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
    stopEditing();
    closeDropdown('submit');
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
      closeDropdown('pick-tab');
      stopEditing();
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
        // Заход 4/5: та же подсветка — во вью нативного дропдауна (омнибокс остаётся владельцем
        // selectedIdx, вью только рисует по номеру, ничего не решая сама).
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
        stopEditing();
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
            <span style={{ color: 'var(--text-faint)', display: 'inline-flex' }}>
              {isHub ? <Search size={15} /> : <Lock size={14} />}
            </span>
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
                realMouseDownRef.current = true;
                // Самосброс на следующий тик — если фокус НЕ сменился (клик в уже сфокусированное
                // поле, просто переставить курсор), onFocus не вызовется вообще и не консьюмит флаг
                // сам; без этого он завис бы «true» до следующего, уже НЕ обязательно настоящего,
                // focus-события (см. комментарий у realMouseDownRef).
                setTimeout(() => { realMouseDownRef.current = false; }, 0);
                // Выделение всего текста по клику — как в любом адресном поле. Только на ПЕРВОМ
                // клике, переводящем фокус в поле — иначе повторный клик по уже сфокусированному
                // полю не смог бы просто переставить курсор. preventDefault обязателен: браузер
                // иначе сам расставит курсор по месту клика на mouseup ПОСЛЕ нашего select() и
                // сотрёт выделение.
                // ⚠️ Живой баг: раньше «уже сфокусировано» проверялось через document.activeElement —
                // но спонтанный refocus от removeChildView (см. комментарий у realMouseDownRef выше)
                // молча возвращает document.activeElement на этот инпут, хотя пользователь ничего не
                // кликал. Из-за этого ПОСЛЕ любого закрытия дропдауна клик-мимо-и-обратно переставал
                // выделять текст на некоторое время. hasRealFocusRef — свой источник истины, который
                // спонтанный focus не трогает (см. комментарий у него/у stopEditing).
                if (!hasRealFocusRef.current) {
                  e.preventDefault();
                  inputRef.current?.focus();
                  inputRef.current?.select();
                }
                hasRealFocusRef.current = true;
              }}
              onFocus={() => {
                setEditing(true);
                // Реальный клик — realMouseDownRef успел взвестись только что (onMouseDown на ЭТОМ
                // же инпуте синхронно предшествует onFocus). Спонтанный refocus (см. комментарий у
                // realMouseDownRef выше) этого сигнала не имеет — дропдаун не переоткрываем.
                if (realMouseDownRef.current && value.trim()) triggerSuggest(value);
                realMouseDownRef.current = false;
              }}
              // ⚠️ Намеренно БЕЗ onBlur. blur — не триггер закрытия дропдауна ни в каком виде (см.
              // «Заход 5» выше — независимые сигналы вместо него). Раньше отсюда же сбрасывался
              // editing по любому blur — теперь это делают те же явные сигналы (клик мимо/фокус на
              // контент/смена вкладки), Esc и submit() сбрасывают editing отдельно, как и раньше.
              onKeyDown={handleKeyDown}
              style={{
                flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none',
                fontSize: 'var(--fs-sm)', color: 'var(--text-strong)',
                fontFamily: isHub ? 'var(--font-sans)' : 'var(--font-mono)',
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
                      display: 'inline-flex', color: 'var(--accent)', position: 'relative',
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
                borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-island)',
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

      {/* Правая группа: VPN-пилюля (схлопывается) + AI + адблок.
          marginLeft:auto прижимает к правому краю flex-контейнера. */}
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
        <div ref={vpnControlRef} style={{ display: 'inline-flex' }}>
          <VpnPill vpnOn={vpnOn} vpnLabel={vpnLabel} mode={vpnMode} onClick={toggleVpnPopover} active={vpnPopoverOpen} />
        </div>
        {/* Полностраничный перевод (см. PageTranslateManager.ts) — только на реальной странице,
            на хабе/истории/настройках переводить нечего. idle: приглушённая иконка, как адблок
            выкл. translating: спиннер, клик игнорируется (та же неактивность по смыслу, что
            disabled у кнопки «Обновить» на хабе — просто без атрибута disabled, там же логика
            игнора живёт в PageTranslateManager.ts::togglePageTranslate). translated: подсветка
            accent-soft — тот же тон, что у открытого поповера. */}
        {!isHub && tab?.url && (
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
        <button title="AI-хаб" onClick={onToggleAiPanel}
          style={islandBtn('var(--accent)', 'var(--accent-soft)')}>
          <Sparkles size={18} />
        </button>
        {/* Тоггл адблока — глобальный AdBlockState.enabled (тот же тумблер, что в Settings →
            Блокировка). Выключено = приглушённая иконка, как у недоступной кнопки навигации. */}
        <button
          title={adBlockOn ? 'Адблок включён' : 'Адблок выключен'}
          onClick={onToggleAdBlock}
          style={islandBtn(adBlockOn ? 'var(--accent)' : 'var(--text-faint)', adBlockOn ? 'var(--accent-soft)' : undefined)}
        >
          <Ban size={18} />
        </button>
        {/* Кнопка загрузок: точка-индикатор когда есть активные загрузки */}
        <button
          title="Загрузки"
          onClick={onToggleDownloads}
          style={{ ...navBtn(false), position: 'relative', color: downloadsOpen ? 'var(--accent)' : 'var(--text-muted)' }}
        >
          <Download size={18} />
          {downloadsActive && !downloadsOpen && (
            <span style={{
              position: 'absolute', bottom: 5, right: 5,
              width: 5, height: 5, borderRadius: '50%',
              background: 'var(--accent)',
            }} />
          )}
        </button>
      </div>
    </div>
  );
}

// ── VPN-пилюля ───────────────────────────────────────────────────────────────

function VpnPill({ vpnOn, vpnLabel, mode, onClick, active }: { vpnOn: boolean; vpnLabel: string | null; mode: VpnMode; onClick: () => void; active: boolean }) {
  const shieldColor = vpnOn ? 'var(--dot-vpn)' : 'var(--text-faint)';
  // Флаг-эмодзи в remark (🇳🇱, 🇩🇪…) не всегда рендерится Windows как один глиф — в узкой пилюле/
  // поповере это давало налезание символов друг на друга (см. shared/text.ts::stripEmoji).
  const cleanLabel = vpnLabel ? stripEmoji(vpnLabel) : null;
  const fullLabel = vpnOn ? `VPN · ${cleanLabel ?? '…'}` : 'VPN выкл.';
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
        title={fullLabel}
        style={{
          ...navBtn(false),
          ...islandPlate,
          position: 'relative',
          background: activeBg ?? (vpnOn ? 'var(--surface)' : 'var(--surface-sunken)'),
          borderRadius: 'var(--radius-card)',
        }}
      >
        {shieldIcon}
      </button>
    );
  }

  if (mode === 'short') {
    // «VPN» + щит — без страны. Плашка-остров всегда, вкл/выкл — тон фона.
    return (
      <button
        onClick={onClick}
        title={fullLabel}
        style={{
          ...islandPlate,
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 10px',
          borderRadius: 'var(--radius-pill)', cursor: 'default',
          background: activeBg ?? (vpnOn ? 'var(--surface)' : 'var(--surface-sunken)'),
          fontSize: 'var(--fs-sm)', fontWeight: 500,
          color: vpnOn ? 'var(--text-strong)' : 'var(--text-muted)',
        }}
      >
        {shieldIcon}
        VPN
      </button>
    );
  }

  // full — полный лейбл. Та же плашка-остров, шире под текст.
  return (
    <button
      onClick={onClick}
      title="VPN"
      style={{
        ...islandPlate,
        display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 12px',
        borderRadius: 'var(--radius-pill)', cursor: 'default',
        background: activeBg ?? (vpnOn ? 'var(--surface)' : 'var(--surface-sunken)'),
        fontSize: 'var(--fs-sm)', fontWeight: 500,
        color: vpnOn ? 'var(--text-strong)' : 'var(--text-muted)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      {shieldIcon}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fullLabel}</span>
    </button>
  );
}

// islandPlate/islandBtn/navBtn — вынесены в src/styles/island.ts для переиспользования
// в других панелях (История/Настройки), см. импорт наверху файла. Вписаны в текущую высоту
// тулбара (TOOLBAR_HEIGHT не меняется) — сами токены стекла/тени/скругления не подбирались
// заново, те же, что уже отлажены в поповере/AI-панели.
