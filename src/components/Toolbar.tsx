import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, RefreshCw, Shield, Sparkles, Copy, Check, Download, ChevronDown, KeyRound, Loader2, Star, Clipboard, MoreHorizontal } from 'lucide-react';
import type { TabState, HistoryEntry, SuggestDropdownItem, PasswordIndicatorState, PageTranslateState, PageTranslateProgress, SmartTabHit, OmniboxPanelSite, PermissionRecord, SemanticSearchResult } from '../../shared/ipc';
import { normalizeForOmnibox, scoreEntry } from '../../shared/frecency';
import { SEARCH_ENGINES, getSearchEngine, DEFAULT_SEARCH_ENGINE_ID } from '../../shared/searchEngines';
import type { SearchEngineId } from '../../shared/searchEngines';
import { islandPlate, islandGroup, clusterBtn, ISLAND_HEIGHT } from '../styles/island';
import { setDefaultSearchEngine, subscribeDefaultSearchEngine } from '../searchEngineSetting';

// Высота тулбара — должна совпадать с CSS-значением (56px).
const TOOLBAR_HEIGHT = 56;
// Дебаунс запроса к истории (мс).
const SUGGEST_DEBOUNCE = 150;
// Максимум строк в дропдауне.
const SUGGEST_MAX = 8;
// Сколько записей истории просматриваем ради списка «часто посещаемые» и сколько сайтов
// показываем. Глубина взята с запасом: у частого сайта в истории десятки страниц, и после
// схлопывания по сайту из трёхсот записей остаются единицы доменов.
const TOP_SITES_SCAN = 300;
const TOP_SITES_SHOWN = 8;
// Карточек «вы это уже читали» в панели. Поповер замочка показывает три строкой; здесь ряд
// карточек во всю ширину, и четвёртая ложится в него без переноса на обычной ширине окна.
const PANEL_RELATED_MAX = 4;
// Потолок набора «Рекомендуемые» — папка рисует его блоком 4×2. Тот же предел стоит и в
// SettingsManager (RECOMMENDED_MAX): диск не обязан верить рендереру.
const RECOMMENDED_MAX = 8;

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
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [toolbarWidth, setToolbarWidth] = useState(1280);
  // ⚠️ Ширина омнибокса теперь ИЗМЕРЯЕТСЯ, а не вычисляется. Её задаёт flex, и оценивать её
  // формулой значило бы держать вторую, неизбежно расходящуюся правду: от неё зависят пороги
  // схлопывания капсулы поисковика и плейсхолдера, и разъедься оценка с реальностью — капсула
  // складывалась бы не тогда, когда ей тесно.
  // Обратной связи на раскладку нет: ширину диктует родитель (flex + maxWidth), содержимое
  // таблетки на неё не влияет (minWidth:0), поэтому запись измерения в состояние не может
  // запустить цикл «измерил → перерисовал → измерил другое».
  const [omniboxWidth, setOmniboxWidth] = useState(0);
  const [placeholderVisible, setPlaceholderVisible] = useState(true);
  const [passwordIndicator, setPasswordIndicator] = useState<PasswordIndicatorState | null>(null);
  const [passwordPopoverOpen, setPasswordPopoverOpen] = useState(false);
  const [downloadsPopoverOpen, setDownloadsPopoverOpen] = useState(false);
  // Буфер скопированного со страниц. ⚠️ Кнопки НЕТ, пока буфер пуст: на чистом сеансе она была бы
  // мёртвым значком, а тулбар и так тесный (тот же приём, что у индикатора товара).
  const [clipboardCount, setClipboardCount] = useState(0);
  const [clipboardPopoverOpen, setClipboardPopoverOpen] = useState(false);
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
  // Кэши дорисовки панели — ПО АДРЕСУ и на сеанс работы окна.
  // ⚠️ Не оптимизация ради оптимизации: getPageChanges достаёт текст живой страницы и сравнивает
  // со снимком в истории, а панель открывается на каждый щелчок по адресной строке. Без кэша один
  // и тот же разбор шёл бы десятки раз на одной странице. Пустая строка = «спрашивали, изменений
  // нет» — это тоже ответ, и повторять его незачем.
  const pageChangesRef = useRef<Map<string, string>>(new Map());
  const relatedRef = useRef<Map<string, SuggestItem[]>>(new Map());
  // Набор «Рекомендуемые» — читается из настроек один раз при монтировании и живёт в ref: панель
  // собирается синхронно, иначе плитки набора приезжали бы вторым кадром и сдвигали номера строк
  // уже после того, как человек нацелился стрелками.
  const recommendedRef = useRef<SuggestItem[]>([]);
  // Черновик (набранный, но не отправленный текст) — по вкладке, переживает потерю фокуса и
  // переключение вкладок, как в популярных браузерах: просто отвлечься на другую вкладку не должно
  // стирать то, что печатали. Стирается явно — submit() (реальная навигация) и Escape (см.
  // handleKeyDown) — а не любым blur/setEditing(false) (клик мимо, фокус на контент, тоггл
  // поповера паролей/VPN и т.п. этот Map не трогают вовсе).
  const draftsRef = useRef<Map<string, string>>(new Map());
  // Момент последней отправки. Нужен фокус-циклу ниже: submit() снимает фокус НАМЕРЕННО, и
  // возвращать его в этот момент нельзя — иначе строка перехватывает фокус у только что
  // открытой страницы (и держит editing, из-за чего набранный текст не сменялся адресом).
  const submittedAtRef = useRef(0);
  // Первый показ хаба за жизнь окна — старт приложения. Ему нужно окно ожидания длиннее (см.
  // эффект фокуса ниже), поэтому случай отличается флагом, а не таймером «на всякий случай».
  const firstHubRef = useRef(true);
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
    // Тот же замер обслуживает и пороги схлопывания внутри таблетки (см. omniboxWidth).
    setOmniboxWidth(r.width);
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
      // ⚠️ Хаб открывается ЧИСТЫМ, без черновика. Он не страница, а экран «новая вкладка», и
      // человек приходит на него, чтобы начать заново. Жалоба была ровно об этом: набрал текст,
      // перешёл по нему, открыл новую вкладку — а текст всё ещё в строке. Причина живучая:
      // хаб один на окно (HUB_ID), его черновик переживает и переход, и создание новой вкладки,
      // и всплывает при следующем возврате. Ловилось нерегулярно, потому что зависит от того,
      // успел ли submit() снять черновик до того, как список вкладок доехал из main.
      if (tab.isHub) { draftsRef.current.delete(tab.id); setValue(''); return; }
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
    // Гасим и сам отложенный пересчёт: поднятого seq достаточно, чтобы его результат не долетел,
    // но незачем будить историю и сеть ради заведомо выброшенного ответа.
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
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
    if (sitePopoverOpen) { setSitePopoverOpen(false); void window.oblako.toggleSitePopover(); }
    if (clipboardPopoverOpen) { setClipboardPopoverOpen(false); void window.oblako.toggleClipboardPopover(); }
    if (downloadsPopoverOpen) {
      setDownloadsPopoverOpen(false);
      void window.oblako.closeDownloadsPopover();
      return;
    }
    pushDownloadsPopoverBounds();
    setDownloadsPopoverOpen(true);
    void window.oblako.showDownloadsPopover();
  }, [closeDropdownFully, passwordPopoverOpen, sitePopoverOpen, downloadsPopoverOpen, clipboardPopoverOpen, pushDownloadsPopoverBounds]);

  useEffect(() => window.oblako.onDownloadsPopoverClosed(() => setDownloadsPopoverOpen(false)), []);

  useEffect(() => window.oblako.onClipboardChanged(setClipboardCount), []);
  // ⚠️ И СРАЗУ спрашиваем текущее число, не дожидаясь первого изменения: закреплённое поднимается
  // с диска при старте, и без этого запроса кнопка буфера оставалась серой до первого копирования
  // — то есть достать закреплённое, ничего не скопировав, было нельзя.
  useEffect(() => { void window.oblako.getClipboardCount().then(setClipboardCount); }, []);
  useEffect(() => window.oblako.onClipboardPopoverClosed(() => setClipboardPopoverOpen(false)), []);

  const toggleClipboardPopover = useCallback(() => {
    closeDropdownFully('clipboard-button');
    if (passwordPopoverOpen) { setPasswordPopoverOpen(false); void window.oblako.closePasswordPopover(); }
    if (sitePopoverOpen) { setSitePopoverOpen(false); void window.oblako.toggleSitePopover(); }
    if (downloadsPopoverOpen) { setDownloadsPopoverOpen(false); void window.oblako.closeDownloadsPopover(); }
    const el = clipboardControlRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      window.oblako.syncClipboardPopoverBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
    }
    setClipboardPopoverOpen((v) => !v);
    void window.oblako.toggleClipboardPopover();
  }, [closeDropdownFully, passwordPopoverOpen, sitePopoverOpen, downloadsPopoverOpen]);

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
    if (sitePopoverOpen) { setSitePopoverOpen(false); void window.oblako.toggleSitePopover(); }
    if (downloadsPopoverOpen) { setDownloadsPopoverOpen(false); void window.oblako.closeDownloadsPopover(); }
    if (clipboardPopoverOpen) { setClipboardPopoverOpen(false); void window.oblako.toggleClipboardPopover(); }
    pushSitePopoverBounds();
    // Состояние приходит ответом самого toggle — второго источника правды не заводим.
    void window.oblako.toggleSitePopover().then(setSitePopoverOpen);
  }, [closeDropdownFully, passwordPopoverOpen, sitePopoverOpen, downloadsPopoverOpen, clipboardPopoverOpen, pushSitePopoverBounds]);

  useEffect(() => window.oblako.onSitePopoverClosed(() => setSitePopoverOpen(false)), []);

  // Клик по полоске сайта В ПАНЕЛИ омнибокса — открываем тот же поповер, что и замочек. Через
  // ref, а не прямой зависимостью: подписка ставится один раз, а toggleSitePopover пересоздаётся
  // при каждом изменении состояния поповеров (тот же приём, что у pickSuggestionRef ниже).
  const toggleSitePopoverRef = useRef(toggleSitePopover);
  toggleSitePopoverRef.current = toggleSitePopover;
  useEffect(() => window.oblako.onSuggestDropdownSiteInfo(() => { toggleSitePopoverRef.current(); }), []);

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

  // Буфер: якорь и клик мимо — ровно та же механика, что у загрузок выше. Наблюдатель нужен и
  // теперь, когда кнопка перестала появляться-исчезать: её прямоугольник всё равно ездит от
  // ресайза окна и сворачивания сайдбара.
  useEffect(() => {
    if (!clipboardPopoverOpen) return;
    const el = clipboardControlRef.current;
    if (!el) return;
    const push = () => {
      const r = el.getBoundingClientRect();
      window.oblako.syncClipboardPopoverBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
    };
    push();
    const ro = new ResizeObserver(push);
    ro.observe(el);
    return () => ro.disconnect();
  }, [clipboardPopoverOpen, toolbarWidth]);

  useEffect(() => {
    if (!clipboardPopoverOpen) return;
    const onOutsideMouseDown = (e: MouseEvent) => {
      if (!clipboardControlRef.current?.contains(e.target as Node)) {
        setClipboardPopoverOpen(false);
        void window.oblako.toggleClipboardPopover();
      }
    };
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    return () => document.removeEventListener('mousedown', onOutsideMouseDown, true);
  }, [clipboardPopoverOpen]);

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
    if (sitePopoverOpen) {
      setSitePopoverOpen(false);
      void window.oblako.toggleSitePopover();
    }
    if (downloadsPopoverOpen) {
      setDownloadsPopoverOpen(false);
      void window.oblako.closeDownloadsPopover();
    }
  }, [tab?.id]);

  const buildSuggestions = useCallback(async (query: string, seq: number) => {
    if (!query.trim()) { closeDropdown('empty-query'); return; }
    // ⚠️ ГВАРД ОБЯЗАН СТОЯТЬ ЗДЕСЬ, А НЕ ТОЛЬКО ПОСЛЕ ЗАПРОСОВ. Он есть ниже трижды, но всюду
    // после первого await — а показ дропдауна происходит РАНЬШЕ них, синхронно. Запуск же сюда
    // приходит отложенно, через дебаунс: закрой омнибокс в те 150 мс (Esc, клик по ссылке, смена
    // вкладки) — closeDropdown поднимал seq, но таймер оставался жив, и провизорный показ ниже
    // открывал вью ЗАНОВО. Закрыть её после этого было уже нечем: editing к тому моменту false,
    // слушатель «клика мимо» снят, сигнал фокуса в контент отработал, — дропдаун висел до
    // следующего переключения вкладки. Ровно тот редкий залипающий дропдаун, который ловился
    // «раз в сколько-то» и не имел закономерности: нужно попасть закрытием в окно дебаунса.
    if (seq !== suggestSeqRef.current) return;
    const q = query.toLowerCase();

    // ⚠️ Дропдаун открывается СРАЗУ, до всяких ожиданий. Раньше он ждал ОБЕ загрузки —
    // историю и живые подсказки поисковика, — а сетевой части отведено 3 секунды таймаута
    // (SearchSuggestFetcher.ts). На медленной сети это означало пустоту под строкой на всё
    // это время: человек печатает, а подсказок нет вовсе. Отсюда «дропдаун появляется
    // слишком поздно».
    //
    // Показываем то, что известно без единого запроса: «искать это в интернете». Строка и так
    // будет первой в готовом списке — то есть провизорный вид не мигает чем-то посторонним, он
    // просто беднее. Как только приедут история и подсказки, список заменится целиком ниже.
    //
    // ⚠️ Выделения тут нет (setSelectedIdx(-1)): Enter в этот момент обязан вести туда же, куда
    // вёл бы без дропдауна вовсе, — на набранное. Иначе исход нажатия зависел бы от того,
    // успела ли долететь сеть.
    const provisional: SuggestItem[] = [{
      kind: 'search',
      label: `Искать: ${query}`,
      url: getSearchEngine(searchEngineId).buildUrl(query),
    }];
    setSuggestions(provisional);
    setSelectedIdx(-1);
    openDropdown();
    void window.oblako.setSuggestDropdownItems(provisional);
    void window.oblako.setSuggestDropdownHighlight(-1);

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
    // ⚠️ Условие «вкладок достаточно» переехало в main (TabSearch.MIN_TABS): поиск идёт по ВСЕМ
    // окнам, а здесь видно только своё — в лёгком окне с двумя вкладками мы молчали бы ровно
    // тогда, когда искать по другим окнам и нужно.
    // Результат приезжает отдельным обновлением списка: ждать модель, ничего не показывая, нельзя.
    const hasTabHit = deduped.some((i) => i.kind === 'tab');
    if (!hasTabHit && q.includes(' ') && q.length >= 6) {
      const smartHits = await window.oblako.searchTabsSmart(query).catch(() => [] as SmartTabHit[]);
      if (seq !== suggestSeqRef.current || smartHits.length === 0) return;
      // ⚠️ Заголовок и адрес берём ИЗ ОТВЕТА, а не из своего списка вкладок: находка может жить в
      // другом окне, и здесь о ней нет ничего (AI-IDEAS.md №8).
      const smartItems: SuggestItem[] = smartHits.map((h, idx) => ({
        kind: 'tab' as SuggestKind,
        label: h.url,
        // Про чужое окно говорим прямо: иначе переход выглядит как телепорт — окно сменилось, а
        // почему, человек не понял.
        sub: h.otherWindow ? `${h.title} — в другом окне` : h.title,
        url: h.url,
        tabId: h.tabId,
        windowId: h.otherWindow ? h.windowId : undefined,
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

  // ── Панель по клику в НЕТРОНУТУЮ строку ──────────────────────────────────────────────────────
  //
  // Заход 11: раньше здесь был плоский список часто посещаемых, и после переезда омнибокса во
  // flex-поток (строка занимает всю свободную полосу) восемь строк слева оставляли пустой всю
  // правую половину карточки. Теперь это ПАНЕЛЬ (см. OmniboxPanel в shared/ipc.ts): плитки
  // сайтов, полоска текущего сайта и «вы это уже читали».
  //
  // ⚠️ Владение выбором не меняется: suggestions остаётся ПЛОСКИМ массивом (плитки, затем
  // карточки), selectedIdx индексирует его же, Enter выполняется здесь. Вью выводит свои номера
  // из длины panel.sites — второго источника истины не появилось.
  //
  // ⚠️ Дорисовка приезжает ВТОРЫМ пакетом и только СНИЗУ. Высота карточки задаёт высоту окна
  // (reportHeight → setBounds), поэтому блок, который вставился бы ВЫШЕ уже нарисованного, увёл
  // бы плитки из-под курсора в момент, когда человек в них целится.
  //
  // ⚠️ Раньше здесь запрашивались обычные подсказки по тексту строки, а в строке лежит адрес
  // открытой страницы — поиск по истории находил её же, и дропдаун получался ЗЕРКАЛОМ: одна
  // строка, повторяющая то, что написано выше. Так же поступает Chrome: по клику он показывает
  // не отражение адреса, а то, куда человек ходит.
  //
  // ⚠️ Дедуп по САЙТУ, а не по странице: у частого сайта в истории десятки страниц, и без этого
  // весь список занял бы один домен. Внутри сайта берём страницу с лучшим frecency — та же
  // функция scoreEntry, что ранжирует обычные подсказки, второй копии правил не заводим.
  //
  // ⚠️ Открытую страницу из списка выбрасываем: предлагать переход туда, где человек и так стоит,
  // — это тот же зеркальный дропдаун, только длиннее.
  const showTopSites = useCallback(async () => {
    const seq = ++suggestSeqRef.current;
    let entries: HistoryEntry[] = [];
    try { entries = await window.oblako.getHistory(TOP_SITES_SCAN); } catch { return; }
    if (seq !== suggestSeqRef.current) return;

    const now = Date.now();
    const pageUrl = tab?.url ?? '';
    const currentKey = normalizeForOmnibox(pageUrl);
    const siteOf = (u: string): string => { try { return new URL(u).origin; } catch { return u; } };
    const best = new Map<string, HistoryEntry>();
    for (const e of entries) {
      if (normalizeForOmnibox(e.url) === currentKey) continue;
      const key = siteOf(e.url);
      const cur = best.get(key);
      if (!cur || scoreEntry(e, now) > scoreEntry(cur, now)) best.set(key, e);
    }
    const items: SuggestItem[] = [...best.values()]
      .sort((a, b) => scoreEntry(b, now) - scoreEntry(a, now))
      .slice(0, TOP_SITES_SHOWN)
      .map((e) => ({ kind: 'history' as SuggestKind, label: e.title || e.url, sub: e.url, url: e.url }));

    // Панель без плиток ещё имеет смысл — полоска сайта сама по себе полезна. Пусто И там, и там
    // (чистый профиль, новая вкладка) — вью покажет одну честную строку вместо пустой карточки.
    const hasSite = !!pageUrl && !isHub;
    const picked = recommendedRef.current;
    if (!items.length && !picked.length && !hasSite) { closeDropdown('empty-panel'); return; }

    // Плоский порядок выбора = порядок на экране: часто посещаемые, набор, потом «уже читали».
    setSuggestions([...items, ...picked]);
    // ⚠️ Ничего не предвыбираем: человек НИЧЕГО не набирал, и Enter обязан вести по адресу в
    // строке — туда же, куда вёл бы без дропдауна вовсе.
    setSelectedIdx(-1);
    openDropdown();
    void window.oblako.setSuggestDropdownPanel({ sites: items, recommended: picked });
    void window.oblako.setSuggestDropdownHighlight(-1);
    if (!hasSite) return;

    // ── Дорисовка: сведения о сайте ───────────────────────────────────────────────────────────
    // Всё, что ниже, — по одному запросу на КАЖДОЕ открытие панели, поэтому здесь только дешёвое:
    // счётчик адблока и список разрешений уже посчитаны в main, лезть за ними некуда.
    let host = '';
    try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { return; }
    const origin = (() => { try { return new URL(pageUrl).origin; } catch { return ''; } })();

    const [blocked, adblockOff, perms] = await Promise.all([
      window.oblako.getSiteBlockedCount(host).catch(() => 0),
      window.oblako.isAdblockAllowed(host).catch(() => false),
      window.oblako.listPermissions().catch(() => [] as PermissionRecord[]),
    ]);
    if (seq !== suggestSeqRef.current) return;

    const site: OmniboxPanelSite = {
      host,
      secure: pageUrl.startsWith('https://'),
      blocked,
      adblockOff,
      perms: perms.filter((p) => p.origin === origin && p.decision === 'granted').map((p) => p.permission),
      // Фраза «изменилось с прошлого раза» могла приехать на прошлом открытии панели по этому же
      // адресу — показываем сразу, второй раз страницу не разбираем (см. кэш ниже).
      changed: pageChangesRef.current.get(pageUrl),
    };
    void window.oblako.setSuggestDropdownPanel({ sites: items, recommended: picked, site, siteUrl: pageUrl });

    // ── Дорисовка: «изменилось с прошлого раза» ───────────────────────────────────────────────
    // ⚠️ РАЗ НА АДРЕС. Вызов достаёт текст живой страницы и сравнивает со снимком в истории —
    // это не то, что можно звать на каждый щелчок по адресной строке (а щёлкают по ней постоянно).
    // Ответ «нет изменений» кэшируем пустой строкой, чтобы не спрашивать повторно.
    if (!pageChangesRef.current.has(pageUrl)) {
      const changes = await window.oblako.getPageChanges().catch(() => null);
      if (seq !== suggestSeqRef.current) return;
      const phrase = changes?.changed ? (changes.summary || 'Страница изменилась') : '';
      pageChangesRef.current.set(pageUrl, phrase);
      if (phrase) {
        site.changed = phrase;
        void window.oblako.setSuggestDropdownPanel({ sites: items, recommended: picked, site, siteUrl: pageUrl });
      }
    }

    // ── Дорисовка: «вы это уже читали» ────────────────────────────────────────────────────────
    // Тот же источник, что в поповере замочка (RelatedHistory.ts). Пустой ответ — блока просто
    // нет: подсказка появляется, только когда ей есть что сказать.
    let related = relatedRef.current.get(pageUrl);
    if (!related) {
      const hits = await window.oblako.getRelatedPages().catch(() => [] as SemanticSearchResult[]);
      if (seq !== suggestSeqRef.current) return;
      related = hits.slice(0, PANEL_RELATED_MAX).map((h) => ({
        kind: 'history' as SuggestKind, label: h.url, sub: h.title || h.url, url: h.url,
      }));
      // ⚠️ Пустой ответ НЕ кэшируем — в отличие от «изменилось с прошлого раза». Связанное ищется
      // только на тёплой модели (RelatedHistory.ts), то есть пусто здесь часто означает «модель ещё
      // не прогрелась», а не «связанного нет». Запомнить такое пусто значило бы молчать про эту
      // страницу до конца сеанса. Повторный запрос на холодной модели почти бесплатен — он
      // отсекается тем же гейтом до всякой работы.
      if (related.length) relatedRef.current.set(pageUrl, related);
    }
    if (!related.length) return;
    void window.oblako.setSuggestDropdownPanel({ sites: items, recommended: picked, site, siteUrl: pageUrl, related });
    // Плоский порядок выбора: сначала плитки, следом карточки — ровно как рисует вью.
    setSuggestions([...items, ...picked, ...related]);
  }, [tab?.url, isHub, openDropdown, closeDropdown]);

  // Набор «Рекомендуемые» из настроек — один раз при монтировании. Дальше он меняется только
  // карандашом в самой панели, и мы правим ref вместе с диском (см. ниже).
  useEffect(() => {
    void window.oblako.getRecommendedSites()
      .then((list) => {
        recommendedRef.current = list.map((s) => ({
          kind: 'history' as SuggestKind, label: s.title || s.url, sub: s.url, url: s.url,
        }));
      })
      .catch(() => { /* настроек нет — набор просто пуст */ });
  }, []);

  // Правка набора карандашом (вью → main → сюда). Владелец содержимого панели один, поэтому
  // применяем, сохраняем и пересобираем панель здесь же — вью только присылает намерение.
  const showTopSitesRef = useRef(showTopSites);
  showTopSitesRef.current = showTopSites;
  useEffect(() => window.oblako.onSuggestDropdownRecommend((edit) => {
    const cur = recommendedRef.current;
    const next = edit.action === 'remove'
      ? cur.filter((s) => s.url !== edit.url)
      : cur.some((s) => s.url === edit.url)
        ? cur
        : [...cur, { kind: 'history' as SuggestKind, label: edit.title || edit.url, sub: edit.url, url: edit.url }]
            .slice(0, RECOMMENDED_MAX);
    recommendedRef.current = next;
    void window.oblako.setRecommendedSites(next.map((s) => ({ url: s.url, title: s.label })));
    void showTopSitesRef.current();
  }), []);

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
      <div className="no-drag" style={islandGroup()}>
        <button title="Назад" disabled={!tab?.canGoBack} onClick={onBack}
          style={clusterBtn({ disabled: !tab?.canGoBack })}><ArrowLeft size={18} /></button>
        <button title="Вперёд" disabled={!tab?.canGoForward} onClick={onForward}
          style={clusterBtn({ disabled: !tab?.canGoForward })}><ArrowRight size={18} /></button>
        {/* ⚠️ 18, а не 17: соседние стрелки восемнадцатые, и на глаз «Обновить» выглядела мельче
            остальных. Высоту группы это не двигает — та задана явно (ISLAND_HEIGHT). */}
        <button title="Обновить" disabled={isHub} onClick={onReload}
          style={clusterBtn({ disabled: isHub })}><RefreshCw size={18} /></button>
      </div>

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
          <div ref={omniboxPillRef} style={{
            ...islandPlate,
            display: 'flex', alignItems: 'center', gap: 8, height: ISLAND_HEIGHT,
            padding: '0 12px', borderRadius: 'var(--radius-pill)',
          }}>
            {/* ⚠️ Замок — КНОПКА, а не украшение: по нему открывается карточка сайта (соединение,
                разрешения, заблокированные трекеры, «вы это уже читали» — см. SitePopoverManager.ts).
                На хабе и в приватной вкладке остаётся прежний неактивный значок: там нет сайта,
                про который можно что-то рассказать. */}
            <button
              ref={siteControlRef}
              title={vpnOn ? 'Защита: VPN включён' : 'Защита: VPN, блокировка рекламы, сведения о сайте'}
              onClick={toggleSitePopover}
              style={{
                border: 'none', background: sitePopoverOpen ? 'var(--accent-soft)' : 'transparent',
                cursor: 'default', padding: 3, borderRadius: 'var(--radius-sm)',
                display: 'inline-flex', flex: 'none',
                // ⚠️ Зелёная ЗАЛИВКА щита = VPN поднят. Функциональный зелёный по цветовому закону
                // (--dot-vpn), и ровно тот же приём, что был у пилюли «Защита», — просьба была
                // именно про заливку, а не про точку рядом. Открытый поповер перебивает акцентом:
                // это состояние интерфейса, а не состояние защиты.
                color: sitePopoverOpen ? 'var(--accent)' : vpnOn ? 'var(--dot-vpn)' : 'var(--text-faint)',
              }}
            >
              {/* ⚠️ Щит вместо замка, и это не косметика. Кнопка отвечает на вопрос «что защищает
                  меня прямо сейчас» — соединение, вырезанные трекеры, VPN, — а замок обещает
                  только первое. Раньше на хабе и в инкогнито здесь стояла НЕКЛИКАБЕЛЬНАЯ картинка;
                  теперь кнопка живая всегда, иначе до VPN нельзя было бы добраться с новой
                  вкладки — а включают его чаще всего именно оттуда. */}
              <Shield size={14} fill={vpnOn && !sitePopoverOpen ? 'var(--dot-vpn)' : 'none'} />
            </button>
            <input
              ref={inputRef}
              value={value}
              placeholder={placeholderVisible ? 'Введите запрос или адрес' : ''}
              // ⚠️ Файл или ссылка, бро́шенные в строку, ВСТАВЛЯЮТСЯ ТЕКСТОМ, а переходит человек
              // сам по Enter — как в Edge и Chrome. Без своего обработчика тут работало поведение
              // Chromium по умолчанию, и дроп уводил браузер в отдельное голое окно без вкладок и
              // адресной строки: интерфейс — такая же веб-страница, и роняя на неё файл, человек
              // просил её никуда не годным способом «открыть». Вставка текстом оставляет решение
              // за ним и не трогает рабочее пространство.
              onDragOver={(e) => {
                // preventDefault обязателен ИМЕННО на dragover: без него drop не придёт вовсе,
                // а сработает навигация по умолчанию.
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files[0];
                // Файл → путь (его знает только preload, см. droppedFilePath). Ссылка или текст,
                // притащенные с другой страницы, — своими типами; text/uri-list может содержать
                // несколько строк и комментарии с '#', берём первую годную.
                const uriList = e.dataTransfer.getData('text/uri-list')
                  .split(/\r?\n/).find((l) => l && !l.startsWith('#'));
                const dropped = (file && window.oblako.droppedFilePath(file))
                  || uriList
                  || e.dataTransfer.getData('text/plain');
                if (!dropped) return;
                setValue(dropped);
                if (tab) draftsRef.current.set(tab.id, dropped);
                setEditing(true);
                // Выделяем целиком: брошенное чаще заменяют целиком, чем дописывают, — и это
                // ровно то состояние, из которого Enter уводит по адресу.
                requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
              }}
              onChange={(e) => {
                const v = e.target.value;
                setValue(v);
                if (tab) draftsRef.current.set(tab.id, v);
                triggerSuggest(v);
              }}
              onMouseDown={() => {
                focusTracker.current.mouseDownOnInput = true;
                pointerInInputRef.current = true;
                // Самосброс через RAF — если фокус НЕ сменился (клик в уже сфокусированное
                // поле, просто переставить курсор), onFocus не вызовется вообще и не консьюмит
                // флаг сам; без этого он завис бы «true» до следующего, уже НЕ обязательно
                // настоящего, focus-события.
                requestAnimationFrame(() => {
                  focusTracker.current.mouseDownOnInput = false;
                });

                // ⚠️ preventDefault ЗДЕСЬ БОЛЬШЕ НЕТ, и это суть починки. Он отменял нативное
                // действие мыши целиком, а вместе с ним — ВСЁ, что строка умеет мышью: протяжку
                // (получалось «выделить всё» вместо протянутого куска), установку курсора по месту
                // клика и выделение слова двойным щелчком (браузер делает его на втором нажатии,
                // а отменённое нажатие до него не доходит). Живая жалоба была именно про это.
                //
                // Chrome решает то же самое на ОТПУСКАНИИ (см. onMouseUp): нажатие лишь запоминает,
                // что строка была не в фокусе, — отличить клик от протяжки в этот момент нечем.
                // ⚠️ Подсветку предвыбранной строки здесь НЕ гасим, и это принципиально. Пробовали
                // — снимало ровно ту вещь, ради которой предвыбор и делался: набрал пару букв,
                // подсказка та самая, Enter ведёт на сайт, а не в поиск. Жалоба «выделяется
                // рекомендация, а не мой текст» была НЕ про лишнюю подсветку: выделение в строке
                // просто не рисовалось (OS-фокус в этот момент у вью подсказок, а выделение в
                // неактивном документе Chromium не показывает), и единственной видимой подсветкой
                // оставалась строка выдачи. Лечится это удержанием фокуса в чроме — см.
                // SuggestDropdownManager.showSuggestDropdown, — а не гашением подсветки.
                const el = inputRef.current;
                const unfocused = !focusTracker.current.isRealFocus || document.activeElement !== el;
                selectAllPendingRef.current = unfocused;
                // Фокус возвращаем явно: пока открыт дропдаун, чром может не иметь OS-фокуса —
                // браузер выставит activeElement, но клавиши уйдут в другую вью. Без select(),
                // выделение решается на отпускании.
                //
                // ⚠️ ЗДЕСЬ ЖЕ И ОТКРЫВАЕМ ПОДСКАЗКИ, а не в onFocus, и это не вкус. Уход на
                // страницу забирает OS-фокус у слоя хрома, но `document.activeElement` в его
                // документе ОСТАЁТСЯ полем ввода — элемент внутри документа при этом не
                // разфокусируется. Значит второй клик по строке зовёт focus() на уже
                // сфокусированном элементе, это no-op, события `focus` не будет вовсе — и прежний
                // обработчик не срабатывал никогда. Живая жалоба: с первого клика список есть, а
                // после клика по странице и возврата — нет, хотя сама строка работает.
                // Надёжный сигнал «человек зашёл в адресную строку» — нажатие мыши по ней.
                if (unfocused) {
                  el?.focus();
                  // editing тоже ставим здесь: без onFocus его некому включить, а на нём висят
                  // слушатели «клика мимо» и «фокус ушёл на контент», то есть закрыть список
                  // потом было бы нечем.
                  setEditing(true);
                  // ⚠️ «Нетронута» — это «пусто ИЛИ равно адресу вкладки», а не «пусто»: на
                  // открытой странице в строке всегда лежит её url, и проверка на пустоту не
                  // срабатывала бы почти никогда. Тот же разбор уже стоил нам молчавшей фичи
                  // «вы это уже читали» (см. RelatedHistory.ts).
                  const untouched = !value.trim() || value.trim() === (tab?.url ?? '').trim();
                  if (untouched) void showTopSites();
                  else triggerSuggest(value);
                }
                // ⚠️ Возврата OS-фокуса здесь больше нет. Он компенсировал перехват фокуса вью
                // дропдауна, а дропдаун теперь неактивируемое дочернее окно и фокус не забирает
                // вовсе (см. шапку SuggestDropdownManager.ts). Сам вызов был вреден: focus() на
                // уже сфокусированной вью доходит до нативного SetFocus и сбрасывает захват мыши,
                // то есть обрывал протяжку выделения ровно в момент её начала.
                focusTracker.current.isRealFocus = true;
              }}
              onMouseUp={() => {
                pointerInInputRef.current = false;
                if (!selectAllPendingRef.current) return;
                selectAllPendingRef.current = false;
                const el = inputRef.current;
                if (!el) return;
                // Курсор схлопнут — значит была не протяжка, а клик: выделяем адрес целиком, как
                // делает любая адресная строка. Протянутое выделение не трогаем ни в коем случае —
                // человек уже выбрал то, что хотел.
                if (el.selectionStart === el.selectionEnd) el.select();
              }}
              // ⚠️ Двойной и тройной щелчок обрабатывает САМ браузер (слово / вся строка) — своих
              // обработчиков тут нет и не нужно. Единственное, что им мешало, — отменённое
              // нажатие; см. onMouseDown.
              onFocus={() => {
                setEditing(true);
                // ⚠️ ОТКРЫТИЯ ПОДСКАЗОК ЗДЕСЬ БОЛЬШЕ НЕТ — оно переехало в onMouseDown, см. разбор
                // там. Кратко: событие `focus` приходит только когда фокус реально МЕНЯЕТСЯ, а
                // после клика по странице activeElement остаётся полем ввода, и второй клик его не
                // порождает вовсе. Открытие по нему работало ровно один раз за сеанс редактирования.
                // Здесь остаётся только editing — он нужен и при клавиатурном входе в строку.
                //
                // ⚠️ «Вы это уже читали» отсюда УБРАНО и переехало в поповер замочка
                // (SitePopoverManager.ts). Причина не в самой подсказке, а в том, что в омнибоксе
                // оказались ДВЕ фоновые AI-функции сразу: связанные страницы по клику и поиск
                // вкладки по смыслу при наборе. Модель одна, очередь на приложение одна, прервать
                // начатую генерацию нельзя — клик в строку занимал её ровно в тот момент, когда
                // человек начинал печатать, и второй подсказке доставались объедки.
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
            {/* «⋯» — действия над ЭТОЙ страницей, которым не нужна постоянная кнопка: перевод и
                отслеживание цены (само меню собирает main, см. IPC.OMNIBOX_MORE_MENU).
                ⚠️ Подсвечивается акцентом, пока перевод активен. Спрятанное в меню состояние
                иначе не видно вовсе — человек не понял бы, почему страница вдруг по-русски.
                Отслеживание цены отдельного сигнала здесь не получает: акцент в полосе один, и
                отдавать его надо тому состоянию, которое меняет саму страницу. */}
            {!isHub && tab?.url && (
              <button
                title={pageTranslateState === 'translating'
                  ? (pageTranslateProgress
                      ? `Перевожу страницу… ${Math.min(pageTranslateProgress.batchIndex + 1, pageTranslateProgress.batchCount)}/${pageTranslateProgress.batchCount} · ${pageTranslateProgress.charsStreamed} симв.`
                      : 'Перевожу страницу…')
                  : pageTranslateState === 'translated' ? 'Страница переведена — ещё действия'
                  : 'Ещё действия со страницей'}
                onClick={() => { void window.oblako.showOmniboxMoreMenu(); }}
                style={{
                  border: 'none', background: 'transparent', cursor: 'default', padding: 3,
                  borderRadius: 'var(--radius-sm)', display: 'inline-flex', flex: 'none',
                  color: pageTranslateState === 'idle' ? 'var(--text-muted)' : 'var(--accent)',
                }}
              >
                {pageTranslateState === 'translating'
                  ? <Loader2 size={14} style={{ animation: 'oblako-spin 1s linear infinite' }} />
                  : <MoreHorizontal size={14} />}
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

      {/* Правая группа. marginLeft:auto прижимает к правому краю flex-контейнера.
          ⚠️ Кнопки браузера собраны в ОДНУ плашку-остров с ПОСТОЯННЫМ набором, и это главная
          правка раскладки. Раньше здесь стояла россыпь отдельных островов, половина из которых
          появлялась и исчезала по состоянию страницы (перевод — только на реальной, буфер —
          только после первой копии). Кластер от этого менял ширину, а вместе с ним ездил
          омнибокс — прямо под курсором. Теперь недоступное ГАСНЕТ, оставаясь на месте.
          Правило, по которому решается «гасить или прятать»: условие про ОКНО прячет (лёгкое
          окно не получит AI-панель никогда, и место под неё резервировать незачем), условие про
          СТРАНИЦУ гасит. Тот же приём, что у «Обновить» на хабе. */}
      <div className="no-drag" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginLeft: 'auto' }}>
        <div style={islandGroup()}>
        {/* Полностраничный перевод (см. PageTranslateManager.ts) — только на реальной странице,
            на хабе/истории/настройках переводить нечего. idle: приглушённая иконка, как адблок
            выкл. translating: спиннер, клик игнорируется (та же неактивность по смыслу, что
            disabled у кнопки «Обновить» на хабе — просто без атрибута disabled, там же логика
            игнора живёт в PageTranslateManager.ts::togglePageTranslate). translated: подсветка
            accent-soft — тот же тон, что у открытого поповера. */}
        {/* ⚠️ Перевод страницы отсюда УЕХАЛ под «⋯» в адресной строке. Правый кластер — про
            браузер, а перевод относится к конкретной открытой странице; после переезда деление
            стало объяснимым, а слотов здесь осталось ровно три. */}
        {/* Плашка-остров остаётся — как у всех кнопок тулбара. Меняется только ТОН: в покое
            нейтральный значок на обычной плашке, ровно как «назад/вперёд/обновить»; акцент
            загорается, когда панель открыта, то есть означает состояние, а не важность. */}
        {!isLightWindow && (
          <button title="AI-панель" onClick={onToggleAiPanel} style={clusterBtn({ active: aiPanelOpen })}>
            <Sparkles size={18} />
          </button>
        )}
        {/* Буфер скопированного — рядом с загрузками намеренно: это одна группа «что я забрал со
            страниц».
            ⚠️ Прежде кнопки не было вовсе, пока буфер пуст («постоянный значок ради изредка
            нужного инструмента — лишний шум»). Решение перевёрнуто осознанно: шумом оказался как
            раз значок, ВОЗНИКАЮЩИЙ после первой копии, — он сдвигал весь кластер и омнибокс в
            произвольный момент работы. Пустой буфер теперь просто гасит кнопку. */}
        <div ref={clipboardControlRef} style={{ display: 'inline-flex' }}>
          <button
            disabled={clipboardCount === 0}
            title={clipboardCount === 0
              ? 'Скопированное со страниц — пока пусто'
              : 'Скопированное со страниц (Ctrl+Shift+B)'}
            onClick={toggleClipboardPopover}
            style={clusterBtn({ active: clipboardPopoverOpen, disabled: clipboardCount === 0 })}
          >
            <Clipboard size={18} />
          </button>
        </div>
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
            style={{ ...clusterBtn({ active: downloadsPopoverOpen }), position: 'relative' }}
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

// islandPlate/islandBtn/navBtn — вынесены в src/styles/island.ts для переиспользования
// в других панелях (История/Настройки), см. импорт наверху файла. Вписаны в текущую высоту
// тулбара (TOOLBAR_HEIGHT не меняется) — сами токены стекла/тени/скругления не подбирались
// заново, те же, что уже отлажены в поповере/AI-панели.
