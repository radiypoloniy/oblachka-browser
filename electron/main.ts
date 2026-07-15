import { app, BrowserWindow, WebContentsView, ipcMain, Menu, shell, session, dialog } from 'electron';
import { registerSchemesAsPrivileged, registerModelProtocol, registerChromeProtocol } from './AppProtocol';

// ДО app.whenReady() — Electron требует это до события ready.
registerSchemesAsPrivileged();
import type { MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { TabManager } from './TabManager';
import { SessionManager } from './SessionManager';
import { AdBlockManager } from './AdBlockManager';
import { HistoryManager } from './HistoryManager';
import { BookmarkManager } from './BookmarkManager';
import { createChromiumImporters } from './bookmarkImport/ChromiumBookmarkImporter';
import { PasswordManager } from './PasswordManager';
import { DownloadManager } from './DownloadManager';
import { PermissionManager } from './PermissionManager';
import { SettingsManager } from './SettingsManager';
import { HubChatManager } from './HubChatManager';
import { searxngSearch, buildGroundingPrompt } from './SearxngSearch';
import { IPC } from '../shared/ipc';
import type { ContentBounds, TitleBarOpts, FindResult, HistoryClearPeriod, SidebarNode, GroupNode, OrganizeCluster, SuggestDropdownItem, PasswordAddInput, PasswordUpdateInput, PasswordCopyField, PasswordGenerateOptions, HubMode, TranslationEngineId, BergamotStatus } from '../shared/ipc';
import type { SearchEngineId } from '../shared/searchEngines';
import type { SavedNode } from './SessionManager';
import { showTranslatePopover, closeTranslatePopoverOnTabSwitch, closeTranslatePopoverForClosedTab } from './TranslatePopoverManager';
import { warmup as warmupTranslation, type ChatOutcome } from './TranslationService';
import { toggleAiPanel, onTabsSynced, setTabManager, setSettingsManager as setAiPanelSettingsManager, setChromeView as setAiPanelChromeView } from './AiPanelManager';
import {
  togglePageTranslate,
  getActiveState as getPageTranslateActiveState,
  onTabsSynced as onPageTranslateTabsSynced,
  setTabManager as setPageTranslateTabManager,
  onStateChanged as onPageTranslateStateChanged,
  onProgressChanged as onPageTranslateProgressChanged,
} from './PageTranslateManager';
import { setActiveEngineId, registerEngine, setCacheManager } from './TranslationEngineRegistry';
import { BergamotTranslationEngine } from './BergamotTranslationEngine';
import { TranslationCacheManager } from './TranslationCacheManager';
import { showFindBar, closeFindBar, sendFindResult, syncFindBarBounds, relayoutFindBar, setTabManager as setFindBarTabManager } from './FindBarManager';
import { showSuggestDropdown, hideSuggestDropdown, syncOmniboxBounds, sendSuggestItems, onPick as onSuggestDropdownPick, onFirstLoad as onSuggestDropdownFirstLoad, setHighlight as setSuggestDropdownHighlight } from './SuggestDropdownManager';
import { initPasswordPopover, showPasswordPopover, closePasswordPopover, syncPasswordPopoverAnchorBounds } from './PasswordPopoverManager';
import { initVpnPopover, showVpnPopover, closeVpnPopover, syncVpnPopoverAnchorBounds } from './VpnPopoverManager';
import { fetchSearchSuggestions } from './SearchSuggestFetcher';
import * as aiKeyStore from './AiKeyStore';
import * as searxngKeyStore from './SearxngKeyStore';
import * as vpnKeyStore from './VpnKeyStore';
import * as vpnSubscription from './VpnSubscription';
import * as vpnProcess from './VpnProcess';
import { toServerMeta } from './VpnParser';
import type { VpnConnectionState } from '../shared/ipc';
import * as passwordAutofill from './PasswordAutofillManager';
import { setChromeView as setEmbedClientChromeView } from './EmbedClient';
import { indexVisit } from './HistoryIndexer';
import { startBackfill, cancelBackfill, setBackfillProgressListener } from './HistoryBackfill';
import { startContentBackfill, cancelContentBackfill, setContentBackfillProgressListener } from './HistoryContentBackfill';
import type { BackfillProgress } from '../shared/ipc';
import { searchHistorySemantic, searchHistorySmart } from './HistorySearch';

// Диагностика краша "Object has been destroyed" (exitSplit ← closeTab) на закрытии браузера со
// split — прошлый гард (isLiveHttpView в exitSplit, покрывающий self-close вкладки) НЕ закрыл
// проблему, значит падает ДРУГОЙ путь: массовый teardown при закрытии всего окна, не self-close
// одной вкладки. Полный стек + порядок destroyed-событий — см. также логи в TabManager.ts
// (wc.on('destroyed', ...), exitSplit, closeTab). Убрать после диагностики можно, но по духу
// проекта (сравни [perf]/[popover]-логи) — не обязательно, шума немного, срабатывает только
// на закрытии/split-событиях.
Error.stackTraceLimit = Infinity;
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:5173';

// Одно место: env OBLAKO_PRELOAD_EMBED=0 npm start → предзагрузка эмбеддинг-модели отключена.
// Используется в preload.ts (window.oblako.embedPreload) и для лога [startup] preload=on|off.
const EMBED_PRELOAD = process.env.OBLAKO_PRELOAD_EMBED !== '0';

// Пауза перед фоновым прогревом локальной LLM перевода (см. showWindow ниже) — даём чрому и первой
// (разбуженной) вкладке спокойно отрисоваться/догрузиться, прежде чем начинать тяжёлую загрузку
// модели (~5.7ГБ с диска + перенос в VRAM, см. TranslationService.ts::ensureLoaded). Без паузы
// загрузка стартовала бы в тот же момент, что и показ окна, — конкуренция за диск/GPU как раз в
// точке, где пользователь впервые видит интерфейс.
const TRANSLATION_WARMUP_DELAY_MS = 3000;

// Изолированные стенды AI-инфраструктурных тестов (WebGPU-эксперименты, node-llama-cpp).
// OBLAKO_GPU_TEST=1 / OBLAKO_LLAMA_TEST=1 / OBLAKO_TRANSLATE_TEST=1 npm start → вместо боевого
// окна открывается только тестовое, боевой чром (TabManager/SessionManager/adblock/history)
// не инициализируется.
const GPU_TEST = process.env.OBLAKO_GPU_TEST === '1';
const LLAMA_TEST = process.env.OBLAKO_LLAMA_TEST === '1';
const TRANSLATE_TEST = process.env.OBLAKO_TRANSLATE_TEST === '1';

// html — страница из src/*.html (Vite multi-entry, см. vite.config.ts).
// logPrefix — ASCII-тег, по которому строки console.log форвардятся в main stdout как есть;
// всё остальное (шум ORT/браузера) помечается tag:console, чтобы не путать с результатами теста.
function runIsolatedTestWindow(html: string, logPrefix: string): void {
  const testWin = new BrowserWindow({ width: 900, height: 600, show: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  testWin.webContents.on('console-message', (event: any) => {
    const msg: string = event.message ?? '';
    if (msg.startsWith(logPrefix)) process.stdout.write(msg + '\n');
    else process.stdout.write(`${logPrefix}:console ${msg}\n`);
  });
  testWin.on('closed', () => app.quit());
  testWin.loadURL(`oblako-chrome://localhost/${html}`);
}

// Тест-мост перевода: нужен свой preload (contextBridge → window.translateTest) и IPC-хендлер
// в main (node-llama-cpp работает только там) — в отличие от runIsolatedTestWindow это не просто
// read-only лог, а живое окно с вводом. Отдельный от боевого preload.ts/shared/ipc.ts.
async function runTranslateTestWindow(): Promise<void> {
  const { initTranslateTestBridge } = await import('./translateTestBridge');
  initTranslateTestBridge();

  const testWin = new BrowserWindow({
    width: 900,
    height: 700,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-translatetest.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  testWin.webContents.on('console-message', (event: any) => {
    process.stdout.write(`${event.message ?? ''}\n`);
  });
  testWin.on('closed', () => app.quit());
  testWin.loadURL('oblako-chrome://localhost/translatetest.html');
}

// t0 стартовых тайминов: фиксируем в app.whenReady, до createWindow.
let startT0 = 0;

let win: BrowserWindow | null = null;
let chromeView: WebContentsView | null = null; // слой нашего React-хрома
let tabs: TabManager | null = null;
let sess: SessionManager | null = null;
// Последний присланный прямоугольник омнибокса (см. IPC.OMNIBOX_SET_BOUNDS) — пока без
// потребителя, только хранится для будущей нативной вью дропдауна подсказок.
let omniboxBounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
// Взводится ДО того, как tabs/sess начинают асинхронно обнуляться/дозакрываться (win.on('close')/
// before-quit) — сигнал побочным подписчикам onChange (сейчас только AiPanelManager.onTabsSynced)
// не синкаться во время выхода: AI-панель и так исчезает вместе с окном, а сама TabManager к этому
// моменту может уже дотла закрывать вкладки асинхронно. НЕ влияет на финальный автосейв — тот
// синхронный (win.on('close') ниже), от этого флага не зависит.
let isShuttingDown = false;
const adblock     = new AdBlockManager();
const history     = new HistoryManager();
const bookmarks   = new BookmarkManager();
// Импорт закладок — список создаётся один раз, isAvailable() зовётся заново на каждый
// BOOKMARK_IMPORT_LIST_SOURCES (профиль браузера-источника может появиться/пропасть между вызовами).
const bookmarkImporters = createChromiumImporters(bookmarks);
const passwords   = new PasswordManager();
const downloads   = new DownloadManager();
const permissions = new PermissionManager();
const settings    = new SettingsManager();
const hubChat     = new HubChatManager();
const translationCache = new TranslationCacheManager();

// Применяем сохранённый выбор движка перевода СРАЗУ на старте (до первого клика «Перевести
// страницу») — см. TranslationEngineRegistry.ts. Дефолт остаётся 'qwen' (см. SettingsManager.ts) —
// переключатель в Settings.tsx позволяет выбрать 'bergamot' явно.
setActiveEngineId(settings.getTranslationEngine());
setAiPanelSettingsManager(settings); // ширина дока (заход 3) — персист через тот же SettingsManager

// Bergamot регистрируется в registry независимо от того, что сейчас активно, — так реестр может
// откатиться на него/с него в любой момент смены настройки без пересоздания движка. Прогревается
// (warmupBergamot ниже) тоже независимо от активного выбора — иначе Settings.tsx не смог бы
// показать актуальный статус ДО того, как пользователь попробует переключиться (см. живой план,
// Этап 3: "supportsPair/isReady возвращают false... в UI пометка «модель перевода не загружена»").
// Фолбэк-путь к бандлу моделей (см. BergamotWorkerEntry.ts/scripts/download-translation-models.mjs) —
// тот же приём packaged/dev, что resolveModelsBase в AppProtocol.ts.
const bergamotBundledModelsDir = app.isPackaged
  ? path.join(process.resourcesPath, 'models', 'translation')
  : path.join(__dirname, '../../resources', 'models', 'translation');
const bergamotEngine = new BergamotTranslationEngine(app.getPath('userData'), bergamotBundledModelsDir);
registerEngine(bergamotEngine);

let bergamotStatus: BergamotStatus = 'loading';
function pushBergamotStatus(status: BergamotStatus): void {
  bergamotStatus = status;
  chromeView?.webContents.send(IPC.TRANSLATION_ENGINE_BERGAMOT_STATUS_CHANGED, status);
}
async function warmupBergamot(): Promise<void> {
  try {
    await bergamotEngine.warmup();
    pushBergamotStatus('ready');
  } catch (e) {
    // Ожидаемый исход, если файлов моделей ещё нет на диске (см. README — Bergamot) или воркер
    // не смог подняться — НЕ бросаем дальше: TranslationEngineRegistry.getActiveEngine() сам
    // тихо откатится на Qwen (isReady()===false), а UI покажет "модель перевода не загружена".
    console.error('[bergamot] прогрев упал, движок недоступен:', e);
    pushBergamotStatus('unavailable');
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#E7E9F4', // совпадает с --app-bg, чтобы не мигало белым
    // Кастомный titlebar: системные кнопки в своём оформлении (спека, тех.стек).
    // show:false — против белого экрана: окно покажем, когда React-оболочка отрисуется
    // (сигнал CHROME_UI_READY из src/main.tsx), с fallback-таймаутом ниже.
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#E7E9F4',   // --app-bg светлой темы; обновляется через IPC при смене темы
      symbolColor: '#46443F',
      height: 56,
    },
  });

  // Слой хрома (сайдбар+тулбар+хаб) — обычный WebContentsView во всё окно.
  chromeView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload использует ipcRenderer — sandbox off только для хрома
    },
  });
  win.contentView.addChildView(chromeView);
  setEmbedClientChromeView(chromeView); // заход G: мост эмбеддингов слушает этот же chromeView
  setAiPanelChromeView(chromeView); // заход 3: push'и состояния дока (открыт/закрыт) идут сюда, не в win.webContents
  // Дефолтный фон WebContentsView — белый, и он перекрывает backgroundColor окна на всю площадь.
  // Красим под --app-bg, чтобы кадры до первой отрисовки React были цветом интерфейса.
  chromeView.setBackgroundColor('#E7E9F4');

  // Показ окна: ждём сигнал «оболочка отрисована» (useEffect+rAF в src/main.tsx). Fallback-таймаут
  // обязателен — если сигнал не пришёл (упал preload/React, Vite ещё не поднялся в dev),
  // окно всё равно должно появиться, а не висеть невидимым.
  {
    const thisWin = win;
    let shown = false;
    const showWindow = (reason: string) => {
      if (shown) return;
      shown = true;
      clearTimeout(fallbackTimer);
      ipcMain.removeListener(IPC.CHROME_UI_READY, onUiReady);
      if (!thisWin.isDestroyed()) {
        thisWin.show();
        console.log(`[startup] show reason=${reason} ${Date.now() - startT0}ms`);
      }
      // Фоновый прогрев локальной LLM (перевод/AI-действия/чат) — только теперь, когда окно уже
      // реально показано, и с задержкой (см. TRANSLATION_WARMUP_DELAY_MS): не соревнуется за
      // диск/GPU с первой отрисовкой чрома и пробуждением активной вкладки. warmupTranslation()
      // сама не блокирует и не бросает наружу — ensureLoaded() внутри дедуплицирует конкурентные
      // вызовы (см. её же комментарий), так что ранний клик пользователя по AI-функции просто
      // дождётся ЭТОЙ ЖЕ загрузки, а не запустит вторую.
      setTimeout(() => {
        if (!thisWin.isDestroyed()) void warmupTranslation();
        // Bergamot — свой воркер (см. BergamotService.ts), не конкурирует с Qwen за VRAM/диск,
        // но всё равно на той же задержке: не соревнуется с первой отрисовкой чрома.
        void warmupBergamot();
      }, TRANSLATION_WARMUP_DELAY_MS);
    };
    const onUiReady = () => showWindow('ui-ready');
    ipcMain.once(IPC.CHROME_UI_READY, onUiReady);
    const fallbackTimer = setTimeout(() => showWindow('fallback-timeout'), 3000);
    // Окно закрыли до показа (или до сигнала) — подчистить, чтобы таймер/слушатель не дёргали труп.
    thisWin.on('closed', () => {
      shown = true;
      clearTimeout(fallbackTimer);
      ipcMain.removeListener(IPC.CHROME_UI_READY, onUiReady);
    });
  }

  const layoutChrome = () => {
    if (!win || !chromeView) return;
    const { width, height } = win.getContentBounds();
    chromeView.setBounds({ x: 0, y: 0, width, height });
  };
  layoutChrome();
  win.on('resize', layoutChrome);

  // Орфография (ru+en): одна сессия на все вкладки — одного вызова достаточно.
  session.defaultSession.setSpellCheckerLanguages(['ru', 'en-US']);

  // Перехватываем все загрузки на дефолтной сессии (вкладки partition не задают).
  downloads.attach(session.defaultSession, (entries) => {
    chromeView?.webContents.send(IPC.DOWNLOADS_CHANGED, entries);
  });

  // Разрешения: оба хендлера на дефолтной сессии. Инкогнито (будущее) — отдельный attach.
  permissions.attach(session.defaultSession, (req) => {
    // Входящий запрос разрешения занимает то же место, что FindBar — закрываем его (та же логика,
    // что раньше жила в App.tsx::onPermissionRequest, до переезда FindBar в отдельную WebContentsView).
    tabs?.stopFind();
    closeFindBar();
    chromeView?.webContents.send(IPC.PERMISSION_REQUEST, req);
  });

  // Загружаем сохранённую сессию ДО создания TabManager.
  sess = new SessionManager();
  const restored = sess.load();

  // При любом изменении: обновляем UI и планируем сохранение сессии.
  // scheduleSave молча игнорирует вызовы до sess.enable() — это защита
  // от затирания: onChange стреляет во время restore, но сохранять ещё нельзя.
  tabs = new TabManager(
    win,
    () => {
      // РЕГРЕССИЯ (заход 3, починено): tabs!.snapshot() раньше жил ВНУТРИ chromeView?.webContents.send(...) —
      // optional chaining короткого замыкания там пропускал вычисление ВСЕХ аргументов целиком,
      // если chromeView===null (а он обнуляется синхронно вместе с tabs в win.on('closed')), так что
      // .snapshot() неявно никогда не звался на null. Вынос в отдельную const убрал эту неявную
      // защиту — .snapshot() стал звонить на tabs===null во время закрытия (часть вкладок
      // дозакрывается асинхронно уже ПОСЛЕ win.on('closed')). Явный гард вместо неявного:
      if (!tabs) return;
      // Атомарный push: tabs и nodes в одном сообщении → один рендер, нет рассинхрона.
      const tabsSnapshot = tabs.snapshot();
      chromeView?.webContents.send(IPC.SYNC_CHANGED, {
        tabs: tabsSnapshot,
        nodes: tabs.sidebarNodesSnapshot(),
        hasOrganizeSnapshot: tabs.hasOrganizeSnapshot(),
      });
      // Тот же снапшот — источник правды для привязки чата AI-панели к вкладке (переключение/
      // закрытие/смена URL), без новых колбэков в TabManager.ts (см. AiPanelManager.ts). Не во
      // время выхода — AI-панель и так исчезает вместе с окном, синкать её незачем.
      if (!isShuttingDown) onTabsSynced(tabsSnapshot);
      // Тот же снапшот — привязка полностраничного перевода к активной вкладке (сброс состояния
      // на навигацию/закрытие, см. PageTranslateManager.ts::onTabsSynced), тот же принцип.
      if (!isShuttingDown) onPageTranslateTabsSynced(tabsSnapshot);
      // Тот же снапшот — чистка in-memory контекстов AI-чата Hub по закрытым вкладкам
      // (см. HubChatManager.ts::pruneClosedTabs, тот же принцип, что onTabsSynced выше).
      hubChat.pruneClosedTabs(new Set(tabsSnapshot.map((t) => t.id)));
      // sess?. — не «отменяет» финальное сохранение: оно гарантированно уже прошло синхронно
      // в win.on('close') ДО того, как sess обнуляется в win.on('closed') (см. ниже). Этот вызов
      // подчистую сработает во время закрытия окна — часть вкладок ещё дозакрывается асинхронно
      // (destroyed-события уже после win.on('closed')) и без ?. падал на null.scheduleSave.
      // tabs?. в колбэке — scheduleSave стреляет через debounce (1.5с), tabs может обнулиться
      // МЕЖДУ планированием и срабатыванием таймера (окно закрылось в этот промежуток).
      sess?.scheduleSave(() => tabs?.getSessionSnapshot() ?? null);
    },
    // FindBar — теперь отдельная WebContentsView (FindBarManager.ts), не React в chromeView.
    // Сам поиск (findInPage/found-in-page) не меняется — меняется только, куда идёт push
    // результата и что открывает/закрывает панель.
    (r: FindResult) => sendFindResult(r),
    ()              => { if (win && tabs?.getActiveWebContents()) showFindBar(win); }, // Ctrl+F: не открываем на хабе (getActiveWebContents()===null)
    ()              => { tabs?.stopFind(); closeFindBar(); tabs?.focusActiveView(); }, // Esc-на-странице/did-navigate — вернуть OS-фокус, иначе Ctrl+F повторно не долетит
    ()              => chromeView?.webContents.send(IPC.OMNIBOX_FOCUS),
    ()              => chromeView?.webContents.focus(),
    (url, title, wc) => {
      history.recordVisit(url, title);
      // Заход G, блок 3: индексация эмбеддингом — только на визит (не на updateTitle ниже,
      // который может стрелять много раз на SPA, см. HistoryManager.ts::updateTitle — это
      // спамило бы единственный embed-воркер на каждое SPA-обновление заголовка одной страницы).
      // wc — вкладка, которая реально навигировала (заход на обогащение контентом страницы),
      // не обязательно активная — HistoryIndexer сам ждёт её догрузки перед извлечением.
      // Fire-and-forget с внешним .catch — indexVisit сама не должна бросать (try/catch на
      // каждом уровне), но лишняя страховка здесь ничего не стоит.
      void indexVisit(history, url, title, wc).catch((e: unknown) =>
        console.warn('[HistoryIndexer] неожиданная ошибка:', e),
      );
    },
    (url, title)    => history.updateTitle(url, title),
    ()              => chromeView?.webContents.send(IPC.HISTORY_OPEN),
    ()              => console.log(`[startup] firsttab ${Date.now() - startT0}ms`),
    (action, text, rect, wc) => {
      // Поповер у выделения, поверх контента (см. TranslatePopoverManager.ts) — не панель в чроме.
      // Ленивый: WebContentsView+preload поповера создаются только этим вызовом. Один поповер на
      // все AI-действия (перевод/выжимка/пересказ/объяснение) — action меняет только промпт.
      if (win) showTranslatePopover(win, action, text, rect, wc);
    },
    // Заход 6: дропдаун подсказок — та же логика, что у поповера/FindBar (анкерен к прежней
    // вкладке, безусловный main-side хук на КАЖДУЮ реальную смену активной, а не только
    // renderer-side реакция на смену tab.id — та могла разойтись с фактом прикрепления вью).
    () => {
      console.log('[DD] onActiveTabChangedCb fired'); // ВРЕМЕННЫЙ лог диагностики
      closeTranslatePopoverOnTabSwitch(); closeFindBar(); hideSuggestDropdown(); closePasswordPopover(); closeVpnPopover();
      // Менеджер паролей, шаг 2: индикатор в omnibox всегда про АКТИВНУЮ вкладку — пересылаем
      // её текущее состояние (или null) при каждом реальном переключении.
      passwordAutofill.onActiveTabChanged();
    },
    (wc, tabId) => { closeTranslatePopoverForClosedTab(wc); closePasswordPopover(); closeVpnPopover(); passwordAutofill.onTabClosed(tabId); },
    // Заход 5: реальный клик в контент вкладки (не blur омнибокса) — закрывает дропдаун подсказок
    // в chrome, см. shared/ipc.ts::SUGGEST_DROPDOWN_CONTENT_FOCUS, Toolbar.tsx.
    () => {
      console.log('[DD] onContentFocusCb fired (tab wc gained OS focus)'); // ВРЕМЕННЫЙ лог диагностики
      chromeView?.webContents.send(IPC.SUGGEST_DROPDOWN_CONTENT_FOCUS);
      closePasswordPopover();
      closeVpnPopover();
    },
    // Менеджер паролей, шаг 2, коммит 2 — сигналы content-preload идут в PasswordAutofillManager,
    // который сверяется с сейфом и решает, показывать ли индикатор/поповер.
    (tabId, hasLoginForm, hasUsernameField, url) => passwordAutofill.handleFormDetected(tabId, hasLoginForm, hasUsernameField, url),
    (tabId, username, password, url) => passwordAutofill.handleCredentialSubmitted(tabId, username, password, url),
    // Иконка в поле пароля — та же карточка, что у тулбарной иконки-ключа (PasswordPopoverManager),
    // просто заякорена на позицию поля. rect приходит в координатах вьюпорта СТРАНИЦЫ —
    // прибавляем bounds именно ЭТОЙ вкладки (не активной вообще — split может показывать другую).
    (tabId, rect, url) => {
      const state = passwordAutofill.handleFieldIconClick(tabId, url);
      if (!state || !win || !tabs) return;
      const viewBounds = tabs.getTabViewBounds(tabId);
      syncPasswordPopoverAnchorBounds({
        x: viewBounds.x + rect.x, y: viewBounds.y + rect.y,
        width: rect.width, height: rect.height,
      });
      showPasswordPopover(win, state);
    },
  );
  // Применяем сохранённый выбор поисковика (дефолт duckduckgo, если настройки ещё нет).
  tabs.setSearchEngine(settings.getSearchEngine());
  // Единственная точка, где AiPanelManager получает доступ к вкладкам — только для чтения
  // WebContents активной вкладки при извлечении текста страницы в чат (Заход 4), см.
  // TabManager.getActiveWebContents(). Не влияет на управление вкладками.
  setTabManager(tabs);
  // Аналогично для FindBarManager — только чтобы вернуть OS-фокус активной вкладке после
  // закрытия по IPC (крестик/Esc-в-поле), см. FindBarManager.ts::ensureIpcRegistered.
  setFindBarTabManager(tabs);
  // Аналогично — PageTranslateManager читает WebContents активной вкладки для обхода DOM/
  // применения перевода (executeJavaScript), не управляет вкладками.
  setPageTranslateTabManager(tabs);
  onPageTranslateStateChanged((state) => {
    chromeView?.webContents.send(IPC.PAGE_TRANSLATE_STATE_CHANGED, state);
  });
  onPageTranslateProgressChanged((progress) => {
    chromeView?.webContents.send(IPC.PAGE_TRANSLATE_PROGRESS_CHANGED, progress);
  });
  initPasswordPopover(() => chromeView?.webContents.send(IPC.PASSWORD_POPOVER_CLOSED));
  initVpnPopover(() => chromeView?.webContents.send(IPC.VPN_POPOVER_CLOSED));
  // Менеджер паролей, шаг 2: индикатор push идёт в chrome (не в конкретную вкладку) —
  // PASSWORDS_CHANGED переиспользует существующий канал шага 1 (список в Settings→Пароли).
  passwordAutofill.init(
    tabs,
    passwords,
    (state) => chromeView?.webContents.send(IPC.PASSWORDS_INDICATOR_CHANGED, state),
    () => chromeView?.webContents.send(IPC.PASSWORDS_CHANGED),
  );

  // Восстанавливаем вкладки из session.json (v4: nodes[] с группами; v1/v2/v3 мигрированы).
  if (restored) {
    // Закреплённые сначала — стабильный порядок, всегда вверху сайдбара.
    const pinnedIds: string[] = [];
    const pinnedUrlToId = new Map<string, string>();
    for (const { url, faviconData } of restored.pinnedTabs) {
      const id = tabs.createPinnedTab(url, faviconData);
      pinnedIds.push(id);
      pinnedUrlToId.set(url, id);
    }

    // Рекурсивно создаём вкладки из дерева узлов и строим urlToIds (очередь на случай дублей URL).
    // Ленивое восстановление: все обычные вкладки создаются СПЯЩИМИ (createSleepingTab — без
    // WebContentsView и без loadURL). Активную (и вторую панель split, если активна пара) разбудит
    // tabs.activate(targetId) ниже — уже существующий wake-путь (wakeTab), трогать его не нужно:
    // он одинаково умеет будить и "давно уснувшую", и "рождённую спящей" вкладку.
    const urlToIds = new Map<string, string[]>();
    const collectTabs = (nodes: SavedNode[]) => {
      for (const node of nodes) {
        if (node.type === 'single') {
          // Seed title/faviconData из файла (v5) — если файл ещё v4/пуст, оба undefined и
          // createSleepingTab сам фоллбэкнет на домен/null. НЕ путать с доменом: если поле
          // есть в файле — это настоящие данные, накопленные в прошлых сеансах.
          const id = tabs!.createSleepingTab(node.url, node.title, node.faviconData);
          const list = urlToIds.get(node.url) ?? [];
          list.push(id); urlToIds.set(node.url, list);
        } else if (node.type === 'split-pair') {
          const lId = tabs!.createSleepingTab(node.leftUrl, node.leftTitle, node.leftFaviconData);
          const rId = tabs!.createSleepingTab(node.rightUrl, node.rightTitle, node.rightFaviconData);
          const lList = urlToIds.get(node.leftUrl)  ?? []; lList.push(lId); urlToIds.set(node.leftUrl,  lList);
          const rList = urlToIds.get(node.rightUrl) ?? []; rList.push(rId); urlToIds.set(node.rightUrl, rList);
        } else if (node.type === 'group') {
          collectTabs(node.children);
        }
      }
    };
    collectTabs(restored.nodes);

    // Перестраиваем дерево узлов по сохранённой структуре (с группами, парами).
    tabs.rebuildNodeTree(restored.nodes, urlToIds);

    // Активная вкладка по activeRef.
    const ref = restored.activeRef;
    let targetId: string | undefined;
    if (ref.type === 'pinned') {
      targetId = pinnedIds[ref.index];
    } else if (ref.type === 'url') {
      // v4-формат: URL уникально идентифицирует вкладку.
      targetId = urlToIds.get(ref.url)?.[0] ?? pinnedUrlToId.get(ref.url);
    } else if (ref.type === 'normal') {
      // v3-формат: плоский nodeIndex в сериализованном списке без групп.
      // Так как v3 не имел групп, flattenNodes() совпадает с порядком nodes.
      const flatNodes = tabs.snapshot().filter((t) => !t.isHub && !t.isPinned);
      targetId = flatNodes[ref.nodeIndex]?.id;
    } else if (ref.type === 'split') {
      // v3-формат: split с nodeIndex и side.
      const flatNodes = tabs.snapshot().filter((t) => !t.isHub && !t.isPinned);
      const paired = flatNodes.filter((t) => t.splitSide !== null);
      const target = ref.side === 'left'
        ? paired.find((t) => t.splitSide === 'left')
        : paired.find((t) => t.splitSide === 'right');
      targetId = target?.id;
    }
    // ref.type === 'hub' → остаёмся на хабе (дефолт TabManager).
    if (targetId) tabs.activate(targetId);

    // Диагностика ленивого восстановления: сколько вкладок реально восстановилось (сверить с
    // числом вкладок в session.json — ни одна не должна потеряться) и сколько из них уснувших.
    const restoredSnapshot = tabs.snapshot().filter((t) => !t.isHub);
    const sleepingCount = restoredSnapshot.filter((t) => t.isSleeping).length;
    console.log(
      `[startup] restore: pinned=${pinnedIds.length} tabs=${restoredSnapshot.length} ` +
      `sleeping=${sleepingCount} awake=${restoredSnapshot.length - sleepingCount} ${Date.now() - startT0}ms`,
    );
  }

  // Только после восстановления разрешаем автосейв.
  sess.enable();

  // Форвардинг логов воркера эмбеддингов из renderer → stdout.
  // Новый API Electron: событие console-message передаёт поля через Event-объект.
  const LOG_PREFIXES = ['[embed]'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chromeView.webContents.on('console-message', (event: any) => {
    const msg: string = event.message ?? '';
    if (LOG_PREFIXES.some((p) => msg.startsWith(p))) process.stdout.write(msg + '\n');
  });

  // ПКМ в хром-слое (омнибокс, поле чата): только редактируемые поля и выделение.
  // Для обычных элементов управления (кнопки, сайдбар) меню НЕ показываем.
  chromeView.webContents.on('context-menu', (_e, p) => {
    const items: MenuItemConstructorOptions[] = [];
    if (p.isEditable) {
      items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' });
    } else if (p.selectionText.trim()) {
      items.push({ role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win! });
  });

  // Хоткеи для хром-слоя (хаб, омнибокс). Вкладки получают их через wirePageEvents.
  tabs.registerHotkeyHandler(chromeView.webContents);

  // Таймер окна: did-finish-load chromeView = React-UI загружен и отрисован.
  chromeView.webContents.once('did-finish-load', () => {
    console.log(`[startup] window ${Date.now() - startT0}ms`);
  });

  if (isDev) {
    chromeView.webContents.loadURL(DEV_URL);
    chromeView.webContents.openDevTools({ mode: 'detach' });
  } else {
    // oblako-chrome:// вместо file:// → COOP/COEP заголовки → crossOriginIsolated=true → SAB → WASM-потоки
    chromeView.webContents.loadURL('oblako-chrome://localhost/index.html');
  }

  // Финальный синхронный снапшот СЮДА, а не в app.on('before-quit'): на Windows/Linux
  // window-all-closed зовёт app.quit() уже ПОСЛЕ того, как это окно закрылось — то есть
  // before-quit неизбежно видит win/tabs/sess уже обнулёнными (см. win.on('closed') ниже) и
  // реально ничего не сохраняет. 'close' — единственная точка, где всё ещё гарантированно живо.
  win.on('close', () => {
    isShuttingDown = true; // до сохранения — далее tabs/sess ещё какое-то время живы, но выходим
    console.log('[shutdown] win close: старт, isShuttingDown=true, сохраняю сессию');
    if (tabs && sess) sess.saveNow(tabs.getSessionSnapshot());
    console.log('[shutdown] win close: сессия сохранена');
    // Windows не убивает дочерние процессы автоматически при выходе родителя — без явной
    // остановки xray.exe продолжил бы висеть в фоне (и туннелировать трафик) уже после
    // закрытия браузера. Fire-and-forget — не блокируем закрытие окна ожиданием.
    void vpnProcess.stop();
  });

  win.on('closed', () => {
    console.log('[shutdown] win closed: обнуляю win/chromeView/tabs/sess');
    win = null; chromeView = null; tabs = null; sess = null;
    setEmbedClientChromeView(null); // заход G: мост эмбеддингов больше не должен слать в мёртвый webContents
  });
}

// VPN, шаг 3 — единственное место, которое решает, куда идёт ВЕСЬ трафик вкладок
// (session.defaultSession — общая сессия для всех обычных вкладок, см. downloads/permissions
// .attach() выше). Держим рядом с остальной VPN-проводкой (registerIpc), не размазываем.
//
// ⚠️ Fail-closed — осознанный выбор, не поведение Electron/Chromium по умолчанию: при
// неожиданном падении Xray ПОСЛЕ успешного подключения НЕ откатываемся молча на прямое
// соединение — это дало бы ложное чувство защиты (пользователь думает, что VPN включён, а
// трафик уже идёт напрямую). Вместо этого блокируем весь трафик, пока пользователь явно не
// переподключится или не нажмёт «Отключить». 127.0.0.1:1 — заведомо мёртвый локальный порт
// (никогда не совпадает с реальным SOCKS-портом Xray, туда в принципе никто не слушает) —
// любой запрос через такой "прокси" гарантированно проваливается, а не тихо идёт мимо него.
const VPN_KILL_SWITCH_PROXY_RULES = 'socks5://127.0.0.1:1';

function applyVpnProxy(): void {
  const state = vpnProcess.getState();
  const port = vpnProcess.getLocalSocksPort();
  const proxyRules = state === 'running' && port
    ? `socks5://127.0.0.1:${port}`
    : state === 'error'
      ? VPN_KILL_SWITCH_PROXY_RULES
      : 'direct://'; // 'stopped'/'starting' — обычный режим, VPN не задействован
  void session.defaultSession.setProxy({ proxyRules });
}

// ── IPC: renderer (хром) управляет движком вкладок ──
function registerIpc() {
  ipcMain.handle(IPC.SYNC_GET, () => ({
    tabs:  tabs?.snapshot()              ?? [],
    nodes: tabs?.sidebarNodesSnapshot() ?? [],
    hasOrganizeSnapshot: tabs?.hasOrganizeSnapshot() ?? false,
  }));
  ipcMain.handle(IPC.TABS_GET_ALL, () => tabs?.snapshot() ?? []);
  ipcMain.handle(IPC.TAB_CREATE, (_e, url?: string) => tabs?.createTab(url));
  ipcMain.handle(IPC.TAB_CREATE_SPECIAL, (_e, kind: 'history' | 'settings' | 'bookmarks') => tabs?.createSpecialTab(kind));
  ipcMain.handle(IPC.TAB_CLOSE, (_e, id: string) => tabs?.closeTab(id));
  ipcMain.handle(IPC.TAB_ACTIVATE, (_e, id: string) => tabs?.activate(id));
  ipcMain.handle(IPC.TAB_NAVIGATE, (_e, id: string, input: string) => tabs?.navigate(id, input));
  ipcMain.handle(IPC.TAB_GO_BACK, (_e, id: string) => tabs?.goBack(id));
  ipcMain.handle(IPC.TAB_GO_FORWARD, (_e, id: string) => tabs?.goForward(id));
  ipcMain.handle(IPC.TAB_RELOAD, (_e, id: string) => tabs?.reload(id));
  ipcMain.handle(IPC.CONTENT_SET_BOUNDS, (_e, b: ContentBounds) => {
    tabs?.setContentBounds(b);
    // Та же геометрия двигает FindBar — центрирование по контентной зоне (учитывает сайдбар) и
    // авто-скрытие при настройках/истории/загрузках (нулевые bounds — тот же сентинел, см. FindBarManager.ts).
    syncFindBarBounds(b);
  });
  // Прямоугольник омнибокса — двигает нативную вью дропдауна подсказок (см.
  // shared/ipc.ts::IPC.OMNIBOX_SET_BOUNDS, SuggestDropdownManager.ts) — старый chrome-DOM
  // дропдаун этот канал не читает, продолжает позиционироваться от toolbarRef как раньше.
  ipcMain.handle(IPC.OMNIBOX_SET_BOUNDS, (_e, b: ContentBounds) => {
    omniboxBounds = b;
    console.log(`[omnibox] bounds: ${JSON.stringify(b)}`);
    syncOmniboxBounds(b);
  });
  // Тумблер показа вью дропдауна — вешается на тот же момент, что и старый React-дропдаун
  // (Toolbar.tsx::openDropdown/closeDropdown), который пока не заменяет (работают параллельно).
  ipcMain.handle(IPC.SUGGEST_DROPDOWN_TOGGLE, (_e, open: boolean) => {
    console.log(`[DD] main received SUGGEST_DROPDOWN_TOGGLE open=${open}`); // ВРЕМЕННЫЙ лог диагностики
    if (open) {
      if (win) showSuggestDropdown(win);
      // addChildView (внутри showSuggestDropdown) спонтанно уводит OS-фокус с омнибокса — это
      // задокументировано в SuggestDropdownManager.ts/Toolbar.tsx как «безобидное» для ЛОГИКИ
      // закрытия (blur там не триггерит закрытие), но саму КЛАВИАТУРУ никто обратно не возвращал:
      // removeChildView (hideSuggestDropdown) отдаёт фокус омнибоксу спонтанно сам, а вот у
      // addChildView симметричной пары нет — значит с момента первого показа дропдауна и до его
      // закрытия <input> реально не имеет OS-фокуса, и следующие нажатия клавиш никуда не долетают
      // (нужен повторный клик). Тот же приём, что уже используется на Ctrl+L (см. выше в этом же
      // файле) — .focus() возвращает OS-фокус вебконтентам чрома, а какой именно DOM-элемент внутри
      // него был активен — помнит сам renderer, довозвращать вручную не нужно.
      chromeView?.webContents.focus();
    } else {
      hideSuggestDropdown();
    }
  });
  ipcMain.handle(IPC.PASSWORD_POPOVER_SET_BOUNDS, (_e, b: ContentBounds) => {
    syncPasswordPopoverAnchorBounds(b);
  });
  ipcMain.handle(IPC.PASSWORD_POPOVER_SHOW, (_e, state) => {
    if (win) showPasswordPopover(win, state);
  });
  ipcMain.handle(IPC.PASSWORD_POPOVER_CLOSE, () => {
    closePasswordPopover();
  });
  ipcMain.handle(IPC.VPN_POPOVER_SET_BOUNDS, (_e, b: ContentBounds) => {
    syncVpnPopoverAnchorBounds(b);
  });
  ipcMain.handle(IPC.VPN_POPOVER_SHOW, () => {
    if (win) showVpnPopover(win);
  });
  ipcMain.handle(IPC.VPN_POPOVER_CLOSE, () => {
    closeVpnPopover();
  });
  // ВРЕМЕННЫЙ канал диагностики залипания дропдауна — см. preload.ts::ddlog. Удалить вместе с ним.
  ipcMain.on('dd-log', (_e, msg: string) => console.log(`[DD] ${msg}`));
  // Живой список подсказок (заход 3/5) — buildSuggestions в Toolbar.tsx шлёт тот же массив,
  // что кладёт в setSuggestions() для старого дропдауна; main пересылает его во вью.
  ipcMain.handle(IPC.SUGGEST_DROPDOWN_SET_ITEMS, (_e, items: SuggestDropdownItem[]) => {
    sendSuggestItems(items);
  });
  // Клик по строке ВО вью дропдауна (другой webContents) — пересылаем в chrome, где Toolbar.tsx
  // вызывает свой существующий pickSuggestion(), не дублируя его поведение (activateTab/навигация).
  onSuggestDropdownPick((item) => { chromeView?.webContents.send(IPC.SUGGEST_DROPDOWN_PICKED, item); });
  // Живой баг: на самый первый показ дропдауна за жизнь окна .focus() ниже (в обработчике
  // SUGGEST_DROPDOWN_TOGGLE) проигрывает гонку — сама вью только создаётся и грузится
  // асинхронно, что-то в этом процессе перехватывает фокус ПОСЛЕ него. На все следующие показы
  // вью уже готова, гонки нет. Досылаем фокус ещё раз, когда именно ЭТА, первая, загрузка
  // реально завершилась (см. onFirstLoad в SuggestDropdownManager.ts).
  onSuggestDropdownFirstLoad(() => chromeView?.webContents.focus());
  // Клавиатурная подсветка (заход 4/5) — омнибокс шлёт номер строки (-1 снимает), main просто
  // пересылает во вью; выбор (Enter) остаётся локальным в омнибоксе, эта вью в нём не участвует.
  ipcMain.handle(IPC.SUGGEST_DROPDOWN_HIGHLIGHT, (_e, idx: number) => {
    setSuggestDropdownHighlight(idx);
  });
  ipcMain.handle(IPC.WINDOW_SET_OVERLAY, (_e, opts: TitleBarOpts) => win?.setTitleBarOverlay(opts));
  ipcMain.handle(IPC.FIND_START, (_e, q: string, fwd: boolean) => tabs?.findInPage(q, fwd));
  ipcMain.handle(IPC.FIND_NEXT,  (_e, fwd: boolean)            => tabs?.findNext(fwd));
  ipcMain.handle(IPC.FIND_STOP,  ()                            => tabs?.stopFind());

  ipcMain.handle(IPC.TAB_PIN_TOGGLE, (_e, id: string) => tabs?.togglePin(id));

  // Split View
  ipcMain.handle(IPC.TAB_ENTER_SPLIT, (_e, rightId: string)         => tabs?.enterSplit(rightId));
  ipcMain.handle(IPC.TAB_EXIT_SPLIT,  ()                            => tabs?.exitSplit());
  ipcMain.handle(IPC.TAB_SPLIT_FOCUS, (_e, side: 'left' | 'right') => tabs?.focusSplitPanel(side));
  ipcMain.handle(IPC.TAB_SPLIT_RATIO, (_e, ratio: number)           => tabs?.setSplitRatio(ratio));

  ipcMain.handle(IPC.TAB_REORDER,
    (_e, section: 'normal' | 'pinned', orderedIds: string[]) =>
      tabs?.reorderTabs(section, orderedIds),
  );

  ipcMain.handle(IPC.TAB_MOVE_SECTION,
    (_e, tabId: string, targetSection: 'pinned' | 'normal', targetIndex: number) =>
      tabs?.moveTabSection(tabId, targetSection, targetIndex),
  );

  // AdBlock
  ipcMain.handle(IPC.ADBLOCK_GET_STATE,      ()                    => adblock.getState());
  ipcMain.handle(IPC.ADBLOCK_SET_ENABLED,    (_e, v: boolean)      => adblock.setEnabled(v));
  ipcMain.handle(IPC.ADBLOCK_ADD_DOMAIN,     (_e, d: string)       => adblock.addDomain(d));
  ipcMain.handle(IPC.ADBLOCK_REMOVE_DOMAIN,  (_e, d: string)       => adblock.removeDomain(d));
  ipcMain.handle(IPC.ADBLOCK_RELOAD_TABS,    (_e, d?: string)      => tabs?.reloadTabsForDomain(d));

  // Настройки
  ipcMain.handle(IPC.SETTINGS_GET_SEARCH_ENGINE, () => settings.getSearchEngine());
  ipcMain.handle(IPC.SETTINGS_SET_SEARCH_ENGINE, (_e, id: SearchEngineId) => {
    settings.setSearchEngine(id);
    tabs?.setSearchEngine(id);
  });
  ipcMain.handle(IPC.SETTINGS_GET_HUB_MODE, () => settings.getHubMode());
  ipcMain.handle(IPC.SETTINGS_SET_HUB_MODE, (_e, mode: HubMode) => settings.setHubMode(mode));
  ipcMain.handle(IPC.SETTINGS_GET_AI_PANEL_WIDTH, () => settings.getAiPanelWidth());

  // Выбор движка перевода страниц (Settings.tsx, секция AI) — persist + сразу применяется к
  // registry (см. TranslationEngineRegistry.ts::setActiveEngineId), без перезапуска приложения.
  ipcMain.handle(IPC.TRANSLATION_ENGINE_GET, () => settings.getTranslationEngine());
  ipcMain.handle(IPC.TRANSLATION_ENGINE_SET, (_e, id: TranslationEngineId) => {
    settings.setTranslationEngine(id);
    setActiveEngineId(id);
  });
  ipcMain.handle(IPC.TRANSLATION_ENGINE_GET_BERGAMOT_STATUS, () => bergamotStatus);

  // AI-чат на Hub (см. electron/HubChatManager.ts) — только локальная модель в этом заходе.
  // send — fire-and-forget (не invoke): ответ идёт стримом чанков + финальным результатом,
  // так проще, чем тащить длинный запрос через invoke (тот же приём, что у AI-панели).
  ipcMain.on(IPC.HUB_CHAT_SEND, (_e, payload: { tabId: string; text: string; grounding: boolean }) => {
    const { tabId, text, grounding } = payload;
    const sendResult = (sessionId: number | null, outcome: ChatOutcome) => {
      chromeView?.webContents.send(IPC.HUB_CHAT_RESULT, {
        tabId,
        sessionId,
        outcome: outcome.ok ? { ok: true, out: outcome.out } : { ok: false, error: outcome.error },
      });
    };
    const onChunk = (chunkText: string) => {
      chromeView?.webContents.send(IPC.HUB_CHAT_CHUNK, { tabId, text: chunkText });
    };
    void (async () => {
      // Web-grounding (SearXNG) — ОТДЕЛЬНАЯ ветка перед обычным путём ниже, целиком независимая
      // (тот же приём, что в AiPanelManager.ts::ai-panel:chat-send): риск сломать обычный
      // хаб-чат/персистентность сессий сведён к этому одному if с ранним return, сам обычный
      // путь (hubChat.sendMessage(tabId, text, onChunk) без 4-го аргумента) не тронут ни строкой.
      // Нет извлечения страницы, в отличие от AI-панели — в Hub её физически нет (это не вкладка
      // сайта), запрос = сырой текст пользователя как есть.
      if (grounding) {
        const search = await searxngSearch(text);
        if (!search.ok) {
          sendResult(null, { ok: false, error: search.error });
          return;
        }
        const promptText = buildGroundingPrompt(text, search.results);
        const { outcome, sessionId } = await hubChat.sendMessage(tabId, text, onChunk, { promptText, sources: search.results });
        sendResult(sessionId, outcome);
        return;
      }
      const { outcome, sessionId } = await hubChat.sendMessage(tabId, text, onChunk);
      sendResult(sessionId, outcome);
    })();
  });
  ipcMain.handle(IPC.HUB_CHAT_LIST_SESSIONS, () => hubChat.listSessions());
  ipcMain.handle(IPC.HUB_CHAT_GET_SESSION, (_e, sessionId: number) => hubChat.getSession(sessionId));
  ipcMain.handle(IPC.HUB_CHAT_NEW_SESSION, (_e, tabId: string) => hubChat.newSession(tabId));
  ipcMain.handle(IPC.HUB_CHAT_RESUME_SESSION, (_e, tabId: string, sessionId: number) =>
    hubChat.resumeSession(tabId, sessionId));
  ipcMain.handle(IPC.HUB_CHAT_DELETE_SESSION, (_e, sessionId: number) => hubChat.deleteSession(sessionId));

  // Заход D — ключ Gemini (AI-фактчек). Сам ключ не возвращается в renderer, только статус.
  ipcMain.handle(IPC.AI_GET_KEY_STATUS, () => aiKeyStore.getKeyStatus());
  ipcMain.handle(IPC.AI_SAVE_KEY,       (_e, key: string) => aiKeyStore.saveKey(key));
  ipcMain.handle(IPC.AI_DELETE_KEY,     () => aiKeyStore.deleteKey());
  // Пуш статуса в чром (секция настроек) — тот же источник, что слушает и AI-панель отдельно
  // (см. AiPanelManager.ts, заход D шаг 4), оба подписаны на один aiKeyStore.onKeyStatusChanged.
  aiKeyStore.onKeyStatusChanged((connected) => {
    chromeView?.webContents.send(IPC.AI_KEY_STATUS_CHANGED, connected);
  });

  // Задел под web-grounding (SearXNG) — тот же контракт/паттерн, что у ключа Gemini выше.
  // Пока только чром (секция настроек); AI-панель подключится отдельно, когда там появится
  // сам тоггл — свой preload, своя видимость, заводить сейчас незачем.
  ipcMain.handle(IPC.SEARXNG_GET_STATUS,    () => searxngKeyStore.getStatus());
  ipcMain.handle(IPC.SEARXNG_SAVE_CONFIG,   (_e, config: { endpoint: string; token: string }) => searxngKeyStore.saveConfig(config));
  ipcMain.handle(IPC.SEARXNG_DELETE_CONFIG, () => searxngKeyStore.deleteConfig());
  searxngKeyStore.onStatusChanged((configured) => {
    chromeView?.webContents.send(IPC.SEARXNG_STATUS_CHANGED, configured);
  });

  // VPN, шаг 1 — подписка + список серверов. Ссылка и credential серверов остаются в main
  // (см. VpnKeyStore.ts) — тот же принцип, что у ключа Gemini чуть выше.
  const vpnStatus = () => ({
    hasSubscription: vpnKeyStore.hasSubscription(),
    serverCount: vpnKeyStore.getServerCount(),
    fetchedAt: vpnKeyStore.getFetchedAt(),
  });
  ipcMain.handle(IPC.VPN_GET_STATUS, () => vpnStatus());
  ipcMain.handle(IPC.VPN_SET_SUBSCRIPTION, (_e, url: string) => vpnSubscription.setSubscription(url));
  ipcMain.handle(IPC.VPN_REFRESH_SUBSCRIPTION, () => vpnSubscription.refresh());
  ipcMain.handle(IPC.VPN_DELETE_SUBSCRIPTION, () => vpnKeyStore.deleteSubscription());
  ipcMain.handle(IPC.VPN_LIST_SERVERS, () => vpnKeyStore.getServers().map(toServerMeta));
  vpnKeyStore.onChanged(() => {
    chromeView?.webContents.send(IPC.VPN_STATUS_CHANGED, vpnStatus());
  });

  // VPN, шаг 2 — только процесс Xray + локальный SOCKS-порт (electron/VpnProcess.ts).
  // ⚠️ session.setProxy ЕЩЁ НЕ подключён (шаг 3) — "connect" здесь не переключает трафик
  // вкладок, только поднимает процесс и проверяет, что порт отвечает.
  // vpnConnectionTarget не сбрасывается при неудачном connect — иначе состояние 'error'
  // потеряло бы "какой именно сервер не подключился", см. VpnConnectionState в shared/ipc.ts.
  let vpnConnectionTarget: { id: string; remark: string } | null = null;
  // Захватывается из onStateChange(state, error) ниже — VpnProcess.getState() отдаёт только
  // строку состояния, само сообщение раньше нигде не сохранялось (баг, пойман живым тестом:
  // kill switch блокировал трафик правильно, но UI не мог показать пользователю, ПОЧЕМУ).
  let lastVpnError: string | undefined;
  const vpnConnectionState = (): VpnConnectionState => ({
    state: vpnProcess.getState(),
    serverId: vpnConnectionTarget?.id ?? null,
    serverRemark: vpnConnectionTarget?.remark ?? null,
    error: lastVpnError,
  });
  ipcMain.handle(IPC.VPN_CONNECT, async (_e, serverId: string) => {
    const server = vpnKeyStore.getServers().find((s) => s.id === serverId);
    if (!server) return { ok: false, error: 'Сервер не найден — обновите подписку' };
    vpnConnectionTarget = { id: server.id, remark: server.remark };
    return vpnProcess.start(server);
  });
  ipcMain.handle(IPC.VPN_DISCONNECT, async () => {
    // ⚠️ ВСЕГДА сбрасывает target/error — см. VpnProcess.ts::stop() про живой баг, который эта
    // симметрия раньше маскировала (kill switch блокировал трафик навсегда без выхода).
    // Disconnect — гарантированный путь назад к рабочему состоянию, а не «почти сброс».
    await vpnProcess.stop();
    vpnConnectionTarget = null;
    lastVpnError = undefined;
  });
  ipcMain.handle(IPC.VPN_GET_CONNECTION_STATE, () => vpnConnectionState());
  vpnProcess.onStateChange((_state, error) => {
    lastVpnError = error;
    applyVpnProxy();
    chromeView?.webContents.send(IPC.VPN_CONNECTION_STATE_CHANGED, vpnConnectionState());
  });
  applyVpnProxy(); // детерминированная база на старте — 'stopped' → direct, а не implicit-дефолт Electron

  // Менеджер паролей, шаг 1 (см. electron/PasswordManager.ts). Пароль пересекает IPC только
  // через reveal/generate — list его не отдаёт, copy сам кладёт в буфер и наружу не возвращает.
  ipcMain.handle(IPC.PASSWORDS_LIST,     () => passwords.list());
  ipcMain.handle(IPC.PASSWORDS_REVEAL,   (_e, id: number) => passwords.reveal(id));
  ipcMain.handle(IPC.PASSWORDS_COPY,     (_e, id: number, field: PasswordCopyField) => passwords.copyField(id, field));
  ipcMain.handle(IPC.PASSWORDS_GENERATE, (_e, opts: PasswordGenerateOptions) => passwords.generate(opts));
  ipcMain.handle(IPC.PASSWORDS_ADD, (_e, input: PasswordAddInput) => {
    const ok = passwords.add(input);
    if (ok) chromeView?.webContents.send(IPC.PASSWORDS_CHANGED);
    return ok;
  });
  ipcMain.handle(IPC.PASSWORDS_UPDATE, (_e, input: PasswordUpdateInput) => {
    const ok = passwords.update(input);
    if (ok) chromeView?.webContents.send(IPC.PASSWORDS_CHANGED);
    return ok;
  });
  ipcMain.handle(IPC.PASSWORDS_DELETE, (_e, id: number) => {
    passwords.delete(id);
    chromeView?.webContents.send(IPC.PASSWORDS_CHANGED);
  });
  // Экспорт/импорт — диалог выбора файла целиком в main, на диск попадает только уже
  // зашифрованная под passphrase строка (см. PasswordManager.exportVault/importVault),
  // никогда не расшифрованный JSON.
  ipcMain.handle(IPC.PASSWORDS_EXPORT, async (_e, passphrase: string) => {
    const payload = passwords.exportVault(passphrase);
    if (payload === null || !win) return false;
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Экспорт паролей',
      defaultPath: 'oblako-passwords.json',
      filters: [{ name: 'Зашифрованный экспорт', extensions: ['json'] }],
    });
    if (canceled || !filePath) return false;
    try {
      fs.writeFileSync(filePath, payload, 'utf8');
      return true;
    } catch (e) {
      console.error('[Passwords] экспорт: не удалось записать файл:', (e as Error).message);
      return false;
    }
  });
  ipcMain.handle(IPC.PASSWORDS_IMPORT, async (_e, passphrase: string) => {
    if (!win) return 0;
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Импорт паролей',
      filters: [{ name: 'Зашифрованный экспорт', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return 0;
    let payload: string;
    try {
      payload = fs.readFileSync(filePaths[0], 'utf8');
    } catch (e) {
      console.error('[Passwords] импорт: не удалось прочитать файл:', (e as Error).message);
      return 0;
    }
    const count = passwords.importVault(passphrase, payload);
    if (count > 0) chromeView?.webContents.send(IPC.PASSWORDS_CHANGED);
    return count;
  });

  // Менеджер паролей, шаг 2 — действия из поповера индикатора (всегда про активную вкладку,
  // см. PasswordAutofillManager.ts::handleSave/handleUpdate/handleDismiss).
  ipcMain.handle(IPC.PASSWORDS_INDICATOR_SAVE,    () => passwordAutofill.handleSave());
  ipcMain.handle(IPC.PASSWORDS_INDICATOR_UPDATE,  () => passwordAutofill.handleUpdate());
  ipcMain.handle(IPC.PASSWORDS_INDICATOR_FILL,    (_e, id: number) => passwordAutofill.handleFill(id));
  ipcMain.handle(IPC.PASSWORDS_INDICATOR_DISMISS, () => passwordAutofill.handleDismiss());
  ipcMain.handle(IPC.PASSWORDS_INDICATOR_GENERATE, () => passwordAutofill.handleGenerateAndFill());

  // Заход G, блок 5 — разовый бэкфилл истории. Запускается только по явному действию
  // пользователя (Settings.tsx), никогда автоматически. lastBackfillProgress — чтобы панель
  // настроек могла синхронизироваться при открытии, если бэкфилл уже идёт (или уже завершился).
  let lastBackfillProgress: BackfillProgress = { processed: 0, total: 0, running: false, cancelled: false };
  setBackfillProgressListener((p) => {
    lastBackfillProgress = p;
    chromeView?.webContents.send(IPC.HISTORY_BACKFILL_PROGRESS, p);
  });
  ipcMain.on(IPC.HISTORY_BACKFILL_START,  () => { void startBackfill(history); });
  ipcMain.on(IPC.HISTORY_BACKFILL_CANCEL, () => { cancelBackfill(); });
  ipcMain.handle(IPC.HISTORY_BACKFILL_STATUS, () => lastBackfillProgress);
  // Индикатор качества индекса умного поиска (Settings.tsx) — снимок на момент запроса,
  // не подписка: панель настроек открывают редко, push-канал ради этого избыточен.
  ipcMain.handle(IPC.HISTORY_CONTENT_COVERAGE, () => ({
    withContent: history.countHistoryWithContent(),
    total: history.countAll(),
  }));

  // Рискованный бэкфилл полного текста (electron/HistoryContentBackfill.ts) — тихое переоткрытие
  // старых URL, отдельная секция в Settings.tsx с явным предупреждением. Нужен win (создаёт
  // скрытые WebContentsView) — если окна уже нет, просто no-op.
  let lastContentBackfillProgress: BackfillProgress = { processed: 0, total: 0, running: false, cancelled: false };
  setContentBackfillProgressListener((p) => {
    lastContentBackfillProgress = p;
    chromeView?.webContents.send(IPC.HISTORY_CONTENT_BACKFILL_PROGRESS, p);
  });
  ipcMain.on(IPC.HISTORY_CONTENT_BACKFILL_START, () => { if (win) void startContentBackfill(history, win); });
  ipcMain.on(IPC.HISTORY_CONTENT_BACKFILL_CANCEL, () => { cancelContentBackfill(); });
  ipcMain.handle(IPC.HISTORY_CONTENT_BACKFILL_STATUS, () => lastContentBackfillProgress);

  // Заход 10: живые suggest-подсказки — движок берём из settings (тот же источник истины, что
  // капсула выбора поисковика), а не отдельным параметром от renderer — не может разойтись.
  ipcMain.handle(IPC.SEARCH_SUGGEST, (_e, query: string) => fetchSearchSuggestions(query, settings.getSearchEngine()));

  // История посещений
  ipcMain.handle(IPC.HISTORY_GET,    (_e, limit?: number)           => history.getRecent(limit));
  ipcMain.handle(IPC.HISTORY_SEARCH, (_e, query: string)            => history.search(query));
  ipcMain.handle(IPC.HISTORY_DELETE, (_e, id: number)               => history.deleteEntry(id));
  ipcMain.handle(IPC.HISTORY_CLEAR,  (_e, period: HistoryClearPeriod) => history.clearHistory(period));
  // Заход G, блок 7 — векторный поиск для омнибокса (searchHistorySemantic — блок 6).
  ipcMain.handle(IPC.HISTORY_SEARCH_SEMANTIC, (_e, query: string) => searchHistorySemantic(history, query));
  // Умный поиск — Qwen-реранк, только по явному Enter (см. HistorySearch.ts::searchHistorySmart).
  ipcMain.handle(IPC.HISTORY_SEARCH_SMART, (_e, query: string) => searchHistorySmart(history, query));

  // Закладки — пуш BOOKMARK_CHANGED в chromeView после каждой успешной мутации, тот же
  // приём, что уже используется для PASSWORDS_CHANGED (инлайн, не через конструктор-колбэк).
  ipcMain.handle(IPC.BOOKMARK_ADD, (_e, url: string, title: string) => {
    const entry = bookmarks.add(url, title);
    if (entry) chromeView?.webContents.send(IPC.BOOKMARK_CHANGED);
    return entry;
  });
  ipcMain.handle(IPC.BOOKMARK_REMOVE, (_e, id: number) => {
    bookmarks.remove(id);
    chromeView?.webContents.send(IPC.BOOKMARK_CHANGED);
  });
  ipcMain.handle(IPC.BOOKMARK_REMOVE_BY_URL, (_e, url: string) => {
    bookmarks.removeByUrl(url);
    chromeView?.webContents.send(IPC.BOOKMARK_CHANGED);
  });
  ipcMain.handle(IPC.BOOKMARK_LIST, () => bookmarks.list());
  ipcMain.handle(IPC.BOOKMARK_IS_BOOKMARKED, (_e, url: string) => bookmarks.isBookmarked(url));
  // Импорт — isAvailable() зовётся заново на каждый список (профиль браузера-источника мог
  // появиться/пропасть между вызовами, не кэшируем факт наличия).
  ipcMain.handle(IPC.BOOKMARK_IMPORT_LIST_SOURCES, () =>
    bookmarkImporters.filter((imp) => imp.isAvailable()).map((imp) => ({ id: imp.id, label: imp.label })));
  ipcMain.handle(IPC.BOOKMARK_IMPORT_RUN, async (_e, sourceId: string) => {
    const importer = bookmarkImporters.find((imp) => imp.id === sourceId);
    if (!importer) return null;
    const result = await importer.import();
    chromeView?.webContents.send(IPC.BOOKMARK_CHANGED);
    return result;
  });

  // Разрешения сайтов
  ipcMain.handle(IPC.PERMISSION_RESPONSE,
    (_e, requestId: string, granted: boolean, remember: boolean) =>
      permissions.respond(requestId, granted, remember),
  );

  // Загрузки
  ipcMain.handle(IPC.DOWNLOADS_GET_ALL,    ()               => downloads.getAll());
  ipcMain.handle(IPC.DOWNLOAD_PAUSE,       (_e, id: string) => downloads.pause(id));
  ipcMain.handle(IPC.DOWNLOAD_RESUME,      (_e, id: string) => downloads.resume(id));
  ipcMain.handle(IPC.DOWNLOAD_CANCEL,      (_e, id: string) => downloads.cancel(id));
  ipcMain.handle(IPC.DOWNLOAD_CLEAR,       (_e, id: string) => downloads.clear(id));
  ipcMain.handle(IPC.DOWNLOAD_OPEN_FILE,   (_e, id: string) => downloads.openFile(id));
  ipcMain.handle(IPC.DOWNLOAD_SHOW_FOLDER, (_e, id: string) => downloads.showFolder(id));
  ipcMain.handle(IPC.DOWNLOAD_RETRY,       (_e, id: string) => downloads.retry(id));

  // AI-группировка вкладок (Phase 4)
  ipcMain.handle(IPC.TABS_ORGANIZE_APPLY,    (_e, clusters: OrganizeCluster[]) => tabs?.applyOrganize(clusters));
  ipcMain.handle(IPC.TABS_ORGANIZE_ROLLBACK, ()                                => tabs?.rollbackOrganize());

  // Правая AI-панель (см. AiPanelManager.ts)
  ipcMain.handle(IPC.AI_PANEL_TOGGLE, () => {
    if (!win) return false;
    const open = toggleAiPanel(win);
    relayoutFindBar(); // свободная ширина под FindBar изменилась (см. FindBarManager.ts::computeBounds)
    return open;
  });

  // Полностраничный перевод (см. PageTranslateManager.ts) — fire-and-forget, актуальное
  // состояние приходит push'ем через onPageTranslateStateChanged (см. выше).
  ipcMain.on(IPC.PAGE_TRANSLATE_TOGGLE, () => { void togglePageTranslate(); });
  ipcMain.handle(IPC.PAGE_TRANSLATE_GET_STATE, () => getPageTranslateActiveState());

  // Нативное ПКМ-меню вкладки в сайдбаре.
  ipcMain.handle(IPC.TAB_SHOW_MENU, (_e, id: string) => {
    if (!tabs || !win) return;
    const isPinned = tabs.isTabPinned(id);
    const groupId  = tabs.getTabGroupId(id);

    const items: MenuItemConstructorOptions[] = [
      {
        label: isPinned ? 'Открепить вкладку' : 'Закрепить вкладку',
        click: () => tabs!.togglePin(id),
      },
      { type: 'separator' },
    ];

    if (!isPinned) {
      if (groupId) {
        items.push({
          label: 'Убрать из группы',
          click: () => tabs!.removeTabFromGroup(groupId, id),
        });
      } else {
        items.push({
          label: 'Создать группу',
          click: () => tabs!.createGroup(id),
        });
      }

      // Подменю «Добавить в группу» — только если есть группы.
      const allGroups = collectGroups(tabs.sidebarNodesSnapshot());
      const otherGroups = allGroups.filter((g) => g.id !== groupId);
      if (otherGroups.length > 0) {
        items.push({
          label: 'Добавить в группу',
          submenu: otherGroups.map((g) => ({
            label: g.label || 'Группа',
            click: () => tabs!.addTabToGroup(g.id, id),
          })),
        });
      }

      items.push({ type: 'separator' });
    }

    items.push({
      label: 'Закрыть вкладку',
      enabled: !isPinned,
      click: () => tabs!.closeTab(id),
    });
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Нативное ПКМ-меню заголовка группы.
  ipcMain.handle(IPC.GROUP_SHOW_MENU, (_e, groupId: string) => {
    if (!tabs || !win || !chromeView) return;
    const GROUP_COLORS: Array<{ label: string; value: string }> = [
      { label: 'Без цвета',   value: '' },
      { label: 'Красный',     value: 'red' },
      { label: 'Оранжевый',   value: 'orange' },
      { label: 'Жёлтый',      value: 'yellow' },
      { label: 'Зелёный',     value: 'green' },
      { label: 'Синий',       value: 'blue' },
      { label: 'Фиолетовый',  value: 'purple' },
    ];
    const items: MenuItemConstructorOptions[] = [
      {
        label: 'Переименовать',
        click: () => chromeView?.webContents.send(IPC.GROUP_RENAME_PROMPT, groupId),
      },
      {
        label: 'Цвет',
        submenu: GROUP_COLORS.map(({ label, value }) => ({
          label,
          click: () => tabs!.setGroupColor(groupId, value || null),
        })),
      },
      { type: 'separator' },
      {
        label: 'Свернуть / развернуть',
        click: () => tabs!.toggleGroupCollapse(groupId),
      },
      { type: 'separator' },
      {
        label: 'Расформировать группу',
        click: () => tabs!.disbandGroup(groupId),
      },
    ];
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Группо-операции.
  ipcMain.handle(IPC.SIDEBAR_NODES_GET,      ()                                => tabs?.sidebarNodesSnapshot() ?? []);
  ipcMain.handle(IPC.GROUP_CREATE,           (_e, tabId: string)               => tabs?.createGroup(tabId));
  ipcMain.handle(IPC.GROUP_ADD_TAB,          (_e, gId: string, tabId: string)  => tabs?.addTabToGroup(gId, tabId));
  ipcMain.handle(IPC.GROUP_REMOVE_TAB,       (_e, gId: string, tabId: string)  => tabs?.removeTabFromGroup(gId, tabId));
  ipcMain.handle(IPC.GROUP_RENAME,           (_e, gId: string, label: string)  => tabs?.renameGroup(gId, label));
  ipcMain.handle(IPC.GROUP_COLOR,            (_e, gId: string, color: string | null) => tabs?.setGroupColor(gId, color));
  ipcMain.handle(IPC.GROUP_TOGGLE_COLLAPSE,  (_e, gId: string)                 => tabs?.toggleGroupCollapse(gId));
  ipcMain.handle(IPC.GROUP_DISBAND,          (_e, gId: string)                 => tabs?.disbandGroup(gId));
  ipcMain.handle(IPC.GROUP_REORDER_CHILDREN, (_e, gId: string, ids: string[])  => tabs?.reorderGroupChildren(gId, ids));
}

// Собирает GroupNode[] плоским списком из верхнего уровня дерева.
function collectGroups(nodes: SidebarNode[]): GroupNode[] {
  const groups: GroupNode[] = [];
  for (const node of nodes) {
    if (node.type === 'group') groups.push(node as GroupNode);
  }
  return groups;
}

// Внешние протоколы (mailto:, tel:) -> отдаём ОС, не показываем ошибку навигации.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e, url) => {
    if (/^(mailto|tel):/i.test(url)) {
      e.preventDefault();
      shell.openExternal(url).catch(() => { /* тихо игнорируем */ });
    }
  });
});

app.whenReady().then(async () => {
  startT0 = Date.now();
  console.log(`[startup] preload=${EMBED_PRELOAD ? 'on' : 'off'}`);
  Menu.setApplicationMenu(null); // прячем дефолтное меню — у нас свой хром
  registerModelProtocol();
  registerChromeProtocol();

  if (GPU_TEST) {
    runIsolatedTestWindow('gputest.html', '[gputest]');
    return;
  }
  if (LLAMA_TEST) {
    // node-llama-cpp работает только в main-процессе — своё окно не нужно, только stdout.
    const { runLlamaTest } = await import('./llamatest');
    await runLlamaTest().catch((e: unknown) => console.error('[llamatest] FATAL', e));
    app.quit();
    return;
  }
  if (TRANSLATE_TEST) {
    await runTranslateTestWindow();
    return;
  }

  registerIpc();

  // safeStorage требует app.isReady() — грузим сохранённый (зашифрованный) ключ Gemini здесь,
  // не на верхнем уровне модуля (см. AiKeyStore.ts, заход D шаг 3).
  aiKeyStore.loadFromDisk();
  searxngKeyStore.loadFromDisk();
  vpnKeyStore.loadFromDisk();

  // История: нативный модуль может отсутствовать — падение не блокирует запуск.
  await history.initialize().catch((e) =>
    console.error('[History] инициализация упала:', e),
  );
  // Закладки — тот же паттерн деградации, отдельный файл (см. BookmarkManager.ts).
  await bookmarks.initialize().catch((e) =>
    console.error('[Bookmarks] инициализация упала:', e),
  );

  // Сейф паролей: та же гарантия — падение (нет better-sqlite3, safeStorage недоступен) не
  // блокирует старт, браузер работает без него (см. PasswordManager.ts::initialize).
  await passwords.initialize().catch((e) =>
    console.error('[Passwords] инициализация упала:', e),
  );

  // История AI-чата Hub: та же гарантия — падение не блокирует старт, чат работает без
  // персистентности (см. HubChatManager.ts::initialize).
  await hubChat.initialize().catch((e) =>
    console.error('[HubChat] инициализация упала:', e),
  );

  // Разрешения: та же гарантия — падение не блокирует старт, браузер работает без персистенции.
  await permissions.initialize().catch((e) =>
    console.error('[Permissions] инициализация упала:', e),
  );

  // Кэш переводов (Этап 4): та же гарантия — падение (нет better-sqlite3) не блокирует старт.
  // setCacheManager регистрируется безусловно, даже если initialize() выше упал — get()/set()
  // внутри TranslationCacheManager сами проверяют #db!==null и молча становятся no-op, так что
  // регистрация "пустого" менеджера равносильна отсутствию кэша, а не ошибке.
  await translationCache.initialize().catch((e) =>
    console.error('[translation-cache] инициализация упала:', e),
  );
  setCacheManager(translationCache);

  // Ghostery ставит свой onBeforeRequest внутри initialize().
  // try/catch: падение адблока не должно блокировать запуск браузера.
  try {
    await adblock.initialize((state) => {
      chromeView?.webContents.send(IPC.ADBLOCK_STATE_CHANGED, state);
    });
  } catch (e) {
    console.error('[AdBlock] инициализация упала, браузер работает без блокировки:', e);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Синхронная запись перед выходом — никаких await, иначе процесс умрёт раньше.
// На Windows/Linux это уже избыточно (win.on('close') в createWindow успевает раньше и обнуляет
// tabs/sess), но на macOS Cmd+Q шлёт before-quit ДО закрытия окна — здесь ещё всё живо, это тот
// путь, где сработает эта подстраховка. Оставлено ради будущего macOS-порта (см. CLAUDE.md).
app.on('before-quit', () => {
  isShuttingDown = true; // macOS Cmd+Q путь — здесь ещё раньше, чем win.on('close') выше
  if (tabs && sess) sess.saveNow(tabs.getSessionSnapshot());
});
