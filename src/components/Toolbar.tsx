import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, RefreshCw, Lock, Search, Shield, Sparkles, Ban, Copy, Check, Download, ChevronDown } from 'lucide-react';
import type { TabState, HistoryEntry, SuggestDropdownItem } from '../../shared/ipc';
import { normalizeForTiles, scoreEntry } from '../../shared/frecency';
import { SEARCH_ENGINES, getSearchEngine, DEFAULT_SEARCH_ENGINE_ID } from '../../shared/searchEngines';
import type { SearchEngineId } from '../../shared/searchEngines';

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
  dark: boolean;
  omniboxRef?: React.RefObject<HTMLInputElement>;
  onToggleVpn: () => void;
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
}

// ── Компонент ─────────────────────────────────────────────────────────────────

export default function Toolbar({
  // dark/onToggleDark остаются в контракте пропсов (механизм темы не трогаем,
  // см. задачу) — сама кнопка убрана из разметки, поэтому здесь они не нужны.
  tab, allTabs, vpnOn, omniboxRef: externalRef,
  onToggleVpn, onBack, onForward, onReload, onSubmit, onSuggestToggle,
  downloadsActive, downloadsOpen, onToggleDownloads, onToggleAiPanel,
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

  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? internalRef;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // «Таблетка» омнибокса (иконка+инпут+капсула/copy) — прямоугольник, под которым должен
  // вставать дропдаун подсказок. Пушится в main отдельным каналом (OMNIBOX_SET_BOUNDS) —
  // фундамент под будущую нативную вью дропдауна, сам дропдаун этот заход не трогает.
  const omniboxPillRef = useRef<HTMLDivElement>(null);

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

  // Пока не редактируем — поле отражает реальный URL вкладки.
  useEffect(() => {
    if (!editing) setValue(isHub ? '' : (tab?.url ?? ''));
  }, [tab?.url, isHub, editing]);

  const openDropdown = useCallback(() => {
    setDropdownOpen(true);
    onSuggestToggle?.(true);
  }, [onSuggestToggle]);

  const closeDropdown = useCallback(() => {
    setDropdownOpen(false);
    setSuggestions([]);
    setSelectedIdx(-1);
    onSuggestToggle?.(false);
    // Снимаем клавиатурную подсветку во вью — иначе при следующем открытии на миг мелькнёт
    // подсветка строки от предыдущей сессии (заход 4/5).
    void window.oblako.setSuggestDropdownHighlight(-1);
  }, [onSuggestToggle]);

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
      if (!omniboxPillRef.current?.contains(target)) {
        closeDropdown();
        setEditing(false);
      }
    };
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    return () => document.removeEventListener('mousedown', onOutsideMouseDown, true);
  }, [editing, closeDropdown]);

  // (2) Реальный OS-фокус ушёл на контент активной вкладки (ДРУГОЙ webContents — клик мышью по
  // странице) — main шлёт это из TabManager.wirePageEvents::wc.on('focus'), см. shared/ipc.ts::
  // SUGGEST_DROPDOWN_CONTENT_FOCUS.
  useEffect(() => {
    if (!editing) return;
    return window.oblako.onSuggestDropdownContentFocus(() => {
      closeDropdown();
      setEditing(false);
    });
  }, [editing, closeDropdown]);

  // (3) Смена активной вкладки (мышью по сайдбару — уже покрыто (1); Ctrl+Tab/Ctrl+1-9 — нет) —
  // дропдаун анкорен к прежнему контексту, смысла в нём больше нет (тот же принцип, что
  // closeTranslatePopoverOnTabSwitch у поповера перевода).
  useEffect(() => {
    if (editing) { closeDropdown(); setEditing(false); }
  }, [tab?.id]);

  const buildSuggestions = useCallback(async (query: string) => {
    if (!query.trim()) { closeDropdown(); return; }
    const q = query.toLowerCase();

    let histEntries: HistoryEntry[] = [];
    try {
      histEntries = await window.oblako.searchHistory(query);
    } catch { /* история недоступна */ }

    const now = Date.now();

    // Дедуп по домену: одному origin = одна строка.
    // Берём страницу с максимальным frecency-баллом на этом домене.
    const byOrigin = new Map<string, HistoryEntry>();
    for (const e of histEntries) {
      const origin = normalizeForTiles(e.url);
      const cur = byOrigin.get(origin);
      if (!cur || scoreEntry(e, now) > scoreEntry(cur, now)) byOrigin.set(origin, e);
    }

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
      if (hostname.startsWith(q))              return 4; // префикс домена → максимум
      if (title.startsWith(q))                 return 3; // префикс заголовка
      if (hostname.includes(q) || title.includes(q)) return 2; // вхождение в домен/заголовок
      if (pathname.includes(q))                return 1; // только в пути
      return 0; // только в query/hash — отфильтровываем
    }

    // Итоговый скор: ×10000 за тип совпадения даёт ему абсолютный приоритет над частотой.
    const MATCH_TIER = 10_000;

    const histItems: SuggestItem[] = [...byOrigin.values()]
      .map((e) => ({ e, match: calcMatchScore(e), freq: scoreEntry(e, now) }))
      .filter(({ match }) => match > 0)
      .sort((a, b) => (b.match * MATCH_TIER + b.freq) - (a.match * MATCH_TIER + a.freq))
      .slice(0, 5)
      .map(({ e }) => ({ kind: 'history' as SuggestKind, label: e.url, sub: e.title, url: e.url }));

    const tabItems: SuggestItem[] = allTabs
      .filter((t) => !t.isHub && (
        t.url.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)
      ))
      .map((t) => ({ kind: 'tab' as SuggestKind, label: t.url, sub: t.title, url: t.url, tabId: t.id }));

    const searchItem: SuggestItem = {
      kind: 'search',
      label: `Искать: ${query}`,
      url: getSearchEngine(searchEngineId).buildUrl(query),
    };

    const tabUrls = new Set(tabItems.map((t) => t.url));
    const deduped = [
      ...tabItems,
      ...histItems.filter((h) => !tabUrls.has(h.url)),
    ].slice(0, SUGGEST_MAX - 1);
    deduped.push(searchItem);
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
    if (!q.trim()) { closeDropdown(); return; }
    debounceRef.current = setTimeout(() => { void buildSuggestions(q); }, SUGGEST_DEBOUNCE);
  }, [buildSuggestions, closeDropdown]);

  const submit = (input: string) => {
    const v = input.trim();
    if (!v) return;
    onSubmit(v);
    inputRef.current?.blur();
    setEditing(false);
    closeDropdown();
    setValue(v);
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
      closeDropdown();
      setEditing(false);
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
        closeDropdown();
      } else {
        inputRef.current?.blur();
        setEditing(false);
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
              onChange={(e) => { setValue(e.target.value); triggerSuggest(e.target.value); }}
              onFocus={() => { setEditing(true); if (value.trim()) triggerSuggest(value); }}
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
        <VpnPill vpnOn={vpnOn} mode={vpnMode} onClick={onToggleVpn} />
        <button title="AI-хаб" onClick={onToggleAiPanel}
          style={islandBtn('var(--accent)', 'var(--accent-soft)')}>
          <Sparkles size={18} />
        </button>
        {/* Иконка адблока — ПОКА чисто визуальная заглушка, без подключения к логике
            (см. задачу: в исключениях адблока сейчас незакрытый баг, подключать рано). */}
        <button title="Адблок" onClick={() => {}}
          style={islandBtn()}>
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

function VpnPill({ vpnOn, mode, onClick }: { vpnOn: boolean; mode: VpnMode; onClick: () => void }) {
  const shieldColor = vpnOn ? 'var(--dot-vpn)' : 'var(--text-faint)';
  const dot = vpnOn
    ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dot-vpn)', flex: 'none' }} />
    : null;

  if (mode === 'icon') {
    // Только щит + цветная точка (если VPN включён). Плашка-остров всегда,
    // включён/выключен различает только тон фона (surface / surface-sunken).
    return (
      <button
        onClick={onClick}
        title={vpnOn ? 'VPN включён' : 'VPN выкл.'}
        style={{
          ...navBtn(false),
          ...islandPlate,
          position: 'relative',
          color: shieldColor,
          background: vpnOn ? 'var(--surface)' : 'var(--surface-sunken)',
          borderRadius: 'var(--radius-card)',
        }}
      >
        <Shield size={15} />
        {vpnOn && (
          // Маленький индикатор поверх иконки.
          <span style={{
            position: 'absolute', bottom: 5, right: 5,
            width: 5, height: 5, borderRadius: '50%', background: 'var(--dot-vpn)',
          }} />
        )}
      </button>
    );
  }

  if (mode === 'short') {
    // «VPN» + индикатор — без страны. Плашка-остров всегда, вкл/выкл — тон фона.
    return (
      <button
        onClick={onClick}
        title={vpnOn ? 'VPN · Финляндия' : 'VPN выкл.'}
        style={{
          ...islandPlate,
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 10px',
          borderRadius: 'var(--radius-pill)', cursor: 'default',
          background: vpnOn ? 'var(--surface)' : 'var(--surface-sunken)',
          fontSize: 'var(--fs-sm)', fontWeight: 500,
          color: vpnOn ? 'var(--text-strong)' : 'var(--text-muted)',
        }}
      >
        <Shield size={15} style={{ color: shieldColor }} />
        VPN
        {dot}
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
        background: vpnOn ? 'var(--surface)' : 'var(--surface-sunken)',
        fontSize: 'var(--fs-sm)', fontWeight: 500,
        color: vpnOn ? 'var(--text-strong)' : 'var(--text-muted)',
      }}
    >
      <Shield size={15} style={{ color: shieldColor }} />
      {vpnOn ? 'VPN · Финляндия' : 'VPN выкл.'}
      {dot}
    </button>
  );
}

// ── Плавающие плашки-острова тулбара ──────────────────────────────────────────
// Параметры стекла/тени/скругления не подбираются заново — те же, что уже
// отлажены в поповере/AI-панели (surface + glass-filter + shadow-card + glass-edge).
// Вписаны в текущую высоту тулбара (TOOLBAR_HEIGHT не меняется).
const islandPlate: React.CSSProperties = {
  background: 'var(--surface)',
  backdropFilter: 'var(--glass-filter)', WebkitBackdropFilter: 'var(--glass-filter)',
  boxShadow: 'var(--shadow-card)',
  border: '1px solid var(--glass-edge)',
};

// Одиночная кнопка-остров (AI, адблок) — тот же islandPlate, компактный размер как у navBtn.
function islandBtn(color?: string, bg?: string): React.CSSProperties {
  return {
    ...navBtn(false),
    ...islandPlate,
    color: color ?? 'var(--text-muted)',
    background: bg ?? 'var(--surface)',
    borderRadius: 'var(--radius-card)',
  };
}

// ── Стиль кнопки навигации ────────────────────────────────────────────────────

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    border: 'none', background: 'transparent', padding: 7, borderRadius: 'var(--radius-sm)',
    color: disabled ? 'var(--text-faint)' : 'var(--text-muted)',
    cursor: 'default', display: 'inline-flex', opacity: disabled ? 0.45 : 1,
  };
}
