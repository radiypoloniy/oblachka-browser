import { app, BrowserWindow, WebContentsView, ipcMain, Menu, shell, session, dialog, clipboard, webContents, nativeImage, screen, nativeTheme, Notification } from 'electron';
import type { WebContents } from 'electron';
import { registerSchemesAsPrivileged, registerModelProtocol, registerChromeProtocol } from './AppProtocol';
import { applyChromeUserAgent, applyClientHints } from './BrowserIdentity';
import { showSplash, closeSplash } from './SplashWindow';
import { registerWindow, contextFromSender, contextForWindow, broadcastToChrome, allContexts, mainContext } from './WindowRegistry';
import type { WindowRole } from './WindowRegistry';

// ДО app.whenReady() — Electron требует это до события ready.
registerSchemesAsPrivileged();
// Тоже до ready и до первой сессии: иначе часть запросов уйдёт со старым UA.
applyChromeUserAgent();
// ⚠️ Без AppUserModelID Windows не связывает тост с приложением: уведомление приходит безымянным
// (а на части систем не приходит вовсе). Значение обязано совпадать с appId из electron-builder.yml.
app.setAppUserModelId('com.oblako.browser');
// ⚠️ ОПЫТ, а не установленный факт. Гипотеза: колесо мыши прокручивает наш интерфейс ступенями
// по ~100 px за щелчок, тогда как Chrome на Windows анимирует это движение, — отсюда ощущение
// «дёшево крутится». Проверить замером не удалось: ни Input.dispatchMouseEvent с колесом, ни
// Input.synthesizeScrollGesture нашу область прокрутки не двигают вовсе (scrollTop остаётся 0),
// то есть синтетика тут не воспроизводит настоящее колесо. Судить может только человек на ощупь.
// Ключ безвреден: неизвестный Chromium просто игнорирует, а если режим уже включён по умолчанию,
// повторное включение ничего не меняет. Не подтвердится ощущением — удалить эту строку.
app.commandLine.appendSwitch('enable-smooth-scrolling');
import type { MenuItemConstructorOptions, Session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { TabManager, HUB_ID } from './TabManager';
import { SessionManager } from './SessionManager';
import { AdBlockManager } from './AdBlockManager';
import { UpdateManager } from './UpdateManager';
import { BangStore } from './BangStore';
import { deriveBangFromUrl } from '../shared/bangs';
import { HistoryManager } from './HistoryManager';
import { BookmarkManager } from './BookmarkManager';
import { GraphStore } from './GraphStore';
import {
  cancelGraphRun, composeWebAppPrompt, computeNodeInputHash, runGraph, setImagePresetsSource,
} from './GraphEngine';
import type { ImagePreset } from '../shared/imagePresets';
import { sendChatMessage } from './GraphChat';
import { addItemsToGraph, buildAddToGraphMenuItem } from './GraphInbox';
import {
  captureAnswer, captureImage, closeGraphWebApp, insertPrompt, raiseGraphWebApp,
  setGraphWebAppBounds, showGraphWebApp,
  setTabManager as setGraphWebAppTabManager,
} from './GraphWebAppManager';
import type { GraphStructure } from '../shared/graph';
import { SUPPORTED_FILE_EXTENSIONS } from './FileExtract';
import { createChromiumImporters } from './bookmarkImport/ChromiumBookmarkImporter';
import { ImportManager } from './browserImport/ImportManager';
import { faviconService } from './FaviconService';
import { getWeather } from './WeatherService';
import { getCurrencyRates, getCurrencyHistory } from './CurrencyRates';
import { getCryptoRates, getCryptoHistory } from './CryptoRates';
import { getPhotoOfDay } from './NewTabPhoto';
import { extractUrlText, setTabManager as setNotebookExtractTabManager } from './NotebookExtract';
import { generateStudio, type StudioKind } from './NotebookStudio';
import { verifyUser } from './osAuth';
import { PasswordManager } from './PasswordManager';
import { AutofillManager } from './AutofillManager';
import { DownloadManager } from './DownloadManager';
import { PermissionManager } from './PermissionManager';
import { SettingsManager } from './SettingsManager';
import * as ModelRegistry from './ModelRegistry';
import * as HardwareInfo from './HardwareInfo';
import * as ModelDownloader from './ModelDownloader';
import * as ModelCatalog from './ModelCatalog';
import { HubChatManager } from './HubChatManager';
import { searxngSearch, buildGroundingPrompt } from './SearxngSearch';
import { IPC, INCOGNITO_PARTITION, THEME_PALETTE_IDS, isDarkTheme } from '../shared/ipc';
import type { ThemeMode, ThemePaletteId, ThemePrefs } from '../shared/ipc';
import type { ContentBounds, TitleBarOpts, FindResult, HistoryClearPeriod, SidebarNode, GroupNode, OrganizeCluster, SuggestDropdownItem, PasswordAddInput, PasswordUpdateInput, PasswordCopyField, PasswordGenerateOptions, HubMode, ModelLoadMode, TranslationEngineId, BergamotStatus, ModelDownloadSpec, BangDefWire, DerivedBangCandidate, QuickHit, SearchTarget, SearchChipsConfig, SearchChipCandidate, DayDigestState, SemanticSearchResult, SmartFindResult, RuleParseOutcome } from '../shared/ipc';
import type { SearchEngineId } from '../shared/searchEngines';
import type { SavedNode } from './SessionManager';
import { showTranslatePopover, closeTranslatePopoverOnTabSwitch, closeTranslatePopoverForClosedTab } from './TranslatePopoverManager';
import { warmup as warmupTranslation, unloadModel, getLoadedModelId, isModelWarm, type ChatOutcome } from './TranslationService';
import { shutdownInference } from './inference/InferenceHost';
import { isExternalAppUrl, openExternalWithConsent } from './ExternalProtocol';
import { localPathToFileUrl } from './localFileUrl';
import { installCertificateTrust, refreshCertificateTrust } from './CertificateTrust';
import { listUserTrusted, removeUserTrusted } from './CertTrustStore';
import { toggleAiPanel, openAiPanelApp, prewarmPanel, onTabsSynced, setTabManager, setSettingsManager as setAiPanelSettingsManager, setChromeView as setAiPanelChromeView, setOnChatIntent as setOnAiPanelChatIntent } from './AiPanelManager';
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
import { captureTabScreenshot, saveCurrentScreenshot, closeScreenshot, syncScreenshotBounds, relayoutScreenshot, setScreenshotTabManager } from './ScreenshotManager';
import { searchTabsByMeaning } from './TabSearch';
import { mapFormFields, type FormFieldDescriptor } from './AutofillFieldMapper';
import { getDigest, buildDigest, shouldRefresh } from './DayDigest';
import { findRelatedPages } from './RelatedHistory';
import { pickFragmentByMeaning, highlightCandidates } from './SmartFind';
import { RuleStore } from './RuleStore';
import { applyRules } from './RuleEngine';
import { parsePhraseToRule } from './RuleParser';
import { startTabDrag, endTabDrag, syncDropZoneBounds } from './DropZoneManager';
import { isDefaultBrowser, requestDefaultBrowser } from './DefaultBrowser';
import { suggestTabTitle } from './TabRenamer';
import {
  showPermissionRequest, permissionAnswered, syncPermissionPopoverBounds,
  setPermissionPopoverHeight, dropPermissionRequests,
} from './PermissionPopoverManager';
import { showSearchPopover, closeSearchPopover, syncSearchPopoverBounds, relayoutSearchPopover, setOnSearchRun, setOnQuickQuery, setOnQuickOpen, setTabManager as setSearchPopoverTabManager } from './SearchPopoverManager';
import { buildSearchTargets, searchChipCandidates, resolveChipCandidates } from './SearchTargets';
import { readPageSelection } from './PageSelection';
import { SearchTargetStore } from './SearchTargetStore';
import { applyBangTemplate, isValidBangTemplate, parseBangCandidate, bangHomeUrl } from '../shared/bangs';
import { showSuggestDropdown, hideSuggestDropdown, syncOmniboxBounds, sendSuggestItems, onPick as onSuggestDropdownPick, onFocusStolen as onSuggestDropdownFocusStolen, setHighlight as setSuggestDropdownHighlight } from './SuggestDropdownManager';
import { initPasswordPopover, showPasswordPopover, closePasswordPopover, syncPasswordPopoverAnchorBounds } from './PasswordPopoverManager';
import { initAutofillPopover, showAutofillPopover, closeAutofillPopover, syncAutofillPopoverAnchorBounds } from './AutofillPopoverManager';
import * as autofillOrchestrator from './AutofillOrchestrator';
import { parseAddressBlob } from './AddressParser';
import { initVpnPopover, showVpnPopover, closeVpnPopover, syncVpnPopoverAnchorBounds, syncVpnPopoverActiveUrl, broadcastVpnState } from './VpnPopoverManager';
import { initDownloadsPopover, showDownloadsPopover, closeDownloadsPopover, syncDownloadsPopoverAnchorBounds, broadcastDownloads, setDuplicatePrompt, setDuplicateDecisionHandler } from './DownloadsPopoverManager';
import { initSitePopover, showSitePopover, closeSitePopover, syncSitePopoverAnchorBounds, isSitePopoverOpen } from './SitePopoverManager';
import { fetchSearchSuggestions } from './SearchSuggestFetcher';
import * as aiKeyStore from './AiKeyStore';
import * as searxngKeyStore from './SearxngKeyStore';
import * as vpnKeyStore from './VpnKeyStore';
import * as skillsStore from './SkillsStore';
import * as vpnSubscription from './VpnSubscription';
import * as vpnProcess from './VpnProcess';
import { toServerMeta } from './VpnParser';
import type { VpnConnectionState } from '../shared/ipc';
import * as passwordAutofill from './PasswordAutofillManager';
import { indexVisit } from './HistoryIndexer';
import { startContentBackfill, cancelContentBackfill, setContentBackfillProgressListener } from './HistoryContentBackfill';
import type { BackfillProgress } from '../shared/ipc';
import type { ImportDataType } from '../shared/ipc';
import type { AddressInput, AddressUpdate, CardInput, CardUpdate } from '../shared/ipc';
import type { PermissionRequest } from '../shared/ipc';
import { searchHistorySmart } from './HistorySearch';
import {
  suggestGroups,
  suggestGroupName,
  setTabManager as setOrganizerTabManager,
  setHistoryManager as setOrganizerHistoryManager,
} from './TabOrganizer';
import { suggestBookmarkFolders } from './BookmarkOrganizer';
import { suggestFolderForBookmark } from './BookmarkFolderPick';
import { suggestFileName, renameDownloadedFile } from './DownloadNamer';
import { searchSettingsByMeaning } from './SettingsSearch';
import { getPageChanges } from './PageChanges';
import { searchStuff } from './StuffSearch';
import { detectProduct } from './ProductDetector';
import { TrackingStore } from './TrackingStore';
import { initTrackingChecker, checkAllNow, setTrackingEventHandler } from './TrackingChecker';
import { findMatchFor } from './ProductMatcher';
import type { DownloadNameSuggestion, DownloadRenameResult, SmartTabHit, ParsedAddressPart, PageChangesResult, ProductState, TrackedProduct } from '../shared/ipc';
import { getNextHoliday } from './HolidaysService';
import type { BookmarkFolderProposal, BookmarkNode, PermKey } from '../shared/ipc';

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

// Пауза перед фоновым прогревом локальной LLM перевода (см. showWindow ниже) — даём чрому и первой
// (разбуженной) вкладке спокойно отрисоваться/догрузиться, прежде чем начинать тяжёлую загрузку
// модели (~5.7ГБ с диска + перенос в VRAM, см. TranslationService.ts::ensureLoaded). Без паузы
// загрузка стартовала бы в тот же момент, что и показ окна, — конкуренция за диск/GPU как раз в
// точке, где пользователь впервые видит интерфейс.
const TRANSLATION_WARMUP_DELAY_MS = 3000;

// Прогрев AI-панели (см. showWindow ниже, AiPanelManager.ts::prewarmPanel) — своя, более ранняя
// пауза: в отличие от перевода/Bergamot выше это НЕ модель (VRAM/GPU не трогает) — просто спавн
// WebContentsView + загрузка её бандла (~280КБ, см. диагностику двухфазного показа панели), лёгкий
// прогрев. Отдельная задержка (не тот же тик, что TRANSLATION_WARMUP_DELAY_MS) — чтобы не бить
// оба прогрева в одну точку старта; панель раньше, т.к. дешевле и пользователь может кликнуть
// по AI раньше, чем понадобится перевод.
const AI_PANEL_PREWARM_DELAY_MS = 1500;

// Изолированные стенды AI-инфраструктурных тестов (node-llama-cpp).
// OBLAKO_LLAMA_TEST=1 / OBLAKO_TRANSLATE_TEST=1 npm start → вместо боевого окна открывается
// только тестовое, боевой чром (TabManager/SessionManager/adblock/history) не инициализируется.
const LLAMA_TEST = process.env.OBLAKO_LLAMA_TEST === '1';
const TRANSLATE_TEST = process.env.OBLAKO_TRANSLATE_TEST === '1';
// Замер «читается ли цена товара» перед фичей отслеживания (см. PriceProbe.ts). Адреса приходят
// JSON-массивом в OBLAKO_PRICE_PROBE_URLS. Боевое окно не поднимается.
const PRICE_PROBE = process.env.OBLAKO_PRICE_PROBE === '1';

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

// Адрес, пришедший до того, как окно готово его принять (macOS open-url на холодном старте).
let pendingStartUrl: string | null = null;

// Ссылка среди аргументов запуска. ⚠️ Берём только http/https: в argv лежат и путь к самому
// приложению, и ключи Chromium (--user-data-dir и прочие), и принимать оттуда произвольную
// строку как адрес — значит открывать что попало по чужой команде.
function firstUrlFromArgv(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue; // ключи Chromium (--user-data-dir и прочие) адресами не бывают
    if (/^https?:\/\//i.test(arg)) return arg;
    if (/^file:\/\//i.test(arg)) return arg;
    // ⚠️ И ПУТЬ К ФАЙЛУ ТОЖЕ. Установщик регистрирует за нами .htm/.html, то есть система
    // запускает `Oblako.exe "C:\...\page.html"` — без этой ветки такой запуск не открывал ничего
    // вовсе. Существование файла проверяется внутри, каталоги отсекаются там же: в dev-режиме
    // аргументом идёт папка приложения.
    const file = localPathToFileUrl(arg);
    if (file) return file;
  }
  return null;
}

// t0 стартовых тайминов: фиксируем в app.whenReady, до createWindow.
let startT0 = 0;

// Главное окно и его слой хрома. ⚠️ Это НЕ «текущее окно»: с появлением второго окна каждое
// держит своё в реестре (WindowRegistry.ts), а эти ссылки остаются запасным путём для отправителей,
// которых в реестре нет (ранние сообщения при старте, изолированные тестовые окна), и адресом
// финального сохранения сессии. Внутри createWindow одноимённые ПЕРЕМЕННЫЕ локальные — там речь
// всегда о создаваемом окне.
let mainWin: BrowserWindow | null = null;
let mainChromeView: WebContentsView | null = null; // слой нашего React-хрома
// In-memory сессия инкогнито-вкладок (см. INCOGNITO_PARTITION). Создаётся при старте окна; её
// storage чистится, когда закрыта последняя инкогнито-вкладка (TabManager.takeIncognitoClearIfDone).
let incognitoSession: Session | null = null;

// Тема chrome-страниц. Главный рендерер (App.tsx) сам ставит data-theme/data-incognito на свой
// documentElement, но КАЖДЫЙ поповер/дропдаун (AI-панель, перевод, findbar, пароли, VPN,
// автозаполнение, дропдаун подсказок) — отдельная WebContentsView со своим document, который
// этих атрибутов не видит. Держим актуальную тему в main и раскидываем во ВСЕ наши chrome-вью
// (oblako-chrome://…) через executeJavaScript — без правок в каждом preload/entry. Реальные
// сайты (гостевые вкладки) не трогаем (isChromePageUrl отсекает по URL).
let currentChromeTheme: { dark: boolean; incognito: boolean; palette: ThemePaletteId } =
  { dark: false, incognito: false, palette: 'charcoal' };
function isChromePageUrl(u: string): boolean {
  return u.startsWith('oblako-chrome://') || u.includes('localhost:5173'); // прод + dev-сервер Vite
}
function chromeThemeJs(t: { dark: boolean; incognito: boolean; palette: ThemePaletteId }): string {
  return `(function(){try{var r=document.documentElement;`
    + `r.setAttribute('data-theme','${t.dark ? 'dark' : 'light'}');`
    // Палитра — вторая ось темы (см. palettes.css): без неё поповеры остались бы на базовой земле,
    // а окно перекрасилось бы, и стык был бы виден на каждом дропдауне.
    + `r.setAttribute('data-palette','${t.palette}');`
    + (t.incognito ? `r.setAttribute('data-incognito','true');` : `r.removeAttribute('data-incognito');`)
    + `}catch(e){}})()`;
}
function applyChromeThemeTo(wc: WebContents): void {
  try {
    if (wc.isDestroyed() || !isChromePageUrl(wc.getURL())) return;
    void wc.executeJavaScript(chromeThemeJs(currentChromeTheme)).catch(() => { /* вью уже закрыта */ });
  } catch { /* getURL на мёртвой вью */ }
}
function broadcastChromeTheme(): void {
  for (const wc of webContents.getAllWebContents()) applyChromeThemeTo(wc);
}

// Выбор человека + то, что сейчас говорит ОС. ⚠️ nativeTheme.themeSource мы НЕ трогаем: он
// управляет и тем, какой prefers-color-scheme видят САМИ САЙТЫ. Тёмный интерфейс браузера — не
// повод переключать в тёмное чужие страницы (Chrome тоже разводит это на два разных решения),
// поэтому отсюда только читаем.
function currentThemePrefs(): ThemePrefs {
  return {
    mode: settings.getThemeMode(),
    palette: settings.getThemePalette(),
    systemDark: nativeTheme.shouldUseDarkColors,
  };
}
let mainTabs: TabManager | null = null;
// Сессия одна на приложение и принадлежит главному окну: дерево вкладок из session.json — его
// (см. SessionManager.setOwner, срез 1). Лёгкие окна её не пишут и не читают.
let mainSess: SessionManager | null = null;
// Взводится ДО того, как tabs/sess начинают асинхронно обнуляться/дозакрываться (win.on('close')/
// before-quit) — сигнал побочным подписчикам onChange (сейчас только AiPanelManager.onTabsSynced)
// не синкаться во время выхода: AI-панель и так исчезает вместе с окном, а сама TabManager к этому
// моменту может уже дотла закрывать вкладки асинхронно. НЕ влияет на финальный автосейв — тот
// синхронный (win.on('close') ниже), от этого флага не зависит.
let isShuttingDown = false;
// Идёт ли прямо сейчас смысловой поиск вкладки (см. TABS_SEARCH_SMART) — один за раз на всё
// приложение, как и сама модель.
let smartTabSearchBusy = false;
// То же самое для поиска по настройкам фразой (см. SETTINGS_SEARCH_SMART).
let settingsSearchBusy = false;

// ── Отслеживание товаров (PRICE-TRACKING.md, срез 1) ────────────────────────
const tracking = new TrackingStore();
// Распознанный товар по вкладке. ⚠️ Кэш нужен, чтобы при переключении вкладок не лезть в
// страницу заново: индикатор обязан отвечать мгновенно, а распознавание асинхронно.
const productByTab = new Map<string, { url: string; signal: import('../shared/productSignal').ProductSignal }>();
// ⚠️ Пауза перед распознаванием: JSON-LD у части магазинов дорисовывается скриптом уже после
// did-navigate (замерено на Ozon — см. PRICE-TRACKING.md).
const PRODUCT_DETECT_DELAY_MS = 1800;

/** Товар на активной вкладке окна — для индикатора. null: страница не товарная. */
function productStateFor(win: BrowserWindow): ProductState | null {
  const ctx = contextForWindow(win);
  const active = ctx?.tabs.snapshot().find((t) => t.isActive && !t.isHub);
  if (!active) return null;
  const found = productByTab.get(active.id);
  // ⚠️ Сверяем адрес: вкладка могла уйти на другую страницу, а запись в кэше остаться — тогда
  // индикатор предлагал бы отслеживать товар, которого на экране уже нет.
  if (!found || found.url !== active.url) return null;
  return {
    title: found.signal.name,
    price: found.signal.price,
    currency: found.signal.currency,
    availability: found.signal.availability,
    tracked: tracking.idForUrl(active.url) !== null,
  };
}

function pushProductState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  contextForWindow(win)?.chromeView.webContents.send(IPC.PRODUCT_STATE, productStateFor(win));
}

/** Распознать товар на странице и обновить индикатор того окна, которому она принадлежит. */
async function refreshProductForWebContents(wc: Electron.WebContents): Promise<void> {
  if (wc.isDestroyed()) return;
  const ctx = allContexts().find((c) => c.tabs.ownsWebContents(wc.id));
  if (!ctx) return;
  const tabId = ctx.tabs.tabIdForWebContents(wc.id);
  if (!tabId) return;
  const url = wc.getURL();
  const signal = await detectProduct(wc);
  if (signal) {
    productByTab.set(tabId, { url, signal });
    // ⚠️ Уже отслеживаемому товару цена записывается САМА, без спроса: человек уже сказал «следи»,
    // и открытая им страница — самый достоверный и самый дешёвый источник наблюдения.
    const id = tracking.idForUrl(url);
    if (id !== null) tracking.addPoint(id, signal.price, signal.availability);
  } else {
    productByTab.delete(tabId);
  }
  pushProductState(ctx.win);
}

/**
 * Меню у индикатора товара. Нативное, как у звезды закладки: поповер здесь не нужен, а нативное
 * меню рисуется поверх нативной вью страницы без всяких ухищрений.
 */
function showProductMenu(win: BrowserWindow): void {
  const ctx = contextForWindow(win);
  const active = ctx?.tabs.snapshot().find((t) => t.isActive && !t.isHub);
  const state = productStateFor(win);
  if (!active || !state) return;
  const found = productByTab.get(active.id);
  if (!found) return;

  const price = `${state.price.toLocaleString('ru-RU')} ${state.currency === 'RUB' ? '₽' : state.currency}`;
  const template: MenuItemConstructorOptions[] = [
    { label: state.title.slice(0, 60), enabled: false },
    { label: `Сейчас ${price}`, enabled: false },
    { type: 'separator' },
  ];
  if (state.tracked) {
    template.push({
      label: 'Не отслеживать',
      click: () => {
        const id = tracking.idForUrl(active.url);
        if (id !== null) tracking.untrack(id);
        pushProductState(win);
        broadcastToChrome(IPC.TRACKING_CHANGED);
      },
    });
  } else {
    template.push({
      label: 'Отслеживать цену',
      click: () => {
        const newId = tracking.track({
          url: active.url,
          host: (() => { try { return new URL(active.url).hostname.replace(/^www\./, ''); } catch { return ''; } })(),
          title: found.signal.name,
          brand: found.signal.brand,
          sku: found.signal.sku,
          gtin: found.signal.gtin,
          mpn: found.signal.mpn,
          currency: found.signal.currency,
          price: found.signal.price,
          availability: found.signal.availability,
        });
        pushProductState(win);
        broadcastToChrome(IPC.TRACKING_CHANGED);
        // Поискать, нет ли того же товара в другом магазине. Коды склеят сами, модель — только
        // предложит (см. ProductMatcher). Фоном: человек нажал «отслеживать», а не «найди пару».
        if (newId !== null) {
          void findMatchFor(tracking, newId)
            .then(() => broadcastToChrome(IPC.TRACKING_CHANGED))
            .catch(() => { /* сопоставление не обязано получаться */ });
        }
      },
    });
  }
  template.push({ type: 'separator' });
  // ⚠️ Открываем СУЩЕСТВУЮЩИЙ вид вкладки с секцией, а не заводим новый: `kind` попадает в
  // session.json, и ради одного экрана менять формат сессии с реальными вкладками человека
  // несоразмерно риску (см. «Безопасность данных» в CLAUDE.md). Секция там уже поддержана.
  template.push({ label: 'Что я отслеживаю', click: () => { ctx?.tabs.createSpecialTab('history', 'tracking'); } });
  Menu.buildFromTemplate(template).popup({ window: win });
}
// То же для подсказки «вы это уже читали»: один запрос за раз на приложение.
let relatedBusy = false;
// И для смыслового Ctrl+F (см. SmartFind.ts). Второй Enter, пока идёт первый поиск, не должен
// вставать в очередь генерации: человек получил бы ответ на позапрошлый вопрос.
let smartFindBusy = false;
const adblock     = new AdBlockManager();
const bangs       = new BangStore();
// Правила-автоматизации (см. shared/rules.ts + RuleEngine.ts). Хранилище читается лениво, так что
// создавать его до whenReady() безопасно.
const rules       = new RuleStore();
// Включение VPN по правилу. Подставляется в registerIpc — там живёт вся VPN-обвязка (выбранный
// сервер, состояние процесса, прокси сессии), и дублировать её здесь было бы вторым источником
// правды. До подстановки правило про VPN просто ничего не делает.
let ensureVpnOnForRules: () => Promise<boolean> = async () => false;
// Выученные цели быстрого поиска (Ctrl+E) — сайты, где человек уже искал. Читается с диска
// лениво, на первое обращение (см. SearchTargetStore).
const searchTargets = new SearchTargetStore();
const updates     = new UpdateManager();
const history     = new HistoryManager();
setOrganizerHistoryManager(history);
const bookmarks   = new BookmarkManager();
// Импорт закладок — список создаётся один раз, isAvailable() зовётся заново на каждый
// BOOKMARK_IMPORT_LIST_SOURCES (профиль браузера-источника может появиться/пропасть между вызовами).
const bookmarkImporters = createChromiumImporters(bookmarks);
// Общий мультитиповый импорт (закладки/история/пароли + онбординг) — см. electron/browserImport/.
// Отдельно от bookmarkImporters выше (тот обслуживает только дропдаун панели закладок).
// Граф-воркспейс — свой файл graphs.sqlite, тот же паттерн «один менеджер, один файл».
const graphs      = new GraphStore();
const passwords   = new PasswordManager();
const autofill    = new AutofillManager();
const importManager = new ImportManager({ bookmarks, history, passwords });

// Гейт показа/копирования пароля через подтверждение Windows (electron/osAuth.ts). Успех держится
// ограниченное окно, чтобы серия действий (показать → скопировать → ещё раз) не дёргала диалог
// каждый раз. Хранится в памяти main, сбрасывается с рестартом.
const PASSWORD_AUTH_GRACE_MS = 5 * 60_000;
let lastPasswordAuthOk = 0;
async function ensurePasswordAuth(message: string): Promise<boolean> {
  if (!settings.getPasswordAuthEnabled()) return true;               // проверка выключена в настройках
  if (Date.now() - lastPasswordAuthOk < PASSWORD_AUTH_GRACE_MS) return true; // ещё в окне доверия
  const res = await verifyUser('Oblako — пароли', message);
  if (res === 'denied') return false;                                // отмена/исчерпаны попытки — не показываем
  // Окно доверия продлеваем ТОЛЬКО при реальном подтверждении Hello. При 'unavailable' (Hello не
  // настроен/сбой) разрешаем по месту (не лочим свои пароли), но окно НЕ ставим — иначе один сбой
  // молча отключил бы проверку на 5 минут (был такой баг с LogonUser).
  if (res === 'ok') lastPasswordAuthOk = Date.now();
  return true;
}
const downloads   = new DownloadManager();
const permissions = new PermissionManager();
const settings    = new SettingsManager();
const hubChat     = new HubChatManager();
const translationCache = new TranslationCacheManager();

// Реестр установленных GGUF-моделей (см. ModelRegistry.ts) — только чтение диска на этом этапе,
// ни один потребитель AI сейчас на него не завязан (TranslationService.ts всё ещё грузит модель
// по старому хардкоду). Сбой не должен ронять старт браузера — только лог.
try {
  ModelRegistry.init();
} catch (e) {
  console.error('[model-registry] init упал:', e);
}

// Уборка осиротевших .part-файлов (см. ModelDownloader.ts::cleanupOrphanedParts) — синхронно,
// прямо здесь, а не с задержкой в фоне: на этом этапе (до registerIpc()/показа окна) пользователь
// физически не может запустить новую загрузку, так что снести .part активной загрузки нельзя.
// Отложенный/фоновый вызов такой гарантии уже не даёт.
try {
  ModelDownloader.cleanupOrphanedParts();
} catch (e) {
  console.error('[model-download] уборка .part-файлов при старте упала:', e);
}

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
  broadcastToChrome(IPC.TRANSLATION_ENGINE_BERGAMOT_STATUS_CHANGED, status);
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

// Ленивый прогрев в режиме modelLoadMode==='on-demand' (см. SettingsManager.ts) — только по
// явному намерению пользователя поработать с AI (открытие AI-панели/хаба в режиме AI, см. вызовы
// ниже). НЕ вызывается с путей перевода выделения/страницы/реранка в умном поиске — те грузят
// модель по факту вызова через ensureLoaded(), как и раньше; иначе «ленивый» режим срабатывал бы,
// когда пользователь ничего от AI не просил (например, на первом же поиске по истории).
// warmupTranslation() сама дедуплицирует конкурентные вызовы (module-level loadPromise в
// TranslationService.ts) — повторное открытие панели/хаба не запускает вторую загрузку.
// Тот же guard на пустой реестр моделей, что у стартового прогрева (см. showWindow ниже) — не
// сыпать NO_MODEL_INSTALLED в консоль на каждое открытие панели без установленной модели.
// Отсрочка прогрева от самого клика. Загрузка модели — нативная работа llama.cpp, и она НЕ
// уступает event-loop main-процесса: замерено, что вызов прямо из обработчика съедает 382 мс
// подряд плюс серию всплесков 60–175 мс в следующие ~1.5 с. Всё это время окно не отвечает —
// именно так и ощущался «тормоз при переключении в AI-режим». Задержка ничего не ускоряет, но
// уводит фриз с кадра, в котором происходит переход: клик отрабатывает мгновенно, экран
// перерисовывается, и только потом начинается тяжёлое. Настоящее лечение — унести инференс из
// main в отдельный процесс, это отдельная большая задача (см. «Дорожная карта» в CLAUDE.md).
const WARMUP_DEFER_MS = 700;
let warmupTimer: NodeJS.Timeout | null = null;

function maybeLazyWarmupOnDemand(): void {
  if (settings.getModelLoadMode() !== 'on-demand') return;
  if (!ModelRegistry.getDefault()) return;
  if (warmupTimer) return; // прогрев уже назначен — второй таймер ни к чему
  warmupTimer = setTimeout(() => {
    warmupTimer = null;
    void warmupTranslation();
  }, WARMUP_DEFER_MS);
}

// Открытый холст графа должен перечитать граф, если тот пополнился из контекстного меню.
function notifyGraphChanged(graphId: number): void {
  broadcastToChrome(IPC.GRAPH_CHANGED, graphId);
}

// См. комментарий у SETTINGS_GET_HUB_MODE — отличает пассивное восстановление сессии (первый
// запрос режима хаба за процесс) от реальной навигации пользователя (все последующие).
let hubModeQueried = false;

// Создание окна. Роль решает, что окну достаётся сверх собственных вкладок: полное окно ('main')
// владеет сессией и теми менеджерами, что пока существуют в приложении в одном экземпляре
// (AI-панель, поповеры, быстрый поиск); лёгкое ('light') получает только своё — окно, слой хрома,
// свой TabManager и хоткеи. Общая проводка сессий (загрузки, разрешения, инкогнито) ставится один
// раз на приложение, а не на каждое окно, — иначе второе окно навесило бы вторых слушателей и
// каждая загрузка считалась бы дважды.
// Проводка, общая для всего приложения, а не для окна: орфография, перехват загрузок, разрешения
// сайтов, инкогнито-сессия. ⚠️ Ровно один раз за процесс. Раньше всё это жило в createWindow, и на
// macOS путь app.on('activate') уже мог позвать её повторно — второй downloads.attach навесил бы
// второй will-download, и каждая загрузка считалась бы дважды (см. AUDIT.md, п.9). Со вторым окном
// это перестаёт быть теорией.
let sharedSessionsWired = false;
function wireSharedSessions(): void {
  if (sharedSessionsWired) return;
  sharedSessionsWired = true;

  // Орфография (ru+en): одна сессия на все вкладки — одного вызова достаточно.
  session.defaultSession.setSpellCheckerLanguages(['ru', 'en-US']);

  // Клиентские подсказки Sec-CH-UA (см. BrowserIdentity.ts): Electron их не шлёт вовсе,
  // а без них наша строка UA «Chrome/144» противоречит поведению настоящего Chrome и вход
  // в аккаунт Google отвечает «This browser or app may not be secure».
  applyClientHints(session.defaultSession);

  // Доверие корню Минцифры — своё, внутри браузера, и только для банков из списка (см.
  // CertificateTrust.ts: там же разбор, почему список, а не «доверять везде»). Ставится и на
  // приватную сессию: в инкогнито Сбер должен открываться так же, как в обычной вкладке.
  installCertificateTrust(session.defaultSession);
  installCertificateTrust(session.fromPartition(INCOGNITO_PARTITION));

  // Тема, известная main'у ДО того, как хром успеет её прислать. Без этого поповер, созданный
  // раньше первого CHROME_THEME_SET, открывался бы светлым в тёмной теме — видимая вспышка.
  const startPrefs = currentThemePrefs();
  currentChromeTheme = { dark: isDarkTheme(startPrefs), incognito: false, palette: startPrefs.palette };

  // Система переключила светлую/тёмную (расписание Windows или руками в параметрах). Значение
  // хранит ОС, а не мы, поэтому здесь только пересылка: окна с режимом «как в системе» перекрасятся
  // сами, с явно выбранной темой — проигнорируют (см. App.tsx). Подписка живёт в wireSharedSessions,
  // а не в createWindow: nativeTheme один на приложение, второе окно навесило бы второго слушателя.
  nativeTheme.on('updated', () => {
    broadcastToChrome(IPC.THEME_CHANGED, currentThemePrefs());
  });

  // Перехватываем все загрузки на дефолтной сессии (вкладки partition не задают). Список загрузок
  // общий для приложения — потому и рассылка во все окна, а не пуш в одно.
  // Поведение сохранения из настроек — до первой загрузки, иначе первый же файл ушёл бы по
  // дефолтному правилу вместо выбранного человеком.
  downloads.setAskLocation(settings.getAskDownloadLocation());
  downloads.attach(session.defaultSession, (entries) => {
    broadcastToChrome(IPC.DOWNLOADS_CHANGED, entries);
    // Отдельным пушем — в открытый поповер: broadcastToChrome доходит только до слоёв хрома,
    // а поповер живёт своей WebContentsView и иначе показывал бы замерший прогресс.
    broadcastDownloads(entries);
  });

  // Разрешения: хендлер на дефолтной сессии + на инкогнито-сессии (ниже) — обе через один колбэк.
  // ⚠️ Запрос приходит от вкладки, но PermissionManager не сообщает, от какой именно, — поэтому
  // приглашение уходит в главное окно. Со вторым окном это станет заметно (запрос камеры из окна
  // B всплывёт в окне A) и чинится вместе с остальными оверлеями, когда те научатся находить
  // своё окно.
  const onPermissionRequest = (req: PermissionRequest, requesterWcId: number | null) => {
    // ⚠️ Окно ищем по САМОЙ странице-просителю, а не берём главное: запрос камеры из второго
    // окна раньше всплывал в первом — человек видел вопрос там, где ничего не нажимал.
    const owner = requesterWcId === null
      ? null
      : allContexts().find((c) => c.tabs.ownsWebContents(requesterWcId)) ?? null;
    const win = owner?.win ?? mainWin;
    if (!win) return;
    // FindBar живёт в том же углу контентной зоны — двум оверлеям там тесно.
    owner?.tabs.stopFind();
    closeFindBar(win);
    showPermissionRequest(win, req);
  };
  permissions.attach(session.defaultSession, onPermissionRequest);

  // Инкогнито-сессия (in-memory, см. INCOGNITO_PARTITION). Привязываем к ней тот же набор, что к
  // дефолтной, чтобы приватный режим был НЕ хуже обычного: адблок, загрузки, разрешения. Прокси
  // VPN — в applyVpnProxy (обязательно, иначе инкогнито-трафик тёк бы мимо VPN/kill-switch).
  incognitoSession = session.fromPartition(INCOGNITO_PARTITION);
  applyClientHints(incognitoSession); // приватная вкладка обязана выглядеть НЕ подозрительнее обычной
  adblock.attachSession(incognitoSession);
  downloads.observeSession(incognitoSession);
  permissions.attach(incognitoSession, onPermissionRequest);
  applyVpnProxy(); // синхронизируем прокси инкогнито-сессии с текущим состоянием VPN сразу

  // Пароли и автозаполнение форм. Ставится один раз на приложение, хотя работает в каждом окне:
  // и поповеры, и оркестраторы теперь получают окно на каждом вызове, а вкладки берут из реестра
  // по нему — своего состояния «на одно окно» у них не осталось. Пуши уходят в слой хрома ТОГО
  // окна, где событие произошло: индикатор-«ключ» и закрытие поповера — про его активную вкладку.
  const chromeOfWin = (w: BrowserWindow) => contextForWindow(w)?.chromeView.webContents ?? null;
  initPasswordPopover((w) => chromeOfWin(w)?.send(IPC.PASSWORD_POPOVER_CLOSED));
  // Поповер загрузок — тоже один на приложение, но адресуется по окну: кнопка есть в каждом.
  // «Все загрузки» переиспользует канал Ctrl+J (DOWNLOADS_OPEN) — это ровно то же действие,
  // и заводить второй путь к одному разделу значило бы разъехаться в поведении.
  initDownloadsPopover(
    (w) => chromeOfWin(w)?.send(IPC.DOWNLOADS_POPOVER_CLOSED),
    (w) => chromeOfWin(w)?.send(IPC.DOWNLOADS_OPEN),
  );
  // Поповер сведений о сайте — та же схема адресации по окну: замочек есть в каждом.
  initSitePopover((w) => chromeOfWin(w)?.send(IPC.SITE_POPOVER_CLOSED));

  // Вопрос «этот файл уже скачан». ⚠️ Открывает поповер не main, а ХРОМ: якорь (позиция значка
  // загрузок) известен только ему, и открытие мимо обычного пути оставило бы кнопку неподсвеченной
  // и поповер в неверном месте. Main лишь кладёт вопрос и просит открыть — дальше обычный путь.
  downloads.setDuplicatePrompt((wc, prompt) => {
    setDuplicatePrompt(prompt);
    const win = BrowserWindow.fromWebContents(wc) ?? contextFromSender(wc)?.win ?? null;
    const chrome = win ? chromeOfWin(win) : null;
    if (chrome) chrome.send(IPC.DOWNLOAD_DUPLICATE_ASK);
    // Окна не нашли (загрузка из фоновой вью) — вопрос задать некому, честно отменяем.
    else downloads.resolveDuplicate(prompt.askId, 'cancel');
  });
  setDuplicateDecisionHandler((askId, decision) => downloads.resolveDuplicate(askId, decision));
  // Автозаполнение форм: оркестратор (хранилище ↔ страница ↔ поповер) + поповер выбора профиля.
  // onPick поповера — подстановка выбранного адреса в ту вкладку, где было сфокусировано поле.
  autofillOrchestrator.initAutofillOrchestrator(autofill);
  // Выбор в поповере: адрес подставляем сразу; карту — только после подтверждения Windows Hello
  // (полный номер — чувствительный, тот же гейт, что показ пароля/номера в настройках).
  initAutofillPopover(
    // Поповер закрылся (крестик, клик мимо, Esc) — незавершённый разбор вставки забываем:
    // молчаливое согласие тут недопустимо, значения не должны пережить отказ.
    (w) => { autofillOrchestrator.forgetParsedPaste(w); },
    (w, id) => {
      if (autofillOrchestrator.getLastKind(w) === 'card') {
        void ensurePasswordAuth('Заполнить данные карты').then((ok) => {
          if (ok) autofillOrchestrator.handleFillCard(w, id);
        });
      } else {
        autofillOrchestrator.handleFillAddress(w, id);
      }
    },
    // «Сохранить» из предложения offer-save — кладём в хранилище и обновляем список в настройках.
    (w) => { if (autofillOrchestrator.saveSubmitted(w)) broadcastToChrome(IPC.AUTOFILL_CHANGED); },
    // «Разложить» из предложения разбора вставки — подставляем в ту вкладку, где вставляли.
    (w) => { autofillOrchestrator.handleApplyParsedPaste(w); },
  );
  // Менеджер паролей, шаг 2: индикатор push идёт в chrome (не в конкретную вкладку) —
  // PASSWORDS_CHANGED переиспользует существующий канал шага 1 (список в Settings→Пароли).
  passwordAutofill.init(
    passwords,
    // Индикатор в омнибоксе — про АКТИВНУЮ вкладку своего окна, поэтому адресный пуш, не рассылка.
    (w, state) => chromeOfWin(w)?.send(IPC.PASSWORDS_INDICATOR_CHANGED, state),
    // А сам сейф один на приложение — список паролей обязан обновиться во всех окнах.
    () => broadcastToChrome(IPC.PASSWORDS_CHANGED),
  );
}

function createWindow(role: WindowRole = 'main') {
  const isMain = role === 'main';
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#F2F2F7', // ровно --app-bg, чтобы не мигало белым и не было шва под шапкой
    // Кастомный titlebar: системные кнопки в своём оформлении (спека, тех.стек).
    // show:false — против белого экрана: окно покажем, когда React-оболочка отрисуется
    // (сигнал CHROME_UI_READY из src/main.tsx), с fallback-таймаутом ниже.
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#F2F2F7',   // --app-bg светлой темы; обновляется через IPC при смене темы
      symbolColor: '#3C3C43',
      height: 56,
    },
  });

  // Слой хрома (сайдбар+тулбар+хаб) — обычный WebContentsView во всё окно.
  const chromeView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload использует ipcRenderer — sandbox off только для хрома
    },
  });
  win.contentView.addChildView(chromeView);
  // AI-панель пока одна на приложение — её пуши состояния дока идут в главное окно (заход 3:
  // не в win.webContents, а в слой хрома).
  if (isMain) setAiPanelChromeView(chromeView);
  // Дефолтный фон WebContentsView — белый, и он перекрывает backgroundColor окна на всю площадь.
  // Красим под --app-bg, чтобы кадры до первой отрисовки React были цветом интерфейса.
  chromeView.setBackgroundColor('#F2F2F7');

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
        // ⚠️ Показ окна НЕ отдаёт фокус ни одной вью внутри него, и каретка в адресной строке об
        // этом не говорит: DOM-фокус (Toolbar.tsx честно ставит его в поле) и фокус ВЬЮ — разные
        // вещи. Замерено настоящими клавишами ОС (SendKeys в переднее окно, а не CDP — тот
        // доставляет ввод прямо в рендерер мимо маршрутизации): после запуска окно переднее,
        // каретка в строке, document.hasFocus() в чроме false, набранное не доезжает никуда.
        // focusActiveView() выбирает адресата сам — живая страница себе, хаб/спящая вкладка чрому.
        tabs?.focusActiveView();
        console.log(`[startup] show reason=${reason} ${Date.now() - startT0}ms`);
      }
      // Заставка уходит ровно здесь: после неё человек сразу видит готовое окно, без
      // промежуточного кадра с пустотой.
      closeSplash();
      // Фоновый прогрев локальной LLM (перевод/AI-действия/чат) — только теперь, когда окно уже
      // реально показано, и с задержкой (см. TRANSLATION_WARMUP_DELAY_MS): не соревнуется за
      // диск/GPU с первой отрисовкой чрома и пробуждением активной вкладки. warmupTranslation()
      // сама не блокирует и не бросает наружу — ensureLoaded() внутри дедуплицирует конкурентные
      // вызовы (см. её же комментарий), так что ранний клик пользователя по AI-функции просто
      // дождётся ЭТОЙ ЖЕ загрузки, а не запустит вторую.
      // Прогревы — про приложение, а не про окно: второй показ не должен запускать их заново.
      if (!isMain) return;
      setTimeout(() => {
        if (!thisWin.isDestroyed()) {
          // modelLoadMode==='on-demand' (дефолт, см. SettingsManager.ts) — прогрев на старте
          // пропускается, модель поднимется по явному намерению пользователя (см.
          // maybeLazyWarmupOnDemand выше, вызовы у AI_PANEL_TOGGLE/SETTINGS_*_HUB_MODE ниже).
          // Без модели в реестре (ModelRegistry.ts) ensureLoaded() внутри warmupTranslation()
          // гарантированно упадёт с NO_MODEL_INSTALLED — не дёргаем её вовсе, чтобы не сыпать
          // исключением в консоль на каждом старте без установленной модели.
          if (settings.getModelLoadMode() !== 'startup') {
            console.log('[startup] modelLoadMode=on-demand — прогрев Qwen отложен до открытия AI');
          } else if (ModelRegistry.getDefault()) {
            void warmupTranslation();
          } else {
            console.log('[startup] GGUF-модель не установлена — прогрев Qwen пропущен');
          }
        }
        // Bergamot — свой воркер (см. BergamotService.ts), не конкурирует с Qwen за VRAM/диск,
        // но всё равно на той же задержке: не соревнуется с первой отрисовкой чрома.
        void warmupBergamot();
      }, TRANSLATION_WARMUP_DELAY_MS);
      // Прогрев AI-панели — своя, более ранняя задержка (см. AI_PANEL_PREWARM_DELAY_MS): лёгкий
      // прогрев (не модель), staggered отдельно от warmupTranslation/warmupBergamot выше, чтобы не
      // бить оба прогрева в одну точку старта.
      setTimeout(() => {
        if (!thisWin.isDestroyed()) prewarmPanel();
      }, AI_PANEL_PREWARM_DELAY_MS);
    };
    // ⚠️ Сигнал принимаем только от СВОЕГО слоя хрома: канал общий на приложение, и окно,
    // созданное вторым, показалось бы по чужой готовности — до того, как отрисуется само.
    const onUiReady = (e: Electron.IpcMainEvent) => {
      if (e.sender === chromeView.webContents) showWindow('ui-ready');
    };
    ipcMain.on(IPC.CHROME_UI_READY, onUiReady);
    const fallbackTimer = setTimeout(() => showWindow('fallback-timeout'), 3000);
    // Окно закрыли до показа (или до сигнала) — подчистить, чтобы таймер/слушатель не дёргали труп.
    thisWin.on('closed', () => {
      shown = true;
      clearTimeout(fallbackTimer);
      ipcMain.removeListener(IPC.CHROME_UI_READY, onUiReady);
    });
  }

  const layoutChrome = () => {
    const { width, height } = win.getContentBounds();
    chromeView.setBounds({ x: 0, y: 0, width, height });
  };
  layoutChrome();
  win.on('resize', layoutChrome);

  wireSharedSessions();

  // Сессия — только у главного окна (см. mainSess): дерево вкладок в session.json принадлежит ему.
  // Лёгкое окно её не читает и не пишет, поэтому и восстанавливать ему нечего.
  const sess = isMain ? new SessionManager() : null;
  const restored = sess?.load() ?? null; // загружаем ДО создания TabManager

  // Менеджер вкладок — СВОЙ у каждого окна. Обнуляется в win.on('closed'), поэтому let и null:
  // часть вкладок дозакрывается асинхронно уже после закрытия окна, и колбэки ниже обязаны это
  // пережить (см. гарды `tabs?.` внутри).
  let tabs: TabManager | null = null;

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
        hasRenameSnapshot: tabs.hasRenameSnapshot(),
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
    (r: FindResult) => sendFindResult(win, r),
    ()              => { if (win && tabs?.getActiveWebContents()) showFindBar(win); }, // Ctrl+F: не открываем на хабе (getActiveWebContents()===null)
    ()              => {
      tabs?.stopFind(); closeFindBar(win); tabs?.focusActiveView(); // Esc-на-странице/did-navigate — вернуть OS-фокус, иначе Ctrl+F повторно не долетит
      // Ушли со страницы (или нажали Esc) — её вопрос про камеру больше не актуален. Молча
      // убрать карточку нельзя: колбэк Chromium останется висеть, поэтому отвечаем «нет».
      if (win) for (const id of dropPermissionRequests(win)) permissions.cancel(id);
    },
    ()              => chromeView?.webContents.send(IPC.OMNIBOX_FOCUS),
    ()              => chromeView?.webContents.focus(),
    (url, title, wc) => {
      history.recordVisit(url, title);
      // Тот же адрес — материал для целей быстрого поиска: если он похож на выдачу, сайт
      // становится целью Ctrl+E навсегда. Колбэк не приходит для инкогнито (TabManager),
      // поэтому приватные вкладки сюда не попадают по построению.
      searchTargets.learnFromUrl(url);
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
      // Товар на странице (PRICE-TRACKING.md). ⚠️ С задержкой: JSON-LD у части магазинов
      // дорисовывается скриптом уже после did-navigate. Ничего не показываем и не пишем — только
      // запоминаем, чтобы индикатор в тулбаре знал, есть ли тут что отслеживать.
      setTimeout(() => { void refreshProductForWebContents(wc); }, PRODUCT_DETECT_DELAY_MS);
    },
    (url, title)    => history.updateTitle(url, title),
    ()              => chromeView?.webContents.send(IPC.HISTORY_OPEN),
    ()              => console.log(`[startup] firsttab ${Date.now() - startT0}ms`),
    (action, text, rect, wc, canReplace, targetLang) => {
      // Поповер у выделения, поверх контента (см. TranslatePopoverManager.ts) — не панель в чроме.
      // Ленивый: WebContentsView+preload поповера создаются только этим вызовом. Один поповер на
      // все AI-действия (перевод/выжимка/пересказ/объяснение/правка) — action меняет только промпт.
      // canReplace — текст взят из поля ввода, поповер покажет «Заменить в поле». targetLang —
      // явная цель перевода («Перевести на английский»), только для action='translate'.
      if (win) showTranslatePopover(win, action, text, rect, wc, canReplace, targetLang);
    },
    // Заход 6: дропдаун подсказок — та же логика, что у поповера/FindBar (анкерен к прежней
    // вкладке, безусловный main-side хук на КАЖДУЮ реальную смену активной, а не только
    // renderer-side реакция на смену tab.id — та могла разойтись с фактом прикрепления вью).
    () => {
      // Снимок привязан к той вкладке, которую сняли: над чужой страницей карточке не место.
      closeTranslatePopoverOnTabSwitch(); closeFindBar(win); closeSearchPopover(); hideSuggestDropdown(win); closePasswordPopover(win); closeAutofillPopover(win); closeVpnPopover(); closeDownloadsPopover(); closeSitePopover(); closeScreenshot(win);
      // Вопрос о разрешении привязан к конкретной странице — над чужой вкладкой ему не место.
      if (win) for (const id of dropPermissionRequests(win)) permissions.cancel(id);
      // Менеджер паролей, шаг 2: индикатор в omnibox всегда про АКТИВНУЮ вкладку — пересылаем
      // её текущее состояние (или null) при каждом реальном переключении.
      passwordAutofill.onActiveTabChanged(win);
      // Индикатор товара — тоже всегда про АКТИВНУЮ вкладку.
      pushProductState(win);
    },
    (wc, tabId) => {
      closeTranslatePopoverForClosedTab(wc); closePasswordPopover(win); closeAutofillPopover(win); closeVpnPopover(); closeDownloadsPopover(); closeSitePopover(); closeScreenshot(win); passwordAutofill.onTabClosed(tabId);
      // Закрылась последняя инкогнито-вкладка → стираем in-memory данные приватной сессии (куки/
      // хранилище), Chrome-подобно. takeIncognitoClearIfDone сам знает, когда это уместно (работает
      // и для кнопки, и для хоткея Ctrl+Shift+N).
      if (tabs?.takeIncognitoClearIfDone()) void incognitoSession?.clearStorageData();
    },
    // Заход 5: реальный клик в контент вкладки (не blur омнибокса) — закрывает дропдаун подсказок
    // в chrome, см. shared/ipc.ts::SUGGEST_DROPDOWN_CONTENT_FOCUS, Toolbar.tsx.
    () => {
      chromeView?.webContents.send(IPC.SUGGEST_DROPDOWN_CONTENT_FOCUS);
      closePasswordPopover(win);
      closeAutofillPopover(win);
      closeVpnPopover();
      closeDownloadsPopover();
      // ⚠️ Без этой строки поповер сайта не закрывался кликом по странице: слушатель «клика мимо»
      // живёт в слое хрома, а клики по странице до него не доходят вовсе — страница это отдельная
      // нативная вью. Закрывать такие поповеры умеет только main, по этому самому сигналу.
      closeSitePopover();
    },
    // Менеджер паролей, шаг 2, коммит 2 — сигналы content-preload идут в PasswordAutofillManager,
    // который сверяется с сейфом и решает, показывать ли индикатор/поповер.
    (tabId, hasLoginForm, hasUsernameField, url) => passwordAutofill.handleFormDetected(win, tabId, hasLoginForm, hasUsernameField, url),
    // В инкогнито не предлагаем СОХРАНИТЬ пароль (заполнение уже сохранённым — работает, как Chrome).
    (tabId, username, password, url) => { if (!tabs?.isIncognito(tabId)) passwordAutofill.handleCredentialSubmitted(win, tabId, username, password, url); },
    // Иконка в поле пароля — та же карточка, что у тулбарной иконки-ключа (PasswordPopoverManager),
    // просто заякорена на позицию поля. rect приходит в координатах вьюпорта СТРАНИЦЫ —
    // прибавляем bounds именно ЭТОЙ вкладки (не активной вообще — split может показывать другую).
    (tabId, rect, url) => {
      const state = passwordAutofill.handleFieldIconClick(win, tabId, url);
      if (!state || !tabs) return;
      const viewBounds = tabs.getTabViewBounds(tabId);
      syncPasswordPopoverAnchorBounds(win, {
        x: viewBounds.x + rect.x, y: viewBounds.y + rect.y,
        width: rect.width, height: rect.height,
      });
      showPasswordPopover(win, state);
    },
    // Автозаполнение — фокус на поле адреса/карты показывает поповер выбора, заякоренный на поле
    // (та же трансляция координат вьюпорта страницы в оконные, что у иконки пароля). Адреса и карты
    // не привязаны к origin — показываем все сохранённые.
    (tabId, rect, kind, url) => {
      void url; // адреса/карты не привязаны к origin — url нужен был бы лишь для отсечки схем
      if (!tabs) return;
      const state = kind === 'card'
        ? (() => { const cards = autofillOrchestrator.handleCardFieldFocus(win, tabId); return cards ? { kind: 'card' as const, cards } : null; })()
        : (() => { const list = autofillOrchestrator.handleAddressFieldFocus(win, tabId); return list ? { kind: 'address' as const, addresses: list } : null; })();
      if (!state) return;
      const viewBounds = tabs.getTabViewBounds(tabId);
      syncAutofillPopoverAnchorBounds(win, {
        x: viewBounds.x + rect.x, y: viewBounds.y + rect.y,
        width: rect.width, height: rect.height,
      });
      showAutofillPopover(win, state);
    },
    // Отправка формы с адресом/картой → предложение сохранить. Поповер якорим к верху окна
    // (форма отправлена, поля-якоря могло не остаться) — как «пузырь» под тулбаром справа.
    (tabId, kind, fields, url) => {
      void url;
      // В инкогнито не предлагаем сохранить адрес/карту (как Chrome) — приватная сессия следов не оставляет.
      if (tabs?.isIncognito(tabId)) return;
      const state = autofillOrchestrator.handleAutofillSubmit(win, kind, fields);
      if (!state) return;
      const cb = win.getContentBounds();
      syncAutofillPopoverAnchorBounds(win, { x: Math.max(8, cb.width - 316), y: 48, width: 0, height: 0 });
      showAutofillPopover(win, state);
    },
  );
  // Страница просит убрать поповер автозаполнения: Esc, уход фокуса с поля, прокрутка.
  // ⚠️ Раньше закрыть его было НЕЧЕМ вовсе — ни клавишей, ни кликом мимо: он уходил только при
  // смене вкладки, её закрытии или навигации. На форме входа, где он всплывал по ошибке, это
  // означало карточку, висящую над полем до самого ухода со страницы.
  tabs.setOnAutofillDismiss(() => closeAutofillPopover(win));

  // Вставленная в поле строка с адресом целиком (AI-IDEAS.md №1) → разбираем локальной моделью и
  // ПРЕДЛАГАЕМ разложить. Ничего не подставляем до явного «Разложить».
  // ⚠️ В инкогнито не лезем: приватная вкладка не оставляет следов, а разбор адреса — работа с
  // самыми личными данными, которую человек в этом режиме точно не заказывал (то же решение, что
  // у offer-save выше и у списка загрузок).
  tabs.setOnAutofillPasteBlob((tabId, text, rect) => {
    if (!tabs || tabs.isIncognito(tabId)) return;
    void parseAddressBlob(text).then((parts) => {
      if (parts.length === 0 || win.isDestroyed()) return;
      // За время разбора человек мог уйти со страницы или закрыть вкладку — тогда предлагать нечего.
      if (!tabs || tabs.snapshot().every((t) => t.id !== tabId)) return;
      const state = autofillOrchestrator.handleParsedPaste(win, tabId, parts);
      if (!state) return;
      const viewBounds = tabs.getTabViewBounds(tabId);
      syncAutofillPopoverAnchorBounds(win, {
        x: viewBounds.x + rect.x, y: viewBounds.y + rect.y,
        width: rect.width, height: rect.height,
      });
      showAutofillPopover(win, state);
    }).catch((e) => console.warn('[address-parse] ошибка:', e));
  });

  // Ссылка в стороннее приложение, открытая новым окном (частый способ уйти на оплату).
  tabs.setOnExternalOpen((url, fromHost) => { void openExternalWithConsent(win, url, fromHost); });

  // Регистрируем окно в реестре — с этого момента его находят по отправителю IPC. Владелец
  // сессии ставится тут же: дерево вкладок принадлежит полному окну, и только его снимок имеет
  // право попасть в session.json (см. SessionManager.setOwner) — чужой отбрасывается молча.
  const ctx = { win, chromeView, tabs, role };
  registerWindow(ctx);
  sess?.setOwner(tabs);
  if (isMain) { mainWin = win; mainChromeView = chromeView; mainTabs = tabs; mainSess = sess; }

  // Применяем сохранённый выбор поисковика (дефолт duckduckgo, если настройки ещё нет).
  tabs.setSearchEngine(settings.getSearchEngine());
  tabs.setBangStore(bangs); // бэнги омнибокса — см. TabManager.resolveInput/resolveBang
  // Поиск по странице — СВОЙ у каждого окна (FindBarManager.ts), поэтому регистрируется всегда:
  // менеджер вкладок нужен ему, чтобы вернуть OS-фокус активной вкладке после закрытия по IPC
  // (крестик/Esc-в-поле), см. FindBarManager.ts::ensureIpcRegistered.
  setFindBarTabManager(win, tabs);
  // Снимок вкладки (Ctrl+Shift+S) — тоже СВОЙ у каждого окна: снимают ту вкладку, в чьём окне
  // нажали, включая лёгкие. Менеджеру карточки вкладки нужны и для самого снимка, и чтобы
  // вернуть странице фокус, если карточка его перехватила (см. ScreenshotManager.ts).
  // Распознавание полей формы моделью — второй эшелон автозаполнения (см. AutofillFieldMapper.ts).
  // Валидацию присланного страницей делаем ЗДЕСЬ: сюда приходит payload с гостевого сайта, и он
  // может быть каким угодно.
  tabs.setAutofillFieldMapper(async (origin, raw) => {
    if (!Array.isArray(raw)) return {};
    const fields: FormFieldDescriptor[] = [];
    for (const item of raw.slice(0, 12)) {
      if (!item || typeof item !== 'object') continue;
      const f = item as Record<string, unknown>;
      if (typeof f.i !== 'number' || !Number.isInteger(f.i) || f.i < 0 || f.i > 200) continue;
      const str = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 80) : '');
      fields.push({ i: f.i, label: str(f.label), name: str(f.name), placeholder: str(f.placeholder), type: str(f.type) || 'text' });
    }
    return await mapFormFields(origin, fields);
  });
  setScreenshotTabManager(win, tabs);
  tabs.setOnScreenshot(() => { if (win && tabs) void captureTabScreenshot(win, tabs); });
  tabs.setOnScreenshotSave(() => { if (win) saveCurrentScreenshot(win); });
  tabs.setOnScreenshotClose(() => closeScreenshot(win));
  // ⚠️ Ниже — служба, которая существует в приложении в ОДНОМ экземпляре и помнит ровно один
  // менеджер вкладок. Регистрирует её только полное окно: лёгкое, записавшись последним, увело
  // бы службу себе, и, например, Ctrl+E из главного окна открывал бы найденное в лёгком.
  // Развязка по окнам — следующий срез.
  if (isMain) {
    // Единственная точка, где AiPanelManager получает доступ к вкладкам — только для чтения
    // WebContents активной вкладки при извлечении текста страницы в чат (Заход 4), см.
    // TabManager.getActiveWebContents(). Не влияет на управление вкладками.
    setTabManager(tabs);
    // Прогрев модели по намерению поговорить (фокус в поле ввода панели). Политика прогрева —
    // здесь, панель о ней не знает; сам maybeLazyWarmupOnDemand по-прежнему отсрочен и уважает
    // режим загрузки модели и пустой реестр.
    setOnAiPanelChatIntent(() => maybeLazyWarmupOnDemand());
    // Быстрый поиск (Ctrl+E): поповеру нужен тот же возврат OS-фокуса странице, что и FindBar,
    // а решение «куда открыть найденное» остаётся здесь — вкладками владеет main.
    setSearchPopoverTabManager(tabs);
    // Узлу-веб-приложению графа — только чтобы target=_blank со стороннего сайта уходил
    // обычной вкладкой Oblako, а не отдельным Chromium-окном (как у WebAppManager).
    setGraphWebAppTabManager(tabs);
    // Извлечению — доступ к открытым вкладкам: страница, уже открытая пользователем, прошла
    // антибот и дорисована, и читать надо её, а не открывать сайт вторым заходом.
    setNotebookExtractTabManager(tabs);
  }
  // ПКМ по ссылке на странице → «Добавить в граф». Пункт строит main (у него хранилище),
  // TabManager только вставляет готовое в своё меню.
  tabs.setGraphMenuBuilder((items, sticker) =>
    buildAddToGraphMenuItem(graphs, items, sticker, notifyGraphChanged));
  // Правила-автоматизации: срабатывают в КАЖДОМ окне, включая лёгкие — группы, закреп и адблок
  // там есть, и правило, работающее только в главном окне, было бы правилом «иногда».
  tabs.setRuleHook((ev) => {
    const active = rules.active();
    if (active.length === 0) return; // самый частый случай — ни одного правила заведено
    void applyRules(active, ev, {
      groupTab: (tabId, name) => tabs?.putTabInNamedGroup(tabId, name),
      pinTab:   (tabId)       => tabs?.pinTab(tabId),
      adblockOff: (domain)    => adblock.addDomain(domain),
      ensureVpnOn: ()         => ensureVpnOnForRules(),
      reloadTab: (tabId)      => tabs?.reload(tabId),
    });
  });
  // Тоже служба в одном экземпляре — только полное окно (см. оговорку выше).
  if (isMain) {
    setOnSearchRun(({ query, target, sameTab }) => {
      if (!tabs) return;
      // Бэнг в строке главнее выбранного чипа и разбирается ЗДЕСЬ, а не в поповере: BangStore
      // видит все три источника (свои, встроенные, импортированные), а второй парсер в вью
      // неминуемо разъехался бы с этим. Раньше строка уходила в шаблон цели как есть — и
      // «!wb Xiaomi» честно искалось в гугле вместе с самим «!wb».
      const bang = resolvePopoverBang(query);
      const effectiveTarget = bang?.target ?? target;
      const effectiveQuery = bang?.query ?? query;
      // Шаблон приходит из вью поповера. Она наша (не веб-страница), но проверка обязательна:
      // навигация по неподтверждённому шаблону — ровно то, от чего защищается импорт бэнгов.
      if (!isValidBangTemplate(effectiveTarget.template)) return;
      // «!wb» без запроса — на главную сайта, как в омнибоксе: цель названа, искать нечего.
      const url = effectiveQuery
        ? applyBangTemplate(effectiveTarget.template, effectiveQuery)
        : bangHomeUrl({ key: '', name: '', template: effectiveTarget.template });
      searchTargets.noteUse(effectiveTarget.template); // частые цели поднимаются в полосе чипов

      if (sameTab) tabs.navigate(tabs.getActiveId(), url);
      else tabs.createTab(url);
    });
    // Поиск по своим данным для того же поповера: открытые вкладки, история, закладки.
    // Всё синхронное и дешёвое — LIKE по истории и фильтр по памяти: запрос идёт на каждое
    // нажатие клавиши, тяжёлому умному поиску (FTS5 + переранжирование Qwen, HistorySearch.ts)
    // здесь не место, он живёт в панели истории, где его ждут дольше 100 мс.
    setOnQuickQuery((text) => {
      // Бэнг разбираем на КАЖДЫЙ ввод, чтобы поповер показал цель сразу, как её назвали, а не
      // только после Enter: иначе набравший «!wb» не понимает, услышали его или нет.
      const bang = resolvePopoverBang(text);
      const effective = bang?.query ?? text;
      return {
        hits: quickHits(effective),
        bangTarget: bang?.target ?? null,
        strippedQuery: effective,
      };
    });
  }
  // Разбор бэнга из строки поповера: null — бэнга нет (обычный запрос).
  function resolvePopoverBang(text: string): { target: SearchTarget; query: string } | null {
    const parsed = parseBangCandidate(text);
    if (!parsed) return null;
    const bang = bangs.find(parsed.key);
    if (!bang) return null; // неизвестный ключ бэнгом не считается — как и в омнибоксе
    return {
      target: {
        id: `bang:${bang.key}`, name: bang.name, kind: 'bang',
        template: bang.template, bangKey: bang.key,
      },
      query: parsed.query,
    };
  }
  function quickHits(text: string): QuickHit[] {
    const q = text.trim().toLowerCase();
    if (q.length < 2 || !tabs) return [];
    const hits: QuickHit[] = [];
    const seen = new Set<string>();
    const add = (h: QuickHit): void => {
      const key = h.kind === 'tab' ? `tab:${h.tabId}` : h.url;
      if (seen.has(key)) return;
      seen.add(key);
      hits.push(h);
    };
    const matches = (title: string, url: string): boolean =>
      title.toLowerCase().includes(q) || url.toLowerCase().includes(q);

    // Открытые вкладки — первыми: «где я это уже видел» чаще всего означает «оно ещё открыто»,
    // и переключение дешевле открытия копии. Инкогнито из выдачи исключаем: приватная вкладка
    // не должна всплывать в общем поиске.
    for (const t of tabs.snapshot()) {
      if (hits.length >= 3) break;
      if (t.isHub || t.incognito || !t.url) continue;
      if (matches(t.title, t.url)) {
        add({ kind: 'tab', tabId: t.id, url: t.url, title: t.title || t.url, faviconUrl: t.faviconUrl });
      }
    }

    for (const b of bookmarks.list()) {
      if (hits.length >= 6) break;
      if (matches(b.title ?? '', b.url)) {
        add({ kind: 'bookmark', url: b.url, title: b.title || b.url });
      }
    }

    for (const h of history.search(text.trim())) {
      if (hits.length >= 9) break;
      add({ kind: 'history', url: h.url, title: h.title || h.url });
    }

    return hits;
  }
  // Тоже служба в одном экземпляре — только полное окно (см. оговорку выше).
  if (isMain) {
    setOnQuickOpen((hit) => {
      if (!tabs) return;
      // Вкладка уже открыта — переключаемся на неё, а не плодим копию. Если её успели закрыть
      // между показом и выбором, открываем адрес заново: пустой клик хуже лишней вкладки.
      if (hit.kind === 'tab' && hit.tabId && tabs.snapshot().some((t) => t.id === hit.tabId)) {
        tabs.activate(hit.tabId);
        return;
      }
      tabs.createTab(hit.url);
    });
  }
  // Новое окно по Ctrl+N — из любого окна; создаётся всегда лёгкое (полное ровно одно).
  tabs.setOnNewWindow(() => { createWindow('light'); });
  // Ctrl+D — то же меню, что у звезды в омнибоксе; Ctrl+Shift+O — раздел закладок. Оба хоткея
  // работают и на странице, и в хроме, поэтому висят на TabManager, а не на слое чрома.
  tabs.setOnBookmarkPage(() => { if (tabs) void showBookmarkMenu(win, tabs); });
  tabs.setOnBookmarksOpen(() => { tabs?.createSpecialTab('bookmarks'); });
  // ПКМ по ссылке → «Открыть ссылку в новом окне». Сразу заводим вкладку в НОВОМ окне, а не
  // «создать здесь и перенести»: промежуточная вкладка мелькнула бы в этом окне и успела бы
  // попасть в его дерево и автосейв.
  tabs.setOnOpenInNewWindow((url) => { createWindow('light').tabs.createTab(url); });
  // Ctrl+Shift+M — вернуть активную вкладку в другое окно. Цель выбираем сами: из лёгкого окна
  // это всегда главное (обратный жест к «вытащил по ошибке»), из главного — единственное лёгкое,
  // если оно одно. Когда лёгких несколько, гадать не нужно — для выбора есть меню.
  tabs.setOnReturnTab((tabId) => {
    const others = allContexts().filter((c) => c.win.id !== win?.id && !c.win.isDestroyed());
    const target = others.find((c) => c.role === 'main') ?? (others.length === 1 ? others[0] : null);
    if (target && tabs) moveTabToExistingWindow(tabs, tabId, target.win.id);
  });
  // ⚠️ Быстрый поиск (Ctrl+E) регистрируем только у полного окна: сам поповер — служба-одиночка,
  // и найденное он открывает через setOnQuickOpen, который принадлежит полному окну. В лёгком
  // окне колбэк просто не назначен, и хоткей молча ничего не делает (см. onQuickSearchCb?.()).
  if (isMain) tabs.setOnQuickSearch(() => {
    void (async () => {
      if (!win || !tabs) return;
      const wc = tabs.getActiveWebContents();
      if (!wc) return; // хаб: там своя поисковая строка, поповер поверх неё был бы дублем
      const active = tabs.snapshot().find((t) => t.isActive);
      // Выделенный текст — самый частый повод жать Ctrl+E, поэтому он же и запрос по умолчанию.
      // Через executeJavaScript, а не через контекстное меню (как у AI-поповера): у хоткея
      // никакого params.selectionText нет. Ограничение длины — чтобы случайно выделенная
      // простыня не уехала в поле целиком.
      //
      // Гонка с таймаутом, а не голый await: чтение выделения — УДОБСТВО, а поповер по хоткею
      // обязан появиться всегда. Занятый главный поток страницы (тяжёлый скрипт, зависший
      // фрейм) не должен превращать Ctrl+E в «ничего не произошло».
      // Опрос идёт по фреймам (см. PageSelection.ts): в верхнем документе выделения может не
      // быть вовсе, если страница собрана из iframe — как весь интерфейс Intercom.
      const sel = await Promise.race([
        readPageSelection(wc).catch(() => ''),
        new Promise<string>((r) => setTimeout(() => r(''), 250)),
      ]);
      const prefill = sel.trim().replace(/\s+/g, ' ').slice(0, 200);
      const targets = buildSearchTargets({
        url: active?.url ?? '',
        engineId: settings.getSearchEngine(),
        faviconUrl: active?.faviconUrl ?? null,
        bangs,
        learned: searchTargets,
        chips: settings.getSearchChips(),
      });
      // Иконки целям — через FaviconService (тот ходит ТОЛЬКО на сам домен, без сторонних
      // favicon-сервисов, и кэширует на диск). Да, при первом показе это запрос к каждому
      // домену из полосы — но домены тут либо свои бэнги, либо сайты, где человек уже искал,
      // и после первого раза всё берётся из кэша.
      //
      // Гонка с таймаутом по той же причине, что и чтение выделения: иконка — украшение,
      // поповер обязан появиться сразу. Не успевшие подтянутся при следующем открытии.
      await Promise.race([
        Promise.all(targets.map(async (t) => {
          if (t.faviconUrl) return;
          try {
            const host = new URL(applyBangTemplate(t.template, 'x')).hostname;
            t.faviconUrl = await faviconService.get(host);
          } catch { /* кривой шаблон — просто без иконки */ }
        })),
        new Promise((r) => setTimeout(r, 250)),
      ]);
      showSearchPopover(win, { targets, prefill });
    })();
  });
  // Тоже служба в одном экземпляре — только полное окно (см. оговорку выше).
  if (isMain) {
    // Аналогично — PageTranslateManager читает WebContents активной вкладки для обхода DOM/
    // применения перевода (executeJavaScript), не управляет вкладками.
    setPageTranslateTabManager(tabs);
    // TabOrganizer.ts (Qwen-группировка вкладок) — читает sidebarNodesSnapshot()/snapshot(),
    // управлением вкладок не занимается (применение — через уже существующий organizeApply/
    // TabManager.applyOrganize()).
    setOrganizerTabManager(tabs);
    onPageTranslateStateChanged((state) => {
      chromeView?.webContents.send(IPC.PAGE_TRANSLATE_STATE_CHANGED, state);
    });
    onPageTranslateProgressChanged((progress) => {
      chromeView?.webContents.send(IPC.PAGE_TRANSLATE_PROGRESS_CHANGED, progress);
    });
    initVpnPopover(() => chromeView?.webContents.send(IPC.VPN_POPOVER_CLOSED));
  }

  // Восстанавливаем вкладки из session.json (v4: nodes[] с группами; v1/v2/v3 мигрированы).
  if (restored) {
    // Закреплённые сначала — стабильный порядок, всегда вверху сайдбара. Рождаются СПЯЩИМИ
    // (createSleepingPinnedTab — раньше здесь был createPinnedTab, реальный WebContentsView+
    // loadURL для КАЖДОЙ сразу: 10 закреплённых = 10 параллельных загрузок страниц на старте,
    // видимый пик CPU). Закреплённость больше не значит «грузить eagerly» — только activeRef
    // ниже решает, кого разбудить; будет ли разбуженная вкладка закреплённой или нет, роли не
    // играет (см. activate()::wakeTab — ему всё равно, откуда пришёл id, tabMap/pinnedTabs же
    // общий индекс).
    const pinnedIds: string[] = [];
    const pinnedUrlToId = new Map<string, string>();
    for (const { url, title, faviconData } of restored.pinnedTabs) {
      const id = tabs.createSleepingPinnedTab(url, title, faviconData);
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
    // ref.type === 'hub' → остаёмся на хабе (дефолт TabManager) — единственный НАМЕРЕННЫЙ случай
    // без targetId. Любой другой (activeRef битый/указывает на несуществующую вкладку — старая
    // ссылка на URL, которого больше нет, повреждённый JSON и т.п.) теперь тоже дал бы пустой
    // targetId — раньше это было безобидно (все вкладки уже жили eagerly, хаб был просто не тем
    // экраном), теперь, когда всё спит по умолчанию, обвал разрешения activeRef молча оставил бы
    // старт БЕЗ единой живой вкладки. Фоллбэк: первая по порядку сайдбара (pinned, потом обычные —
    // тот же порядок, что и в tabs.snapshot()), лишь бы не пустой экран без реального контента.
    if (!targetId && ref.type !== 'hub') {
      targetId = tabs.snapshot().find((t) => !t.isHub)?.id;
    }
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

  // Только после восстановления разрешаем автосейв (у лёгкого окна сессии нет вовсе).
  sess?.enable();

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
  tabs.registerHotkeyHandler(chromeView.webContents, 'chrome');

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
  //
  // ⚠️ Всё, что здесь делается, — про ВЫХОД ИЗ ПРИЛОЖЕНИЯ, а не про закрытие окна: сохранение
  // сессии, флаг остановки, убийство xray.exe. Закрытие лёгкого окна не должно ни ронять VPN,
  // ни трогать session.json — иначе окно с одной вкладкой унесло бы за собой дерево из десятков.
  win.on('close', () => {
    if (!isMain) { console.log('[shutdown] закрыто лёгкое окно — сессия и VPN не тронуты'); return; }
    isShuttingDown = true; // до сохранения — далее tabs/sess ещё какое-то время живы, но выходим
    console.log('[shutdown] win close: старт, isShuttingDown=true, сохраняю сессию');
    if (tabs && sess) sess.saveNow(tabs.getSessionSnapshot(), tabs);
    console.log('[shutdown] win close: сессия сохранена');
    // Windows не убивает дочерние процессы автоматически при выходе родителя — без явной
    // остановки xray.exe продолжил бы висеть в фоне (и туннелировать трафик) уже после
    // закрытия браузера. Fire-and-forget — не блокируем закрытие окна ожиданием.
    void vpnProcess.stop();
  });

  // Контекст наружу — вызывающей стороне (перенос вкладки) нужен менеджер вкладок нового окна.
  // Возврат стоит ДО подписок на закрытие ниже только ради читаемости — они уже навешены выше.
  win.on('closed', () => {
    console.log(`[shutdown] win closed (${role}): обнуляю вкладки окна`);
    tabs?.dispose(); // снять таймер сна — он переживает окно и ходил бы по мёртвому менеджеру
    tabs = null;
    // Запасные ссылки на главное окно снимаем только вместе с ним самим — иначе закрытие
    // лёгкого окна оставило бы приложение без адресата для отправителей вне реестра.
    if (isMain) { mainWin = null; mainChromeView = null; mainTabs = null; mainSess = null; }
  });

  return ctx; // вызывающей стороне (перенос вкладки) нужен менеджер вкладок нового окна
}

// Перенос вкладки в новое окно. Порядок важен: сначала СНИМАЕМ вкладку со старого окна и только
// потом создаём новое. Наоборот — и при отказе снять (спящая, split, закреплённая) на экране
// осталось бы пустое окно, которого никто не просил.
function moveTabToNewWindow(from: TabManager, tabId: string): boolean {
  const detached = from.detachTabForMove(tabId);
  if (!detached) return false;
  const target = createWindow('light');
  if (target.tabs.adoptTab(detached)) return true;
  // Новое окно вкладку не приняло (страница успела умереть) — не бросаем вью в никуда.
  if (detached.kind === 'live' && !detached.view.webContents.isDestroyed()) {
    (detached.view.webContents as unknown as { close?: () => void }).close?.();
  }
  return false;
}

// Обратный жест: вернуть вкладку в УЖЕ ОТКРЫТОЕ окно. Нужен, потому что вытащить вкладку легко
// (и легко случайно), а вернуть было нечем — оставалось закрыть окно вместе со страницей.
// Тот же порядок, что при выносе: сначала снять, потом отдать.
function moveTabToExistingWindow(from: TabManager, tabId: string, targetWindowId: number): boolean {
  const target = allContexts().find((c) => c.win.id === targetWindowId && !c.win.isDestroyed());
  if (!target || target.tabs === from) return false;
  const detached = from.detachTabForMove(tabId);
  if (!detached) return false;
  if (!target.tabs.adoptTab(detached)) {
    if (detached.kind === 'live' && !detached.view.webContents.isDestroyed()) {
      (detached.view.webContents as unknown as { close?: () => void }).close?.();
    }
    return false;
  }
  // Окно-приёмник поднимаем: вкладка уехала туда, и смотреть человеку теперь надо туда же.
  if (target.win.isMinimized()) target.win.restore();
  target.win.focus();
  console.log(`[window] вкладка переехала в окно ${target.win.id} (${target.role})`);
  closeIfEmptyLight(from);
  return true;
}

// Запуск переименования из меню.
//
// ⚠️ Ход работы показываем ПОДПИСЬЮ САМОЙ ВКЛАДКИ, а не тостом: прогон Qwen занимает секунды,
// молчащий пункт меню в это время выглядит как «ничего не произошло», а отдельной системы
// уведомлений в чроме нет — заводить её ради одного сообщения дороже, чем сказать то же самое
// в том месте, куда человек и так смотрит.
async function renameTabSmart(tabs: TabManager, tabId: string): Promise<void> {
  const before = tabs.snapshot().find((t) => t.id === tabId);
  if (!before) return;
  tabs.setAiTitle(tabId, 'Придумываю название…');

  const res = await suggestTabTitle(tabs.getWebContentsForTab(tabId), before.title, before.url);

  // ⚠️ За время прогона человек мог уйти на другую страницу — did-navigate уже снял временную
  // подпись, и ставить готовое имя поверх новой страницы значило бы соврать. Сверяем адрес.
  const after = tabs.snapshot().find((t) => t.id === tabId);
  if (!after || after.url !== before.url) return;

  tabs.setAiTitle(tabId, res.ok ? res.title : null);
  if (!res.ok) console.warn(`[rename] не вышло: ${res.error}`);
}

// Пункты «вернуть вкладку в другое окно» для ПКМ-меню. Одно чужое окно — одна прямая команда;
// несколько — подменю со списком. Главное окно называем главным, а не по заголовку страницы:
// заголовок меняется от вкладки к вкладке, а «главное» — устойчивый ориентир.
function buildMoveToWindowItems(
  win: BrowserWindow, from: TabManager, tabId: string, enabled: boolean,
): MenuItemConstructorOptions[] {
  const others = allContexts().filter((c) => c.win.id !== win.id && !c.win.isDestroyed());
  if (others.length === 0) return [];
  const nameOf = (c: { role: WindowRole; win: BrowserWindow }, i: number): string =>
    c.role === 'main' ? 'главное окно' : `окно ${i + 1}`;
  if (others.length === 1) {
    return [{
      label: `Вернуть в ${nameOf(others[0], 0)}`,
      enabled,
      click: () => { moveTabToExistingWindow(from, tabId, others[0].win.id); },
    }];
  }
  return [{
    label: 'Перенести в окно',
    enabled,
    submenu: others.map((c, i) => ({
      label: nameOf(c, i),
      click: () => { moveTabToExistingWindow(from, tabId, c.win.id); },
    })),
  }];
}

/**
 * Звезда в омнибоксе и Ctrl+D — одно и то же действие.
 *
 * ⚠️ Страница СНАЧАЛА сохраняется, и только потом предлагается папка. Порядок не косметический:
 * человек нажал «в закладки», и результат этого нажатия не должен зависеть от того, выберет ли
 * он что-то в меню дальше. Закрыл меню мимо — закладка всё равно сохранена, как в Chrome.
 *
 * ⚠️ Меню НАТИВНОЕ, а не свой поповер. Своя вью потребовалась бы (как у паролей и VPN) только
 * ради того, чтобы выпасть ПОВЕРХ страницы — нативное меню это умеет само, силами ОС, и не
 * заводит ни четвёртого entry в vite.config, ни своего preload ради выбора из списка папок.
 */
// ⚠️ Асинхронна из-за подсказки папки: нативное меню после popup() изменить нечем, поэтому ответ
// модели нужен ДО показа. Задержка возникает только на тёплой модели (иначе гейт возвращает null
// сразу), и сама закладка сохраняется ДО ожидания — звезда загорается мгновенно, ждёт только меню.
async function showBookmarkMenu(win: BrowserWindow, tabs: TabManager): Promise<void> {
  const wc = tabs.getActiveWebContents();
  if (!wc) return;
  const url = wc.getURL();
  if (!url || !/^https?:/i.test(url)) return; // хаб и служебные страницы в закладки не идут
  const title = wc.getTitle() || url;

  const existing = bookmarks.listTree();
  const findByUrl = (nodes: BookmarkNode[]): BookmarkNode | null => {
    for (const n of nodes) {
      if (n.kind === 'link' && n.url === url) return n;
      const hit = n.children ? findByUrl(n.children) : null;
      if (hit) return hit;
    }
    return null;
  };

  let entry = findByUrl(existing);
  if (!entry) {
    const added = bookmarks.add(url, title);
    if (!added) return;
    entry = { ...added, children: undefined };
    broadcastToChrome(IPC.BOOKMARK_CHANGED);
  }
  const bookmarkId = entry.id;
  const currentParent = entry.parentId;

  // Плоский перечень папок с отступами — вложенность в нативном меню показать больше нечем.
  // Путь от корня собираем тем же обходом: он нужен модели, чтобы различить две папки «Разное»
  // в разных родителях (в самом меню вложенность видна отступом).
  const folders: { id: number; title: string; depth: number; path: string }[] = [];
  const walk = (nodes: BookmarkNode[], depth: number, prefix: string): void => {
    for (const n of nodes) {
      if (n.kind !== 'folder') continue;
      const path = prefix ? `${prefix} / ${n.title}` : n.title;
      folders.push({ id: n.id, title: n.title, depth, path });
      walk(n.children ?? [], depth + 1, path);
    }
  };
  walk(bookmarks.listTree(), 0, '');

  // Подсказка папки (AI-IDEAS.md №2) — только для закладки, лежащей В КОРНЕ. То, что человек уже
  // разложил руками, модель не трогает: это его решение, и мы его не понимаем (тот же принцип,
  // что в BookmarkOrganizer.ts). На холодной модели вернётся null мгновенно, без задержки меню.
  const suggestedId = currentParent === null
    ? await suggestFolderForBookmark(title, url, folders.map((f) => ({ id: f.id, path: f.path })))
    : null;
  const suggested = folders.find((f) => f.id === suggestedId) ?? null;
  // За время генерации окно могли закрыть — всплывать тогда некуда.
  if (win.isDestroyed()) return;

  const pick = (parentId: number | null): void => {
    if (bookmarks.move(bookmarkId, parentId)) broadcastToChrome(IPC.BOOKMARK_CHANGED);
  };

  const template: MenuItemConstructorOptions[] = [
    { label: 'Сохранено в закладки', enabled: false },
    // ⚠️ Подсказка — ОТДЕЛЬНЫЙ пункт-действие, а не предвыбранный radio в списке ниже. Отметка
    // означает «закладка лежит здесь», и поставить её на непроизошедший перенос значило бы
    // соврать: человек закрыл бы меню, не нажав ничего, а закладка осталась бы в корне.
    ...(suggested
      ? [
          { type: 'separator' } as MenuItemConstructorOptions,
          { label: `Положить в «${suggested.title}»`, click: () => pick(suggested.id) },
        ]
      : []),
    { type: 'separator' },
    { label: 'Все закладки', type: 'radio', checked: currentParent === null, click: () => pick(null) },
    ...folders.map((f): MenuItemConstructorOptions => ({
      label: `${'    '.repeat(f.depth)}${f.title}`,
      type: 'radio',
      checked: currentParent === f.id,
      click: () => pick(f.id),
    })),
    { type: 'separator' },
    {
      label: 'Удалить из закладок',
      click: () => { bookmarks.remove(bookmarkId); broadcastToChrome(IPC.BOOKMARK_CHANGED); },
    },
  ];
  Menu.buildFromTemplate(template).popup({ window: win });
}

// Лёгкое окно, из которого унесли последнюю страницу, закрываем: пустое окно с одним хабом на
// экране — мусор, которого никто не просил (так же ведёт себя Chrome). Полное окно не трогаем
// НИКОГДА: оно владеет сессией, и его закрытие — это выход из приложения.
function closeIfEmptyLight(from: TabManager): void {
  const ctx = allContexts().find((c) => c.tabs === from);
  if (!ctx || ctx.role !== 'light' || ctx.win.isDestroyed()) return;
  if (ctx.tabs.snapshot().some((t) => !t.isHub)) return;
  ctx.win.close();
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
  // Инкогнито-сессия ОБЯЗАНА следовать тем же прокси/kill-switch, иначе приватный трафик тёк бы
  // мимо VPN (утечка). Держим её в синхроне при каждой смене состояния VPN.
  void incognitoSession?.setProxy({ proxyRules });
}

// Для «Скопировать содержимое» группы (GROUP_SHOW_MENU) — title/url там из чужих страниц,
// не доверенный ввод; экранируем перед склейкой в HTML-строку для буфера обмена.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeHtmlAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// ── IPC: renderer (хром) управляет движком вкладок ──
function registerIpc() {
  // Менеджер вкладок ТОГО окна, из которого пришёл вызов. Пока окно одно, это всегда он же —
  // но со вторым окном разница станет решающей: без маршрутизации клик в новом окне менял бы
  // вкладки в старом. Запасной путь на глобальный tabs оставлен для отправителей, которых нет
  // в реестре (ранние сообщения при старте, изолированные тестовые окна).
  const tabsOf = (e: { sender: Electron.WebContents }) => contextFromSender(e.sender)?.tabs ?? mainTabs;
  // Окно отправителя — для диалогов, меню и оверлеев: они обязаны открываться над тем окном,
  // где человек кликнул, а не над первым попавшимся.
  const winOf = (e: { sender: Electron.WebContents }) => contextFromSender(e.sender)?.win ?? mainWin;
  // Слой хрома отправителя — для ОТВЕТНЫХ пушей: стрим чата хаба, прогресс узла графа,
  // приглашение переименовать папку. Это ответ на конкретный запрос, а не общее состояние
  // приложения, — рассылать его во все окна (broadcastToChrome) значило бы вписывать чужой
  // ответ в чат соседнего окна.
  const chromeOf = (e: { sender: Electron.WebContents }) =>
    contextFromSender(e.sender)?.chromeView.webContents ?? mainChromeView?.webContents ?? null;
  // Адресат запоминается в момент запроса, а ответ приходит асинхронно — окно к тому времени
  // может закрыться, и send по мёртвому webContents бросит. Прежний код от этого защищал `?.`
  // по обнуляемой глобальной переменной; с захваченной ссылкой нужна явная проверка.
  const sendTo = (wc: Electron.WebContents | null, channel: string, ...args: unknown[]): void => {
    if (wc && !wc.isDestroyed()) wc.send(channel, ...args);
  };

  ipcMain.handle(IPC.SYNC_GET, (e) => ({
    tabs:  tabsOf(e)?.snapshot()              ?? [],
    nodes: tabsOf(e)?.sidebarNodesSnapshot() ?? [],
    hasOrganizeSnapshot: tabsOf(e)?.hasOrganizeSnapshot() ?? false,
    hasRenameSnapshot: tabsOf(e)?.hasRenameSnapshot() ?? false,
  }));
  ipcMain.handle(IPC.TABS_GET_ALL, (e) => tabsOf(e)?.snapshot() ?? []);
  // Тема chrome (light/dark + инкогнито + палитра) от главного рендерера → раскидываем во все наши вью.
  ipcMain.handle(IPC.CHROME_THEME_SET, (_e, dark: boolean, incognito: boolean, palette: ThemePaletteId) => {
    currentChromeTheme = {
      dark: !!dark,
      incognito: !!incognito,
      // Пришло из рендерера — значит недоверенное; промах гасим базовой палитрой, а не пишем
      // в атрибут произвольную строку.
      palette: (THEME_PALETTE_IDS as readonly string[]).includes(palette) ? palette : 'charcoal',
    };
    broadcastChromeTheme();
  });
  // Выбор темы: читает настройки, пишет настройки, рассылает всем окнам. Применяет по-прежнему
  // рендерер у себя (см. App.tsx) — main только владеет значением и системным признаком.
  ipcMain.handle(IPC.THEME_GET, (): ThemePrefs => currentThemePrefs());
  ipcMain.handle(IPC.THEME_SET, (_e, mode: ThemeMode, palette: ThemePaletteId) => {
    settings.setTheme(mode, palette);
    broadcastToChrome(IPC.THEME_CHANGED, currentThemePrefs());
  });
  ipcMain.handle(IPC.TAB_CREATE, (e, url?: string) => tabsOf(e)?.createTab(url));
  ipcMain.handle(IPC.TAB_CREATE_INCOGNITO, (e, url?: string) => tabsOf(e)?.createTab(url, false, false, true));
  ipcMain.handle(IPC.TAB_CREATE_SPECIAL, (e, kind: 'history' | 'settings' | 'bookmarks', section?: string) => tabsOf(e)?.createSpecialTab(kind, section));
  ipcMain.handle(IPC.TAB_CLOSE, (e, id: string) => tabsOf(e)?.closeTab(id));
  ipcMain.handle(IPC.TAB_ACTIVATE, (e, id: string) => tabsOf(e)?.activate(id));
  ipcMain.handle(IPC.TAB_NAVIGATE, (e, id: string, input: string) => tabsOf(e)?.navigate(id, input));
  ipcMain.handle(IPC.TAB_GO_BACK, (e, id: string) => tabsOf(e)?.goBack(id));
  ipcMain.handle(IPC.TAB_GO_FORWARD, (e, id: string) => tabsOf(e)?.goForward(id));
  ipcMain.handle(IPC.TAB_RELOAD, (e, id: string) => tabsOf(e)?.reload(id));
  // Поиск вкладки по смыслу (см. TabSearch.ts). ⚠️ ОДИН запрос за раз: очередь генерации в
  // проекте общая и FIFO (withQwenQueue), а человек в омнибоксе печатает быстрее, чем модель
  // отвечает. Без этого гварда каждая буква превращалась бы в отдельный прогон, и они выстроились
  // бы в хвост, заняв модель на десятки секунд ради подсказки, которая давно устарела.
  ipcMain.handle(IPC.TABS_SEARCH_SMART, async (e, query: string): Promise<SmartTabHit[]> => {
    const from = contextFromSender(e.sender);
    // ⚠️ Только на ТЁПЛОЙ модели. Замерено: холодная загрузка 9B — 31 секунда и ~6 ГБ VRAM.
    // Человек, печатающий фразу в омнибоксе, этого не заказывал; подсказка не стоит того, чтобы
    // поднимать модель. Пока она холодная, фича просто молчит — а после первого явного обращения
    // к AI (перевод, панель, правка текста) начинает работать сама собой.
    if (!from || smartTabSearchBusy || !isModelWarm()) return [];
    smartTabSearchBusy = true;
    try {
      // ⚠️ Кандидаты — со ВСЕХ окон (AI-IDEAS.md №8). Своё окно идёт первым: при равной
      // уверенности модели человеку ближе то, что у него перед глазами, а порядок списка —
      // единственное, чем мы можем это выразить.
      const own = allContexts().filter((c) => c.win.id === from.win.id);
      const others = allContexts().filter((c) => c.win.id !== from.win.id);
      const candidates = [...own, ...others].flatMap((ctx) =>
        ctx.tabs.snapshot().map((tab) => ({ tab, windowId: ctx.win.id })),
      );
      const picked = await searchTabsByMeaning(query, candidates);
      return picked.map((c) => ({
        tabId: c.tab.id,
        windowId: c.windowId,
        title: c.tab.title,
        url: c.tab.url,
        // Считаем ЗДЕСЬ: «в другом окне» — факт про спрашивающего, и renderer своего id не знает.
        otherWindow: c.windowId !== from.win.id,
      }));
    } catch (err) {
      console.warn('[tab-search] ошибка:', err);
      return [];
    } finally {
      smartTabSearchBusy = false;
    }
  });
  // Переход к вкладке в ДРУГОМ окне: поднимаем то окно и делаем вкладку активной в нём.
  // ⚠️ Окно ищем в реестре по id, а не доверяем присланному числу как индексу: окно могли
  // закрыть, пока человек читал подсказку.
  ipcMain.handle(IPC.TAB_ACTIVATE_IN_WINDOW, (_e, windowId: number, tabId: string) => {
    const ctx = allContexts().find((c) => c.win.id === windowId);
    if (!ctx || ctx.win.isDestroyed()) return;
    ctx.tabs.activate(tabId);
    if (ctx.win.isMinimized()) ctx.win.restore();
    ctx.win.focus();
  });
  // «Вы это уже читали» — связанное из своей истории для АКТИВНОЙ вкладки (см. RelatedHistory.ts).
  // ⚠️ Адрес и заголовок берём из менеджера вкладок окна-отправителя, а не из аргументов: рендерер
  // мог отстать от навигации, и подсказка тогда относилась бы к предыдущей странице.
  ipcMain.handle(IPC.HISTORY_RELATED, async (e): Promise<SemanticSearchResult[]> => {
    const tabs = tabsOf(e);
    const active = tabs?.snapshot().find((t) => t.isActive && !t.isHub);
    if (!active?.url || relatedBusy) return [];
    relatedBusy = true;
    try {
      return await findRelatedPages(history, active.url, active.title || '');
    } catch (err) {
      console.warn('[related] ошибка:', err);
      return [];
    } finally {
      relatedBusy = false;
    }
  });
  // «Что изменилось с прошлого раза» (AI-IDEAS.md №7, см. PageChanges.ts) — для АКТИВНОЙ вкладки.
  // ⚠️ Адрес и живая вью берутся из менеджера вкладок окна-отправителя, а не из аргументов: то же
  // правило, что у «вы это уже читали» — рендерер мог отстать от навигации.
  // ⚠️ Приватную вкладку не трогаем: её визитов нет в истории, сравнивать не с чем по построению,
  // а лезть в неё за текстом страницы тем более незачем.
  ipcMain.handle(IPC.PAGE_CHANGES_GET, async (e): Promise<PageChangesResult> => {
    const tabs = tabsOf(e);
    const active = tabs?.snapshot().find((t) => t.isActive && !t.isHub);
    if (!tabs || !active?.url || tabs.isIncognito(active.id)) return { changed: false };
    return getPageChanges(history, active.url, tabs.getActiveWebContents());
  });
  // «Куда я это дел» (AI-IDEAS.md №4) — один поиск по истории, закладкам и загрузкам.
  // Явное действие человека (Enter), поэтому без гейта тёплой модели и пользовательской полосой.
  ipcMain.handle(IPC.STUFF_SEARCH, (_e, query: string) => searchStuff(history, bookmarks, downloads, query));

  // Отслеживание товаров (PRICE-TRACKING.md, срез 1).
  ipcMain.handle(IPC.PRODUCT_MENU, (e) => {
    const ctx = contextFromSender(e.sender);
    if (ctx) showProductMenu(ctx.win);
  });
  ipcMain.handle(IPC.TRACKING_LIST, (): TrackedProduct[] => tracking.list());
  ipcMain.handle(IPC.TRACKING_EVENTS, () => tracking.listEvents());
  ipcMain.handle(IPC.TRACKING_NOTIFY_GET, () => tracking.notificationsEnabled());
  ipcMain.handle(IPC.TRACKING_NOTIFY_SET, (_e, on: boolean) => { tracking.setNotificationsEnabled(on); });
  ipcMain.handle(IPC.TRACKING_SUGGESTIONS, () => tracking.listSuggestions());
  ipcMain.handle(IPC.TRACKING_MERGE, (_e, aId: number, bId: number) => {
    tracking.joinGroup(aId, bId);
    broadcastToChrome(IPC.TRACKING_CHANGED);
  });
  ipcMain.handle(IPC.TRACKING_MERGE_DISMISS, (_e, aId: number, bId: number) => {
    tracking.dismissSuggestion(aId, bId);
    broadcastToChrome(IPC.TRACKING_CHANGED);
  });
  ipcMain.handle(IPC.TRACKING_UNGROUP, (_e, id: number) => {
    tracking.leaveGroup(id);
    broadcastToChrome(IPC.TRACKING_CHANGED);
  });
  // ⚠️ Проверка по кнопке идёт БЕЗ пауз и без гейта «давно не проверяли»: человек нажал и ждёт.
  // Фоновая, наоборот, редкая и с паузами — см. TrackingChecker.
  ipcMain.handle(IPC.TRACKING_CHECK_NOW, async () => {
    const res = await checkAllNow();
    broadcastToChrome(IPC.TRACKING_CHANGED);
    return res;
  });
  ipcMain.handle(IPC.TRACKING_UNTRACK, (e, id: number) => {
    tracking.untrack(id);
    broadcastToChrome(IPC.TRACKING_CHANGED);
    const ctx = contextFromSender(e.sender);
    if (ctx) pushProductState(ctx.win);
  });

  // «Итоги дня» (см. DayDigest.ts). GET модель не трогает вовсе — отдаёт готовое или «нет».
  ipcMain.handle(IPC.DIGEST_GET, (): DayDigestState => {
    // Заодно решаем, не пора ли обновить фоном: условие внутри (прошёл час И прибавилось
    // страниц) и только на тёплой модели, так что обычно это дешёвая проверка без последствий.
    if (shouldRefresh((since) => history.getSince(since))) {
      // ⚠️ Результат НИКУДА не пушим намеренно. Виджет спрашивает итог сам при каждом открытии
      // новой вкладки, а открывают её десятки раз в день — пересобранный фоном итог доедет до
      // экрана без единого лишнего канала. Пуш здесь был бы каналом, который слушать некому:
      // именно так и появляются «живые» сообщения, уходящие в пустоту.
      void buildDigest((since) => history.getSince(since), false)
        .catch(() => { /* фоновая пересборка — не повод шуметь */ });
    }
    return getDigest();
  });
  // Явное «собрать» — человек нажал кнопку и готов подождать загрузку модели.
  ipcMain.handle(IPC.DIGEST_BUILD, (): Promise<DayDigestState> =>
    buildDigest((since) => history.getSince(since), true));
  ipcMain.handle(IPC.CONTENT_SET_BOUNDS, (e, b: ContentBounds) => {
    tabsOf(e)?.setContentBounds(b);
    // Та же геометрия двигает FindBar — центрирование по контентной зоне (учитывает сайдбар) и
    // авто-скрытие при настройках/истории/загрузках (нулевые bounds — тот же сентинел, см. FindBarManager.ts).
    const fbWin = winOf(e);
    if (fbWin) {
      syncFindBarBounds(fbWin, b);
      syncDropZoneBounds(fbWin, b); // та же геометрия — зоны дропа рисуются ровно по контенту
      syncScreenshotBounds(fbWin, b); // карточка снимка сидит в правом нижнем углу контента
      syncPermissionPopoverBounds(fbWin, b); // и запрос разрешения — он тоже привязан к контенту
    }
    syncSearchPopoverBounds(b); // тот же сентинел нулевых bounds — прячем поповер вместе с контентом
  });
  // Прямоугольник омнибокса — двигает нативную вью дропдауна подсказок (см.
  // shared/ipc.ts::IPC.OMNIBOX_SET_BOUNDS, SuggestDropdownManager.ts) — старый chrome-DOM
  // дропдаун этот канал не читает, продолжает позиционироваться от toolbarRef как раньше.
  ipcMain.handle(IPC.OMNIBOX_SET_BOUNDS, (e, b: ContentBounds) => {
    // Лог убран: канал горячий (ResizeObserver омнибокса + смена ширины тулбара), в проде это
    // поток строк ни о чём — см. CLAUDE.md, «уровни логирования; в prod — без URL/текстов».
    const w = winOf(e);
    if (w) syncOmniboxBounds(w, b);
  });
  // Тумблер показа вью дропдауна — вешается на тот же момент, что и старый React-дропдаун
  // (Toolbar.tsx::openDropdown/closeDropdown), который пока не заменяет (работают параллельно).
  ipcMain.handle(IPC.SUGGEST_DROPDOWN_TOGGLE, (e, open: boolean) => {
    const w = winOf(e);
    if (open) {
      if (w) showSuggestDropdown(w);
      // Показ дропдауна — момент, когда фокус уходит чаще всего. Страж (onSuggestDropdownFocusStolen
      // выше) поймает это и сам, но возвращаем фокус ещё и здесь, синхронно: так между показом и
      // откатом не остаётся кадра, в котором клавиатура «не там».
      chromeOf(e)?.focus();
    } else {
      hideSuggestDropdown(w);
    }
  });
  ipcMain.handle(IPC.PASSWORD_POPOVER_SET_BOUNDS, (e, b: ContentBounds) => {
    const w = winOf(e);
    if (w) syncPasswordPopoverAnchorBounds(w, b);
  });
  ipcMain.handle(IPC.PASSWORD_POPOVER_SHOW, (e, state) => {
    const w = winOf(e);
    if (w) showPasswordPopover(w, state);
  });
  ipcMain.handle(IPC.PASSWORD_POPOVER_CLOSE, (e) => {
    closePasswordPopover(winOf(e));
  });
  ipcMain.handle(IPC.VPN_POPOVER_SET_BOUNDS, (_e, b: ContentBounds) => {
    syncVpnPopoverAnchorBounds(b);
  });
  ipcMain.handle(IPC.VPN_POPOVER_SHOW, (e) => {
    const w = winOf(e);
    if (w) showVpnPopover(w);
  });
  ipcMain.handle(IPC.VPN_POPOVER_CLOSE, () => {
    closeVpnPopover();
  });
  ipcMain.handle(IPC.VPN_POPOVER_SET_ACTIVE_URL, (_e, url: string) => {
    syncVpnPopoverActiveUrl(url);
  });
  ipcMain.handle(IPC.DOWNLOADS_POPOVER_SET_BOUNDS, (_e, b: ContentBounds) => {
    syncDownloadsPopoverAnchorBounds(b);
  });
  ipcMain.handle(IPC.DOWNLOADS_POPOVER_SHOW, (e) => {
    const w = winOf(e);
    if (w) showDownloadsPopover(w);
  });
  ipcMain.handle(IPC.DOWNLOADS_POPOVER_CLOSE, () => {
    closeDownloadsPopover();
  });
  // ── Поповер сведений о сайте (замочек в омнибоксе) ──
  ipcMain.handle(IPC.SITE_POPOVER_BOUNDS, (_e, b: ContentBounds) => {
    syncSitePopoverAnchorBounds(b);
  });
  // Один канал на открыть/закрыть: кнопка-замок работает переключателем, и держать для этого два
  // канала значит однажды разъехаться в том, кто из них считает состояние (тот же приём, что у
  // остальных поповеров тулбара).
  ipcMain.handle(IPC.SITE_POPOVER_TOGGLE, (e) => {
    const w = winOf(e);
    if (!w) return false;
    if (isSitePopoverOpen()) { closeSitePopover(); return false; }
    showSitePopover(w);
    return true;
  });
  // Адрес активной вкладки для самого поповера. ⚠️ Берём у менеджера вкладок окна-отправителя, а
  // не из аргумента: вью поповера живёт между показами и легко отстаёт от навигации.
  ipcMain.handle(IPC.SITE_POPOVER_ACTIVE_TAB, (e): { url: string; title: string } | null => {
    const active = tabsOf(e)?.snapshot().find((t) => t.isActive && !t.isHub);
    return active ? { url: active.url, title: active.title } : null;
  });
  // Живой список подсказок (заход 3/5) — buildSuggestions в Toolbar.tsx шлёт тот же массив,
  // что кладёт в setSuggestions() для старого дропдауна; main пересылает его во вью.
  ipcMain.handle(IPC.SUGGEST_DROPDOWN_SET_ITEMS, (e, items: SuggestDropdownItem[]) => {
    const w = winOf(e);
    if (w) sendSuggestItems(w, items);
  });
  // Клик по строке ВО вью дропдауна (другой webContents) — пересылаем в chrome, где Toolbar.tsx
  // вызывает свой существующий pickSuggestion(), не дублируя его поведение (activateTab/навигация).
  // Выбор возвращается в омнибокс ТОГО окна, где кликнули, — дропдаун теперь свой у каждого.
  onSuggestDropdownPick((w, item) => {
    contextForWindow(w)?.chromeView.webContents.send(IPC.SUGGEST_DROPDOWN_PICKED, item);
  });
  // Страж фокуса дропдауна (см. блок «ФОКУС» в шапке SuggestDropdownManager.ts). Electron не даёт
  // запретить вью забирать фокус (electron/electron#42922 открыт), поэтому единственная надёжная
  // защита — откатывать КАЖДЫЙ перехват, а не компенсировать отдельные известные моменты. Заменяет
  // прежние точечные заплатки (onFirstLoad + разовый focus() при открытии).
  onSuggestDropdownFocusStolen((w) => { contextForWindow(w)?.chromeView.webContents.focus(); });
  // Клавиатурная подсветка (заход 4/5) — омнибокс шлёт номер строки (-1 снимает), main просто
  // пересылает во вью; выбор (Enter) остаётся локальным в омнибоксе, эта вью в нём не участвует.
  ipcMain.handle(IPC.SUGGEST_DROPDOWN_HIGHLIGHT, (e, idx: number) => {
    const w = winOf(e);
    if (w) setSuggestDropdownHighlight(w, idx);
  });
  ipcMain.handle(IPC.WINDOW_SET_OVERLAY, (e, opts: TitleBarOpts) => winOf(e)?.setTitleBarOverlay(opts));
  // Роль окна — чром спрашивает её один раз при монтировании и по ней решает, что рисовать.
  // Отправитель вне реестра (такого быть не должно) трактуем как лёгкое окно: спрятать лишнее
  // безопаснее, чем показать кнопку, которая полезет в чужие вкладки.
  ipcMain.handle(IPC.WINDOW_GET_ROLE, (e): WindowRole => contextFromSender(e.sender)?.role ?? 'light');
  // Новое окно — всегда лёгкое: полное ровно одно, оно владеет сессией.
  ipcMain.handle(IPC.WINDOW_OPEN, () => { createWindow('light'); });
  // Перенос вкладки в новое окно. Порядок важен: сначала СНИМАЕМ вкладку со старого окна и только
  // потом создаём новое. Наоборот — и при отказе снять (спящая, split, закреплённая) на экране
  // оставалось бы пустое окно, которого никто не просил.
  // Перетаскивание вкладки: зоны поверх страницы + слежение за курсором (см. DropZoneManager.ts).
  ipcMain.handle(IPC.TAB_DRAG_START, (e) => { const w = winOf(e); if (w) startTabDrag(w); });
  ipcMain.handle(IPC.TAB_DRAG_END, (e) => { const w = winOf(e); return w ? endTabDrag(w) : { zone: null }; });
  ipcMain.handle(IPC.WINDOW_MOVE_TAB, (e, tabId: string) => {
    const from = tabsOf(e);
    return from ? moveTabToNewWindow(from, tabId) : false;
  });
  ipcMain.handle(IPC.WINDOW_MOVE_TAB_TO, (e, tabId: string, windowId: number) => {
    const from = tabsOf(e);
    return from ? moveTabToExistingWindow(from, tabId, windowId) : false;
  });
  ipcMain.handle(IPC.FIND_START, (e, q: string, fwd: boolean) => tabsOf(e)?.findInPage(q, fwd));
  ipcMain.handle(IPC.FIND_NEXT,  (e, fwd: boolean)            => tabsOf(e)?.findNext(fwd));
  ipcMain.handle(IPC.FIND_STOP,  (e)                            => tabsOf(e)?.stopFind());
  // Смысловой Ctrl+F: модель выбирает НОМЕР фрагмента страницы, цитату берём из своего массива и
  // подсвечиваем штатным findInPage (см. SmartFind.ts — там же, почему не «пусть модель процитирует»).
  // ⚠️ Гейта isModelWarm() здесь нет намеренно: человек переключил режим и нажал Enter — это явное
  // действие, и ждать загрузку модели оно вправе (в отличие от подсказок при наборе).
  ipcMain.handle(IPC.FIND_SMART, async (e, query: string): Promise<SmartFindResult> => {
    const tabs = tabsOf(e);
    const wc = tabs?.getActiveWebContents() ?? null;
    if (!tabs || !wc) return { ok: false, reason: 'no-text' };
    if (smartFindBusy) return { ok: false, reason: 'busy' };
    smartFindBusy = true;
    try {
      const pick = await pickFragmentByMeaning(wc, query);
      if (!pick.ok) {
        return { ok: false, reason: pick.reason === 'model-error' ? 'no-model' : pick.reason };
      }
      // ⚠️ Оставляем только те цитаты, которые реально удалось подсветить: показывать в счётчике
      // «1 / 3», где до двух из трёх не доехать, — обман. Подсветка первой заодно и прокручивает
      // к ней страницу, поэтому подбираем по порядку и первую же удачную оставляем показанной.
      const shown: string[] = [];
      let firstMatches = 0;
      for (const quote of pick.quotes) {
        const matches = await tabs.findQuoteInPage(highlightCandidates(quote));
        if (matches === 0) continue;
        shown.push(quote);
        if (shown.length === 1) firstMatches = matches;
      }
      if (shown.length === 0) return { ok: false, reason: 'not-found' };
      // Возвращаем подсветку на первую цитату: цикл выше оставил её на последней проверенной.
      if (shown.length > 1) await tabs.findQuoteInPage(highlightCandidates(shown[0]!));
      return { ok: true, quotes: shown, matches: firstMatches };
    } catch (err) {
      console.warn('[smart-find] ошибка:', err);
      return { ok: false, reason: 'no-model' };
    } finally {
      smartFindBusy = false;
    }
  });

  // ── Правила-автоматизации ──────────────────────────────────────────────────
  // ⚠️ Разбор фразы — ЕДИНСТВЕННЫЙ вызов модели во всей фиче, и он всегда явный: человек написал
  // фразу и нажал кнопку. Поэтому гейта isModelWarm() тут нет — ждать загрузку такое действие
  // вправе. Сохранения он не делает: черновик возвращается в UI на утверждение.
  let ruleParseBusy = false;
  ipcMain.handle(IPC.RULES_PARSE, async (_e, phrase: string): Promise<RuleParseOutcome> => {
    if (ruleParseBusy) return { ok: false, reason: 'model-error', error: 'Уже разбираю другую фразу' };
    ruleParseBusy = true;
    try {
      return await parsePhraseToRule(String(phrase ?? ''));
    } catch (err) {
      console.warn('[rules] разбор упал:', err);
      return { ok: false, reason: 'model-error' };
    } finally {
      ruleParseBusy = false;
    }
  });
  // Сохранение утверждённого черновика. Валидация повторяется ВНУТРИ хранилища: сюда приходит
  // объект из renderer, а он в общем случае — просто аргумент IPC, а не «наш» черновик.
  ipcMain.handle(IPC.RULES_ADD, (_e, draft: unknown) => {
    const saved = rules.add(draft);
    if (saved) broadcastToChrome(IPC.RULES_CHANGED, rules.list());
    return saved;
  });
  ipcMain.handle(IPC.RULES_LIST, () => rules.list());
  ipcMain.handle(IPC.RULES_SET_ENABLED, (_e, id: string, enabled: boolean) => {
    const ok = rules.setEnabled(id, enabled);
    if (ok) broadcastToChrome(IPC.RULES_CHANGED, rules.list());
    return ok;
  });
  ipcMain.handle(IPC.RULES_REMOVE, (_e, id: string) => {
    const ok = rules.remove(id);
    if (ok) broadcastToChrome(IPC.RULES_CHANGED, rules.list());
    return ok;
  });

  // Показать конкретную цитату из уже полученного ответа (стрелки в панели листают найденные
  // фрагменты). Состояния в main нет намеренно: список цитат держит панель, сюда приходит текст —
  // так листание не может разъехаться с тем, что человек видит в счётчике.
  ipcMain.handle(IPC.FIND_SMART_SHOW, async (e, quote: string): Promise<number> => {
    const tabs = tabsOf(e);
    if (!tabs || typeof quote !== 'string' || !quote.trim()) return 0;
    return tabs.findQuoteInPage(highlightCandidates(quote));
  });

  ipcMain.handle(IPC.TAB_PIN_TOGGLE, (e, id: string) => tabsOf(e)?.togglePin(id));
  ipcMain.handle(IPC.TAB_SET_MUTED, (e, id: string, muted: boolean) => tabsOf(e)?.setTabMuted(id, muted));

  // Split View
  ipcMain.handle(IPC.TAB_ENTER_SPLIT, (e, rightId: string)         => tabsOf(e)?.enterSplit(rightId));
  ipcMain.handle(IPC.TAB_EXIT_SPLIT,  (e, tabId: string)           => tabsOf(e)?.exitSplit(tabId));
  ipcMain.handle(IPC.TAB_SPLIT_FOCUS, (e, side: 'left' | 'right') => tabsOf(e)?.focusSplitPanel(side));
  ipcMain.handle(IPC.TAB_SPLIT_RATIO, (e, ratio: number)           => tabsOf(e)?.setSplitRatio(ratio));

  ipcMain.handle(IPC.TAB_REORDER,
    (e, section: 'normal' | 'pinned', orderedIds: string[]) =>
      tabsOf(e)?.reorderTabs(section, orderedIds),
  );

  ipcMain.handle(IPC.TAB_MOVE_SECTION,
    (e, tabId: string, targetSection: 'pinned' | 'normal', targetIndex: number) =>
      tabsOf(e)?.moveTabSection(tabId, targetSection, targetIndex),
  );

  // AdBlock
  ipcMain.handle(IPC.ADBLOCK_GET_STATE,      ()                    => adblock.getState());
  ipcMain.handle(IPC.ADBLOCK_SET_ENABLED,    (_e, v: boolean)      => adblock.setEnabled(v));
  ipcMain.handle(IPC.ADBLOCK_ADD_DOMAIN,     (_e, d: string)       => adblock.addDomain(d));
  ipcMain.handle(IPC.ADBLOCK_REMOVE_DOMAIN,  (_e, d: string)       => adblock.removeDomain(d));
  ipcMain.handle(IPC.ADBLOCK_RELOAD_TABS,    (e, d?: string)      => tabsOf(e)?.reloadTabsForDomain(d));
  ipcMain.handle(IPC.ADBLOCK_IS_WHITELISTED, (_e, d: string)       => adblock.isWhitelisted(d));
  ipcMain.handle(IPC.ADBLOCK_GET_SITE_BLOCK_COUNT, (_e, d: string) => adblock.getBlockedCountForDomain(d));

  // Бэнги омнибокса. Всё invoke: пользователь должен видеть результат (причину отказа при
  // сохранении, число импортированных), а не отправлять команду в пустоту.
  ipcMain.handle(IPC.BANGS_LIST, () => ({
    user: bangs.listUser(),
    builtin: bangs.listBuiltin(),
    importedCount: bangs.importedCount(),
  }));
  ipcMain.handle(IPC.BANGS_UPSERT, (_e, b: BangDefWire) => bangs.upsertUser(b));
  ipcMain.handle(IPC.BANGS_REMOVE, (_e, key: string) => { bangs.removeUser(key); });
  // Заготовки по адресам открытых вкладок. Работа целиком в main: у renderer нет URL чужих
  // вкладок, да и деривация — не его дело (см. CLAUDE.md — компоненты только рисуют).
  ipcMain.handle(IPC.BANGS_DERIVE_TABS, (e) => {
    const out: DerivedBangCandidate[] = [];
    const seen = new Set<string>();
    for (const t of tabsOf(e)?.snapshot() ?? []) {
      if (t.isHub || !t.url) continue;
      const d = deriveBangFromUrl(t.url);
      // Дедуп по шаблону: две вкладки одного поиска дали бы две одинаковые строки в списке.
      if (!d || seen.has(d.template)) continue;
      seen.add(d.template);
      out.push({ ...d, tabTitle: t.title || d.name, tabUrl: t.url });
    }
    return out;
  });
  ipcMain.handle(IPC.BANGS_IMPORT_DDG, () => bangs.importDuckDuckGoBangs());
  ipcMain.handle(IPC.BANGS_CLEAR_IMPORTED, () => { bangs.clearImported(); });

  // ── Полоса целей быстрого поиска (Ctrl+E) ──
  ipcMain.handle(IPC.SEARCH_CHIPS_GET, (): SearchChipsConfig => settings.getSearchChips());
  ipcMain.handle(IPC.SEARCH_CHIPS_SET, (_e, cfg: SearchChipsConfig) => { settings.setSearchChips(cfg); });
  // Выбор цели в настройках — только поиском и разрешением выбранных id: целиком список не
  // отдаётся, вместе с импортированным набором DDG их тысячи (см. SearchTargets.ts).
  ipcMain.handle(IPC.SEARCH_CHIPS_SEARCH, (_e, query: string): SearchChipCandidate[] =>
    searchChipCandidates(typeof query === 'string' ? query : '', { bangs, learned: searchTargets }));
  ipcMain.handle(IPC.SEARCH_CHIPS_RESOLVE, (_e, ids: string[]): SearchChipCandidate[] =>
    resolveChipCandidates(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [],
      { bangs, learned: searchTargets }));

  // Возврат OS-фокуса чрому по требованию renderer'а. Тот же приём, что уже применяется на
  // Ctrl+L и при открытии дропдауна подсказок, — просто доступный ещё и из омнибокса.
  ipcMain.on(IPC.CHROME_FOCUS, (e) => chromeOf(e)?.focus());

  // Автообновление. Команды — on, а не handle: ответ не нужен, результат приходит пушем
  // UPDATE_CHANGED (см. UpdateManager.initialize ниже).
  ipcMain.on(IPC.UPDATE_CHECK,    () => updates.check());
  ipcMain.on(IPC.UPDATE_DOWNLOAD, () => updates.download());
  ipcMain.on(IPC.UPDATE_INSTALL,  () => updates.install());
  ipcMain.handle(IPC.UPDATE_STATUS, () => updates.getStatus());

  // Настройки
  ipcMain.handle(IPC.SETTINGS_GET_SEARCH_ENGINE, () => settings.getSearchEngine());
  ipcMain.handle(IPC.SETTINGS_SET_SEARCH_ENGINE, (e, id: SearchEngineId) => {
    settings.setSearchEngine(id);
    tabsOf(e)?.setSearchEngine(id);
  });
  ipcMain.handle(IPC.SETTINGS_GET_HUB_MODE, () => {
    const mode = settings.getHubMode();
    // Hub.tsx зовёт этот геттер на каждом маунте (=каждое открытие хаба, компонент размонтируется
    // при уходе с хаба) — «открытие хаба в режиме AI» из брифа лазит именно сюда. Живая проверка
    // поймала реальную гонку: САМЫЙ ПЕРВЫЙ такой вызов процесса — не пользовательское намерение,
    // а пассивное восстановление сессии (activeRef может оказаться хабом, hubMode — 'ai' с
    // прошлого раза) — без этой отсечки прогрев запускался бы на каждом старте с хабом-в-AI-режиме
    // в сессии, тот самый сценарий, который modelLoadMode='on-demand' обязан избегать (проверка 1).
    // Второй и все последующие вызовы — уже реальная навигация пользователя в рамках этого запуска.
    if (mode === 'ai' && hubModeQueried) maybeLazyWarmupOnDemand();
    hubModeQueried = true;
    return mode;
  });
  ipcMain.handle(IPC.SETTINGS_SET_HUB_MODE, (_e, mode: HubMode) => {
    settings.setHubMode(mode);
    if (mode === 'ai') maybeLazyWarmupOnDemand();
  });
  ipcMain.handle(IPC.SETTINGS_GET_AI_PANEL_WIDTH, () => settings.getAiPanelWidth());
  ipcMain.handle(IPC.SETTINGS_GET_MODEL_LOAD_MODE, () => settings.getModelLoadMode());
  ipcMain.handle(IPC.SETTINGS_SET_MODEL_LOAD_MODE, (_e, mode: ModelLoadMode) => settings.setModelLoadMode(mode));

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
  ipcMain.on(IPC.HUB_CHAT_SEND, (e, payload: { tabId: string; text: string; grounding: boolean; sourcesContext?: string }) => {
    const { tabId, text, grounding, sourcesContext } = payload;
    // Адресат ответа фиксируется в момент запроса: стрим приходит асинхронно, и к его концу
    // фокус может быть уже в другом окне — искать окно заново было бы поздно и неверно.
    const target = chromeOf(e);
    const sendResult = (sessionId: number | null, outcome: ChatOutcome) => {
      sendTo(target, IPC.HUB_CHAT_RESULT, {
        tabId,
        sessionId,
        outcome: outcome.ok ? { ok: true, out: outcome.out } : { ok: false, error: outcome.error },
      });
    };
    const onChunk = (chunkText: string) => {
      sendTo(target, IPC.HUB_CHAT_CHUNK, { tabId, text: chunkText });
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
      // Грунтинг блокнота: подмешиваем текст выбранных источников в промпт (модель отвечает по ним),
      // но в истории/показе остаётся сырой вопрос пользователя. sources пуст → ссылки не дописываются.
      if (sourcesContext && sourcesContext.trim()) {
        const promptText =
          'Отвечай, опираясь на приведённые источники. Если ответа в них нет — так и скажи, не выдумывай.\n\n'
          + sourcesContext + '\n\nВопрос: ' + text;
        const { outcome, sessionId } = await hubChat.sendMessage(tabId, text, onChunk, { promptText, sources: [] });
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
    broadcastToChrome(IPC.AI_KEY_STATUS_CHANGED, connected);
  });

  // Задел под web-grounding (SearXNG) — тот же контракт/паттерн, что у ключа Gemini выше.
  // Пока только чром (секция настроек); AI-панель подключится отдельно, когда там появится
  // сам тоггл — свой preload, своя видимость, заводить сейчас незачем.
  ipcMain.handle(IPC.SEARXNG_GET_STATUS,    () => searxngKeyStore.getStatus());
  ipcMain.handle(IPC.SEARXNG_SAVE_CONFIG,   (_e, config: { endpoint: string; token: string }) => searxngKeyStore.saveConfig(config));
  ipcMain.handle(IPC.SEARXNG_DELETE_CONFIG, () => searxngKeyStore.deleteConfig());
  searxngKeyStore.onStatusChanged((configured) => {
    broadcastToChrome(IPC.SEARXNG_STATUS_CHANGED, configured);
  });

  // Реестр AI-скиллов (см. shared/ipc.ts::Skill, electron/SkillsStore.ts) — CRUD-мост для Settings
  // (чром). id для add генерим здесь, а не в сторе (SkillsStore.add() ожидает готовый id на входе,
  // сам не создаёт) — тем же приёмом, что TabManager.createSpecialTab использует randomUUID().
  ipcMain.handle(IPC.SKILLS_LIST,   () => skillsStore.list());
  ipcMain.handle(IPC.SKILLS_ADD,    (_e, input: { label: string; prompt: string; icon?: string }) =>
    skillsStore.add({ id: randomUUID(), ...input }));
  ipcMain.handle(IPC.SKILLS_UPDATE, (_e, id: string, patch: { label?: string; prompt?: string; icon?: string; visible?: boolean }) =>
    skillsStore.update(id, patch));
  ipcMain.handle(IPC.SKILLS_REMOVE, (_e, id: string) => skillsStore.remove(id));
  // Пуш в чром (Settings) — НЕЗАВИСИМАЯ вторая подписка на тот же skillsStore.onSkillsChanged,
  // что уже слушает AI-панель (AiPanelManager.ts:267, свой ad-hoc ai-panel:skills-list) — Set
  // слушателей в SkillsStore поддерживает несколько подписчиков, тот пуш не трогаем/не дублируем.
  skillsStore.onSkillsChanged((skills) => {
    broadcastToChrome(IPC.SKILLS_CHANGED, skills);
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
    broadcastToChrome(IPC.VPN_STATUS_CHANGED, vpnStatus());
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
  // Правило «включай VPN» (см. RuleEngine.ts). Возвращает true, только если ВКЛЮЧИЛИ прямо
  // сейчас — по этому признаку движок решает, перезагружать ли страницу.
  // ⚠️ Сервер человек в фразе не называл, поэтому берём тот, к которому уже подключались в этом
  // сеансе, а иначе первый из подписки. Молчаливый отказ при пустой подписке — правильный исход:
  // правило не должно открывать диалоги поверх страницы, на которую человек только что зашёл.
  ensureVpnOnForRules = async () => {
    // 'running' — рабочее состояние Xray; 'starting' тоже не повод запускать второй раз.
    const state = vpnProcess.getState();
    if (state === 'running' || state === 'starting') return false;
    const servers = vpnKeyStore.getServers();
    const server = servers.find((s) => s.id === vpnConnectionTarget?.id) ?? servers[0];
    if (!server) {
      console.warn('[rules] VPN не включить — подписки нет');
      return false;
    }
    vpnConnectionTarget = { id: server.id, remark: server.remark };
    const res = await vpnProcess.start(server);
    if (!res.ok) console.warn('[rules] VPN не включился:', res.error);
    return !!res.ok;
  };
  vpnProcess.onStateChange((_state, error) => {
    lastVpnError = error;
    applyVpnProxy();
    // Второй получатель того же снапшота, не замена рассылки по окнам — поповер сам решает
    // (broadcastVpnState), слать ли ему дальше, в зависимости от того, жив он/открыт ли сейчас.
    const connState = vpnConnectionState();
    broadcastToChrome(IPC.VPN_CONNECTION_STATE_CHANGED, connState);
    broadcastVpnState(connState);
  });
  applyVpnProxy(); // детерминированная база на старте — 'stopped' → direct, а не implicit-дефолт Electron

  // Менеджер паролей, шаг 1 (см. electron/PasswordManager.ts). Пароль пересекает IPC только
  // через reveal/generate — list его не отдаёт, copy сам кладёт в буфер и наружу не возвращает.
  ipcMain.handle(IPC.PASSWORDS_LIST,     () => passwords.list());
  // Показ/копирование пароля гейтится подтверждением Windows (osAuth), если включено в настройках.
  // Успешная проверка держится PASSWORD_AUTH_GRACE_MS, чтобы не спрашивать на каждый клик подряд.
  // 'unavailable' (механизм не сработал) трактуем как разрешение — не лочим доступ к своим паролям.
  ipcMain.handle(IPC.PASSWORDS_REVEAL,   async (_e, id: number) =>
    (await ensurePasswordAuth('Показать сохранённый пароль')) ? passwords.reveal(id) : null);
  ipcMain.handle(IPC.PASSWORDS_COPY,     async (_e, id: number, field: PasswordCopyField) => {
    // Логин копировать можно без подтверждения — под гейтом только сам пароль.
    if (field === 'password' && !(await ensurePasswordAuth('Скопировать сохранённый пароль'))) return false;
    return passwords.copyField(id, field);
  });
  ipcMain.handle(IPC.PASSWORDS_AUTH_GET, () => settings.getPasswordAuthEnabled());
  ipcMain.handle(IPC.PASSWORDS_AUTH_SET, (_e, enabled: boolean) => {
    settings.setPasswordAuthEnabled(enabled);
    return settings.getPasswordAuthEnabled();
  });
  ipcMain.handle(IPC.FAVICON_GET,        (_e, host: string) => faviconService.get(host));
  // Погода для виджета новой вкладки (тот же WeatherService, что у AI-панели; отдельный typed-канал
  // для главного рендерера — preload-aipanel до него не относится).
  ipcMain.handle(IPC.WEATHER_GET,        (_e, city: string) => getWeather(typeof city === 'string' ? city : ''));
  ipcMain.handle(IPC.NEWTAB_PHOTO_GET,   () => getPhotoOfDay());
  // Курсы для виджета новой вкладки. Отдельный канал от 'ai-panel:currency-rates' (там своя
  // труба к панели), но за ними ОДИН модуль с общим часовым кэшем — второго сетевого похода
  // открытая панель и открытая вкладка не устроят.
  ipcMain.handle(IPC.CURRENCY_GET,        () => getCurrencyRates());
  ipcMain.handle(IPC.HOLIDAY_GET,         (_e, country?: string) => getNextHoliday(country ?? 'RU'));
  ipcMain.handle(IPC.CRYPTO_GET,          () => getCryptoRates());
  ipcMain.handle(IPC.NOTEBOOK_EXTRACT_URL, (e, url: string) => {
    // Локальная переменная, а не два вызова подряд: при повторном вызове TypeScript теряет
    // проверку на null, и это уже не тот же самый объект по смыслу.
    const w = winOf(e);
    return w ? extractUrlText(w, typeof url === 'string' ? url : '') : { ok: false };
  });
  ipcMain.handle(IPC.NOTEBOOK_STUDIO_GEN, (_e, kind: StudioKind, context: string) =>
    generateStudio(kind, typeof context === 'string' ? context : ''));

  // Граф-воркспейс. Структуру пишет renderer (GRAPH_SAVE), результаты узлов — только движок
  // (см. шапку GraphStore.ts). GRAPH_RUN — send, а не handle: прогон длинный, ход идёт
  // отдельными событиями GRAPH_PROGRESS, ждать его одним ответом нечем.
  ipcMain.handle(IPC.GRAPH_LIST, () => graphs.list());
  ipcMain.handle(IPC.GRAPH_CREATE, (_e, title: string) =>
    graphs.create(typeof title === 'string' ? title : ''));
  ipcMain.handle(IPC.GRAPH_GET, (_e, graphId: number) => graphs.get(graphId));
  ipcMain.handle(IPC.GRAPH_SAVE, (_e, graphId: number, structure: GraphStructure) => {
    graphs.saveStructure(graphId, structure);
  });
  ipcMain.handle(IPC.GRAPH_RENAME, (_e, graphId: number, title: string) => {
    graphs.rename(graphId, typeof title === 'string' ? title : '');
  });
  ipcMain.handle(IPC.GRAPH_DELETE, (_e, graphId: number) => graphs.remove(graphId));
  ipcMain.handle(IPC.GRAPH_CANCEL, (_e, graphId: number) => cancelGraphRun(graphId));
  ipcMain.handle(IPC.GRAPH_PRESETS_LIST, () => graphs.listImagePresets());
  ipcMain.handle(IPC.GRAPH_PRESET_SAVE, (_e, preset: ImagePreset) => graphs.saveImagePreset(preset));
  ipcMain.handle(IPC.GRAPH_PRESET_DELETE, (_e, id: string) => graphs.deleteImagePreset(id));
  ipcMain.handle(IPC.GRAPH_SAVE_OUTPUT, async (e, suggestedName: string, text: string) => {
    const w = winOf(e);
    if (!w || typeof text !== 'string' || !text) return false;
    // Имя чистим от того, что Windows не пустит в путь: заголовок узла пишет человек,
    // и двоеточие в «Поиск: чайники» иначе сорвало бы сохранение.
    const safe = (suggestedName || 'результат').replace(/[\/:*?"<>|]/g, ' ').trim().slice(0, 80);
    const res = await dialog.showSaveDialog(w, {
      title: 'Сохранить результат',
      defaultPath: `${safe || 'результат'}.md`,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Текст', extensions: ['txt'] },
      ],
    });
    if (res.canceled || !res.filePath) return false;
    try {
      await fsp.writeFile(res.filePath, text, 'utf8');
      return true;
    } catch (e) {
      console.warn('[Graph] сохранение результата упало:', (e as Error).message);
      return false;
    }
  });
  ipcMain.handle(IPC.GRAPH_CHAT_LIST, (_e, graphId: number, nodeId: string) =>
    graphs.listChatMessages(graphId, nodeId));
  ipcMain.handle(IPC.GRAPH_CHAT_CLEAR, (_e, graphId: number, nodeId: string) => {
    graphs.clearChat(graphId, nodeId);
  });
  ipcMain.on(IPC.GRAPH_CHAT_SEND, (e, graphId: number, nodeId: string, text: string) => {
    // Диалог с моделью — явное намерение поработать с AI, значит её пора греть.
    maybeLazyWarmupOnDemand();
    const target = chromeOf(e); // холст того окна, где ведут диалог, — см. chromeOf выше
    void sendChatMessage(graphs, graphId, nodeId, typeof text === 'string' ? text : '', {
      chunk: (chunk) => sendTo(target, IPC.GRAPH_CHAT_CHUNK, { graphId, nodeId, text: chunk }),
      done: (outcome) => {
        sendTo(target, IPC.GRAPH_CHAT_DONE, { graphId, nodeId, ...outcome });
        // Ответ стал выходом узла — холст должен увидеть это как обычный результат.
        if (outcome.ok) {
          sendTo(target, IPC.GRAPH_PROGRESS, {
            graphId, nodeId, status: 'done', output: outcome.text,
          });
        }
      },
    });
  });
  ipcMain.handle(IPC.GRAPH_NODE_HISTORY, (_e, graphId: number, nodeId: string) =>
    graphs.listNodeHistory(graphId, nodeId));
  ipcMain.handle(IPC.GRAPH_PICK_FILE, async (e) => {
    const w = winOf(e);
    if (!w) return null;
    const res = await dialog.showOpenDialog(w, {
      title: 'Документ для узла графа',
      properties: ['openFile'],
      filters: [
        { name: 'Документы', extensions: SUPPORTED_FILE_EXTENSIONS },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
  });
  ipcMain.handle(IPC.GRAPH_PICK_IMAGE, async (e) => {
    const w = winOf(e);
    if (!w) return null;
    const res = await dialog.showOpenDialog(w, {
      title: 'Картинка для узла графа',
      properties: ['openFile'],
      filters: [
        { name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif'] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
  });
  // Превью картинки узла. Файл читает main: у renderer нет доступа к file://, а тащить в
  // карточку полноразмерный кадр с генератора незачем — data-URL раздулся бы на десятки МБ.
  ipcMain.handle(IPC.GRAPH_IMAGE_PREVIEW, async (_e, filePath: string) => {
    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile() || stat.size > 40 * 1024 * 1024) return null;
      const img = nativeImage.createFromPath(filePath);
      if (!img.isEmpty()) {
        const { width } = img.getSize();
        // 1280 хватает и карточке, и раскрытому виду — двух размеров не заводим.
        return (width > 1280 ? img.resize({ width: 1280 }) : img).toDataURL();
      }
      // nativeImage декодирует не всё (svg, часть webp/avif). Такие отдаём как есть —
      // <img> в renderer их понимает сам.
      const ext = path.extname(filePath).slice(1).toLowerCase();
      if (stat.size > 8 * 1024 * 1024) return null;
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext || 'png'}`;
      return `data:${mime};base64,${(await fsp.readFile(filePath)).toString('base64')}`;
    } catch {
      return null;   // файла нет или он не читается — карточка покажет это сама
    }
  });
  // Electron принимает только целые пиксели, а renderer меряет getBoundingClientRect()
  // и присылает дробные — та же нормализация, что в TabManager.setContentBounds.
  const toRect = (b: ContentBounds) => ({
    x: Math.round(b.x), y: Math.round(b.y),
    width: Math.max(0, Math.round(b.width)),
    height: Math.max(0, Math.round(b.height)),
  });

  // Узел-веб-приложение. Промпт собирает main из СОХРАНЁННОГО графа, а не renderer:
  // так «что вставили» и «по каким входам посчитан отпечаток» — один и тот же источник.
  ipcMain.handle(IPC.GRAPH_WEBAPP_SHOW, (e, graphId: number, nodeId: string, url: string, b: ContentBounds) => {
    const w = winOf(e);
    if (w) showGraphWebApp(w, graphId, nodeId, url, toRect(b));
  });
  ipcMain.handle(IPC.GRAPH_WEBAPP_BOUNDS, (e, graphId: number, nodeId: string, b: ContentBounds) => {
    const w = winOf(e);
    if (w) setGraphWebAppBounds(w, graphId, nodeId, toRect(b));
  });
  ipcMain.handle(IPC.GRAPH_WEBAPP_RAISE, (e, graphId: number, nodeId: string) => {
    const w = winOf(e);
    if (w) raiseGraphWebApp(w, graphId, nodeId);
  });
  ipcMain.handle(IPC.GRAPH_WEBAPP_CLOSE, (e, graphId: number, nodeId: string) => {
    const w = winOf(e);
    if (w) closeGraphWebApp(w, graphId, nodeId);
  });
  ipcMain.handle(IPC.GRAPH_WEBAPP_INSERT, (_e, graphId: number, nodeId: string) => {
    const doc = graphs.get(graphId);
    if (!doc) return false;
    return insertPrompt(graphId, nodeId, composeWebAppPrompt(doc, nodeId));
  });
  ipcMain.handle(IPC.GRAPH_WEBAPP_CAPTURE_IMAGE, (_e, graphId: number, nodeId: string) =>
    captureImage(graphId, nodeId));
  ipcMain.handle(IPC.GRAPH_WEBAPP_CAPTURE, async (e, graphId: number, nodeId: string, mode: 'selection' | 'last') => {
    const text = await captureAnswer(graphId, nodeId, mode === 'last' ? 'last' : 'selection');
    if (!text) return '';
    // Результат пишет main, а не renderer: инвариант «результаты узлов принадлежат движку»
    // (см. шапку GraphStore.ts) держится и здесь, просто источник ответа — человек.
    // Отпечаток берём тот же, что посчитал бы движок, — тогда ответ живёт ровно до правки
    // входов узла и не считается устаревшим на пустом месте.
    const doc = graphs.get(graphId);
    if (!doc) return '';
    graphs.setNodeResult(graphId, nodeId, {
      inputHash: computeNodeInputHash(doc, nodeId),
      output: text,
      outputTitle: null,
      error: null,
    });
    sendTo(chromeOf(e), IPC.GRAPH_PROGRESS, {
      graphId, nodeId, status: 'done', output: text,
    });
    return text;
  });

  ipcMain.on(IPC.GRAPH_RUN, (e, graphId: number, nodeId: string | null) => {
    const w = winOf(e);
    // Прогон графа — явное намерение поработать с AI, значит модель пора греть (тот же
    // приём, что у AI_PANEL_TOGGLE и SETTINGS_*_HUB_MODE).
    maybeLazyWarmupOnDemand();
    const target = chromeOf(e);
    void runGraph(w, graphs, graphId, typeof nodeId === 'string' ? nodeId : null, (p) => {
      sendTo(target, IPC.GRAPH_PROGRESS, p);
    });
  });

  // Автозаполнение — адреса и карты (electron/AutofillManager.ts). Полный номер карты (reveal) —
  // под тем же OS-подтверждением, что показ пароля (ensurePasswordAuth); list/add/update номер
  // наружу не отдают.
  const pushAutofillChanged = () => broadcastToChrome(IPC.AUTOFILL_CHANGED);
  ipcMain.handle(IPC.AUTOFILL_ADDRESS_LIST,   () => autofill.listAddresses());
  ipcMain.handle(IPC.AUTOFILL_ADDRESS_ADD,    (_e, input: AddressInput) => { const ok = autofill.addAddress(input); if (ok) pushAutofillChanged(); return ok; });
  ipcMain.handle(IPC.AUTOFILL_ADDRESS_UPDATE, (_e, input: AddressUpdate) => { const ok = autofill.updateAddress(input); if (ok) pushAutofillChanged(); return ok; });
  ipcMain.handle(IPC.AUTOFILL_ADDRESS_DELETE, (_e, id: number) => { const ok = autofill.deleteAddress(id); if (ok) pushAutofillChanged(); return ok; });
  ipcMain.handle(IPC.AUTOFILL_CARD_LIST,      () => autofill.listCards());
  ipcMain.handle(IPC.AUTOFILL_CARD_ADD,       (_e, input: CardInput) => { const ok = autofill.addCard(input); if (ok) pushAutofillChanged(); return ok; });
  ipcMain.handle(IPC.AUTOFILL_CARD_UPDATE,    (_e, input: CardUpdate) => { const ok = autofill.updateCard(input); if (ok) pushAutofillChanged(); return ok; });
  ipcMain.handle(IPC.AUTOFILL_CARD_DELETE,    (_e, id: number) => { const ok = autofill.deleteCard(id); if (ok) pushAutofillChanged(); return ok; });
  ipcMain.handle(IPC.AUTOFILL_CARD_REVEAL,    async (_e, id: number) =>
    (await ensurePasswordAuth('Показать номер карты')) ? autofill.revealCardNumber(id) : null);
  ipcMain.handle(IPC.PASSWORDS_GENERATE, (_e, opts: PasswordGenerateOptions) => passwords.generate(opts));
  ipcMain.handle(IPC.PASSWORDS_ADD, (_e, input: PasswordAddInput) => {
    const ok = passwords.add(input);
    if (ok) broadcastToChrome(IPC.PASSWORDS_CHANGED);
    return ok;
  });
  ipcMain.handle(IPC.PASSWORDS_UPDATE, (_e, input: PasswordUpdateInput) => {
    const ok = passwords.update(input);
    if (ok) broadcastToChrome(IPC.PASSWORDS_CHANGED);
    return ok;
  });
  ipcMain.handle(IPC.PASSWORDS_DELETE, (_e, id: number) => {
    passwords.delete(id);
    broadcastToChrome(IPC.PASSWORDS_CHANGED);
  });
  // Экспорт/импорт — диалог выбора файла целиком в main, на диск попадает только уже
  // зашифрованная под passphrase строка (см. PasswordManager.exportVault/importVault),
  // никогда не расшифрованный JSON.
  ipcMain.handle(IPC.PASSWORDS_EXPORT, async (e, passphrase: string) => {
    const w = winOf(e);
    const payload = passwords.exportVault(passphrase);
    if (payload === null || !w) return false;
    const { canceled, filePath } = await dialog.showSaveDialog(w, {
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
  ipcMain.handle(IPC.PASSWORDS_IMPORT, async (e, passphrase: string) => {
    const w = winOf(e);
    if (!w) return 0;
    const { canceled, filePaths } = await dialog.showOpenDialog(w, {
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
    if (count > 0) broadcastToChrome(IPC.PASSWORDS_CHANGED);
    return count;
  });

  // Менеджер паролей, шаг 2 — действия из поповера индикатора (всегда про активную вкладку,
  // см. PasswordAutofillManager.ts::handleSave/handleUpdate/handleDismiss).
  // ⚠️ «Активная вкладка» здесь — активная в окне ОТПРАВИТЕЛЯ: пароль обязан уйти на ту страницу,
  // где человек его и вводит, а не на активную вкладку соседнего окна.
  ipcMain.handle(IPC.PASSWORDS_INDICATOR_SAVE,    (e) => { const w = winOf(e); return w ? passwordAutofill.handleSave(w) : false; });
  ipcMain.handle(IPC.PASSWORDS_INDICATOR_UPDATE,  (e) => { const w = winOf(e); return w ? passwordAutofill.handleUpdate(w) : false; });
  ipcMain.handle(IPC.PASSWORDS_INDICATOR_FILL,    (e, id: number) => { const w = winOf(e); return w ? passwordAutofill.handleFill(w, id) : false; });
  ipcMain.handle(IPC.PASSWORDS_INDICATOR_DISMISS, (e) => { const w = winOf(e); if (w) passwordAutofill.handleDismiss(w); });
  ipcMain.handle(IPC.PASSWORDS_INDICATOR_GENERATE, (e) => { const w = winOf(e); return w ? passwordAutofill.handleGenerateAndFill(w) : false; });

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
    broadcastToChrome(IPC.HISTORY_CONTENT_BACKFILL_PROGRESS, p);
  });
  ipcMain.on(IPC.HISTORY_CONTENT_BACKFILL_START, (e) => {
    const w = winOf(e); if (w) void startContentBackfill(history, w); });
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
  // Умный поиск — Qwen-реранк, только по явному Enter (см. HistorySearch.ts::searchHistorySmart).
  ipcMain.handle(IPC.HISTORY_SEARCH_SMART, (_e, query: string) => searchHistorySmart(history, query));

  // Закладки — пуш BOOKMARK_CHANGED во все окна после каждой успешной мутации, тот же
  // приём, что уже используется для PASSWORDS_CHANGED (инлайн, не через конструктор-колбэк).
  ipcMain.handle(IPC.BOOKMARK_ADD, (_e, url: string, title: string) => {
    const entry = bookmarks.add(url, title);
    if (entry) broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return entry;
  });
  ipcMain.handle(IPC.BOOKMARK_REMOVE, (_e, id: number) => {
    bookmarks.remove(id);
    broadcastToChrome(IPC.BOOKMARK_CHANGED);
  });
  ipcMain.handle(IPC.BOOKMARK_REMOVE_BY_URL, (_e, url: string) => {
    bookmarks.removeByUrl(url);
    broadcastToChrome(IPC.BOOKMARK_CHANGED);
  });
  ipcMain.handle(IPC.BOOKMARK_LIST, () => bookmarks.list());
  ipcMain.handle(IPC.BOOKMARK_LIST_TREE, () => bookmarks.listTree());
  ipcMain.handle(IPC.BOOKMARK_SHOW_MENU, (e) => {
    const ctx = contextFromSender(e.sender);
    if (ctx) void showBookmarkMenu(ctx.win, ctx.tabs);
  });
  // Правки дерева. broadcastToChrome, а не ответ вызывающему: закладки — общее состояние
  // приложения, файл на диске один, а копия дерева своя у КАЖДОГО окна (см. WindowRegistry).
  ipcMain.handle(IPC.BOOKMARK_CREATE_FOLDER, (_e, title: string, parentId: number | null) => {
    const entry = bookmarks.createFolder(title, parentId);
    if (entry) broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return entry;
  });
  ipcMain.handle(IPC.BOOKMARK_RENAME, (_e, id: number, title: string) => {
    const ok = bookmarks.rename(id, title);
    if (ok) broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return ok;
  });
  ipcMain.handle(IPC.BOOKMARK_MOVE, (_e, id: number, parentId: number | null) => {
    const ok = bookmarks.move(id, parentId);
    if (ok) broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return ok;
  });
  // Умная раскладка. ⚠️ SUGGEST ничего не меняет — только считает; APPLY выполняет уже
  // одобренное человеком. Разделение не формальность: между вызовами стоит его согласие, и
  // склеить их в один канал значило бы разложить чужие закладки без спроса.
  ipcMain.handle(IPC.BOOKMARK_ORGANIZE_SUGGEST, () => suggestBookmarkFolders(bookmarks.listTree()));
  ipcMain.handle(IPC.BOOKMARK_ORGANIZE_APPLY, (_e, proposals: BookmarkFolderProposal[]) => {
    let moved = 0;
    for (const p of proposals) {
      const folder = bookmarks.createFolder(p.label, null);
      if (!folder) continue;
      for (const id of p.ids) if (bookmarks.move(id, folder.id)) moved++;
    }
    if (moved > 0) broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return moved;
  });
  ipcMain.handle(IPC.BOOKMARK_REORDER, (_e, parentId: number | null, orderedIds: number[]) => {
    const ok = bookmarks.reorder(parentId, orderedIds);
    if (ok) broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return ok;
  });
  ipcMain.handle(IPC.BOOKMARK_IS_BOOKMARKED, (_e, url: string) => bookmarks.isBookmarked(url));
  // Импорт — isAvailable() зовётся заново на каждый список (профиль браузера-источника мог
  // появиться/пропасть между вызовами, не кэшируем факт наличия).
  ipcMain.handle(IPC.BOOKMARK_IMPORT_LIST_SOURCES, () =>
    bookmarkImporters.filter((imp) => imp.isAvailable()).map((imp) => ({ id: imp.id, label: imp.label })));
  ipcMain.handle(IPC.BOOKMARK_IMPORT_RUN, async (_e, sourceId: string) => {
    const importer = bookmarkImporters.find((imp) => imp.id === sourceId);
    if (!importer) return null;
    const result = await importer.import();
    broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return result;
  });

  // Общий мультитиповый импорт (закладки/история/пароли) — диалог импорта + онбординг.
  ipcMain.handle(IPC.IMPORT_LIST_SOURCES, () => importManager.listSources());
  ipcMain.handle(IPC.IMPORT_RUN, async (_e, sourceId: string, dataTypes: ImportDataType[]) => {
    const result = await importManager.run(sourceId, Array.isArray(dataTypes) ? dataTypes : []);
    // Любой перенос мог задеть закладки/историю/сейф — толкаем их слушателей перечитать.
    if (result.bookmarks) broadcastToChrome(IPC.BOOKMARK_CHANGED);
    return result;
  });
  // ⚠️ Наличие браузеров для импорта здесь БОЛЬШЕ НЕ ПРОВЕРЯЕТСЯ: раньше экран первого запуска
  // был только предложением импорта, и без источников показывать было нечего. Теперь это ещё и
  // рассказ о браузере — он нужен и тому, у кого переносить нечего (шаг переноса в этом случае
  // сам скажет, что источников не нашлось).
  ipcMain.handle(IPC.CURRENCY_HISTORY, (_e, code: string, days?: number) => getCurrencyHistory(code, days));
  ipcMain.handle(IPC.CRYPTO_HISTORY, (_e, ticker: string, days?: number) => getCryptoHistory(ticker, days));

  ipcMain.handle(IPC.AI_PANEL_OPEN_APP, (e, appId: string) => {
    const w = winOf(e);
    if (w) openAiPanelApp(w, appId);
  });

  ipcMain.handle(IPC.DOWNLOADS_GET_ASK_LOCATION, () => settings.getAskDownloadLocation());
  ipcMain.handle(IPC.DOWNLOADS_SET_ASK_LOCATION, (_e, value: boolean) => {
    settings.setAskDownloadLocation(value);
    downloads.setAskLocation(value);
  });

  ipcMain.handle(IPC.DEFAULT_BROWSER_IS, () => isDefaultBrowser());
  ipcMain.handle(IPC.DEFAULT_BROWSER_REQUEST, () => requestDefaultBrowser());

  ipcMain.handle(IPC.ONBOARDING_SHOULD_SHOW, () => !settings.getImportOffered());
  ipcMain.handle(IPC.ONBOARDING_MARK_SHOWN, () => { settings.setImportOffered(); });

  // Разрешения сайтов. Ответ приходит из вью поповера (preload-permissionpopover.ts); после
  // него снимаем вопрос с очереди — там может ждать следующий (сайт умеет попросить камеру и
  // геолокацию подряд).
  ipcMain.handle(IPC.PERMISSION_RESPONSE,
    (_e, requestId: string, granted: boolean, remember: boolean) => {
      permissions.respond(requestId, granted, remember);
      permissionAnswered(requestId);
    },
  );
  ipcMain.on('permission-popover:height', (e, px: number) => setPermissionPopoverHeight(e.sender, px));
  // Раздел настроек «Разрешения сайтов». ⚠️ Отозвать (забыть) и запретить — РАЗНЫЕ операции:
  // забытый сайт спросит снова, запрещённый не спросит никогда. Склеить их в одну кнопку значило
  // бы лишить человека способа исправить своё же ошибочное «нет».
  ipcMain.handle(IPC.PERMISSION_LIST, () => permissions.list());
  ipcMain.handle(IPC.PERMISSION_SET, (_e, origin: string, key: PermKey, decision: 'granted' | 'denied') => {
    permissions.set(origin, key, decision);
  });
  ipcMain.handle(IPC.PERMISSION_REVOKE, (_e, origin: string, key?: PermKey) => {
    permissions.revoke(origin, key);
  });

  // Загрузки
  ipcMain.handle(IPC.DOWNLOADS_GET_ALL,    ()               => downloads.getAll());
  ipcMain.handle(IPC.DOWNLOAD_PAUSE,       (_e, id: string) => downloads.pause(id));
  ipcMain.handle(IPC.DOWNLOAD_RESUME,      (_e, id: string) => downloads.resume(id));
  ipcMain.handle(IPC.DOWNLOAD_CANCEL,      (_e, id: string) => downloads.cancel(id));
  ipcMain.handle(IPC.DOWNLOAD_CLEAR,       (_e, id: string) => downloads.clear(id));
  ipcMain.handle(IPC.DOWNLOAD_OPEN_FILE,   (_e, id: string) => downloads.openFile(id));
  ipcMain.handle(IPC.DOWNLOAD_SHOW_FOLDER, (_e, id: string) => downloads.showFolder(id));
  ipcMain.handle(IPC.DOWNLOAD_RETRY,       (_e, id: string) => downloads.retry(id));

  // Поиск по настройкам фразой (AI-IDEAS.md №6) — второй эшелон, зовётся только на промахе
  // ключевых слов. ⚠️ Гвард «один запрос за раз» тот же, что у поиска вкладок: человек печатает
  // быстрее, чем модель отвечает, а очередь генерации общая и прерывать начатую нельзя.
  ipcMain.handle(IPC.SETTINGS_SEARCH_SMART, async (_e, query: string): Promise<number[]> => {
    if (settingsSearchBusy) return [];
    settingsSearchBusy = true;
    try {
      return await searchSettingsByMeaning(query);
    } catch (err) {
      console.warn('[settings-search] ошибка:', err);
      return [];
    } finally {
      settingsSearchBusy = false;
    }
  });

  // Разбор адреса строкой по кнопке в настройках (AI-IDEAS.md №1, вторая половина). Тот же
  // разбор, что у вставки на странице, но по явной просьбе — поэтому ждать модель он вправе.
  ipcMain.handle(IPC.AUTOFILL_PARSE_ADDRESS, async (_e, text: string): Promise<ParsedAddressPart[]> => {
    const parts = await parseAddressBlob(text, { explicit: true });
    return parts.map((p) => ({ key: p.key, label: p.label, value: p.value }));
  });

  // Имя по содержимому (AI-IDEAS.md №3). ⚠️ Ровно два шага, и между ними стоит человек:
  // «предложить» только читает файл и считает, «переименовать» трогает диск.
  ipcMain.handle(IPC.DOWNLOAD_SUGGEST_NAME, async (_e, id: string): Promise<DownloadNameSuggestion> => {
    const savePath = downloads.pathForRead(id);
    if (!savePath) return { ok: false, error: 'Файла на месте нет' };
    const res = await suggestFileName(savePath);
    return res.ok ? { ok: true, name: res.name } : { ok: false, error: res.error };
  });
  ipcMain.handle(IPC.DOWNLOAD_RENAME, async (_e, id: string, name: string): Promise<DownloadRenameResult> => {
    const savePath = downloads.pathForRead(id);
    if (!savePath) return { ok: false, error: 'Файла на месте нет' };
    const res = await renameDownloadedFile(savePath, name);
    if (!res.ok) return { ok: false, error: res.error };
    downloads.applyRename(id, res.filename, res.savePath);
    return { ok: true, filename: res.filename };
  });

  // AI-группировка вкладок (Phase 4)
  ipcMain.handle(IPC.TABS_ORGANIZE_APPLY,    (e, clusters: OrganizeCluster[]) => tabsOf(e)?.applyOrganize(clusters));
  ipcMain.handle(IPC.TABS_ORGANIZE_ROLLBACK, (e)                                => tabsOf(e)?.rollbackOrganize());
  ipcMain.handle(IPC.TABS_SUGGEST_GROUPS,    ()                                => suggestGroups());
  ipcMain.handle(IPC.TABS_RENAME_ROLLBACK,   (e)                               => tabsOf(e)?.rollbackRenames());
  // Массовое переименование — вторая половина «навести порядок».
  //
  // ⚠️ Строго ПОСЛЕДОВАТЕЛЬНО и без параллелизма: у node-llama-cpp один контекст на приложение,
  // и TranslationService всё равно сериализует входы своей очередью (тот же довод, что у
  // GraphEngine). Каждое готовое имя ставится сразу — список приводится в порядок на глазах,
  // а не рывком в конце; при двадцати вкладках это разница между «работает» и «завис».
  ipcMain.handle(IPC.TABS_RENAME_ALL, async (e) => {
    const t = tabsOf(e);
    const ctx = contextFromSender(e.sender);
    if (!t) return;
    const ids = t.renamableTabIds();
    if (ids.length === 0) return;
    t.beginRenameBatch(ids);

    const progress = (done: number) => {
      const wc = ctx?.chromeView.webContents;
      if (wc && !wc.isDestroyed()) wc.send(IPC.TABS_RENAME_PROGRESS, { done, total: ids.length });
    };
    progress(0);

    for (const [i, id] of ids.entries()) {
      const src = t.renameSourceFor(id);
      // Вкладку могли закрыть, пока очередь дошла до неё, — это норма, а не сбой.
      if (src) {
        const res = await suggestTabTitle(src.wc, src.title, src.url);
        if (res.ok) t.setAiTitle(id, res.title);
      }
      progress(i + 1);
    }
  });

  // Доверие корню Минцифры, выданное человеком поверх вшитого списка банков (CertTrustStore.ts).
  // ⚠️ Выдаётся оно НЕ отсюда: вопрос задаётся в момент проверки сертификата (CertificateTrust.ts),
  // потому что разрешение задним числом Chromium уже не примет — вердикт закэширован. Наружу
  // отдаём только показ и отзыв.
  ipcMain.handle(IPC.CERT_TRUST_LIST, () => listUserTrusted());
  ipcMain.handle(IPC.CERT_TRUST_REMOVE, (_e, domain: unknown) => {
    if (typeof domain !== 'string') return false;
    const ok = removeUserTrusted(domain);
    if (ok) refreshCertificateTrust(); // отзыв обязан действовать сразу, а не после перезапуска
    return ok;
  });

  // Правая AI-панель (см. AiPanelManager.ts)
  ipcMain.handle(IPC.AI_PANEL_TOGGLE, (e) => {
    const w = winOf(e);
    if (!w) return false;
    const open = toggleAiPanel(w);
    relayoutSearchPopover(); // та же свободная ширина, что у FindBar
    relayoutFindBar(w); // свободная ширина под FindBar изменилась (см. FindBarManager.ts::computeBounds)
    relayoutScreenshot(w); // и под карточку снимка — она сидит у правого края, как раз под панелью
    // ⚠️ Прогрева модели здесь БОЛЬШЕ НЕТ. Открытая панель — ещё не разговор с моделью: в ней
    // живут приложения, конвертер, виджеты и веб-слоты. Замерено пингом main из хрома: загрузка
    // Qwen блокирует main-процесс ~900 мс всплесками (433 + 167 + 129 + 119 + 71), и при открытии
    // панели сразу после запуска они ложатся вплотную к стартовому блоку в 284 мс — это и есть
    // та «секунда», на которой спотыкался переход «чат → приложения». Прогрев переехал на
    // намерение поговорить (фокус в поле ввода, см. AiPanelManager.ts::ai-panel:chat-intent).
    return open;
  });

  // Полностраничный перевод (см. PageTranslateManager.ts) — fire-and-forget, актуальное
  // состояние приходит push'ем через onPageTranslateStateChanged (см. выше).
  ipcMain.on(IPC.PAGE_TRANSLATE_TOGGLE, () => { void togglePageTranslate(); });
  ipcMain.handle(IPC.PAGE_TRANSLATE_GET_STATE, () => getPageTranslateActiveState());

  // Нативное ПКМ-меню вкладки в сайдбаре.
  ipcMain.handle(IPC.TAB_SHOW_MENU, (e, id: string) => {
    const w = winOf(e);
    // ⚠️ Меню ЧИТАЕТСЯ и КЛИКАЕТСЯ из одного менеджера — того, чьё окно прислало вызов. Раньше
    // содержимое собиралось по глобальному tabs, а клики шли в tabsOf(e): при одном окне это одно
    // и то же, при двух — меню описывало бы чужую вкладку. Локальная переменная ещё и сужает тип,
    // избавляя от `!` на каждом клике.
    const t = tabsOf(e);
    if (!t || !w) return;
    const isPinned = t.isTabPinned(id);
    const groupId  = t.getTabGroupId(id);
    const state = t.snapshot().find((tab) => tab.id === id);
    const toGraph = state
      ? buildAddToGraphMenuItem(graphs, [{ url: state.url, title: state.title || state.url }], undefined, notifyGraphChanged)
      : null;

    const items: MenuItemConstructorOptions[] = [
      {
        label: isPinned ? 'Открепить вкладку' : 'Закрепить вкладку',
        click: () => t.togglePin(id),
      },
      // Перенос страницы в своё окно. Живая уезжает вью (с историей и введённым в форму),
      // спящая — своим описанием. Неактивен только для участника split: тот увёл бы за собой
      // половину пары (см. TabManager.detachTabForMove).
      {
        label: 'Открыть в новом окне',
        enabled: state !== undefined && state.splitSide === null,
        click: () => { void moveTabToNewWindow(t, id); },
      },
      // Обратный жест. Пункт появляется, только когда есть куда переносить: в единственном окне
      // он был бы вечно серым и лишь занимал место. Пока окон два (обычный случай) — это прямая
      // команда без подменю, потому что выбирать не из чего.
      ...buildMoveToWindowItems(w, t, id, state !== undefined && state.splitSide === null),
      // Умное имя. Живой странице есть что читать; у спящей и псевдо-вкладок содержимого нет.
      {
        label: t.getAiTitle(id) ? 'Придумать название заново' : 'Придумать название по смыслу',
        enabled: t.getWebContentsForTab(id) !== null,
        click: () => { void renameTabSmart(t, id); },
      },
      ...(t.getAiTitle(id) ? [{
        label: 'Вернуть заголовок страницы',
        click: () => t.setAiTitle(id, null),
      }] : []),
      ...(toGraph ? [toGraph] : []),
      { type: 'separator' },
    ];

    if (!isPinned) {
      if (groupId) {
        items.push({
          label: 'Убрать из группы',
          click: () => t.removeTabFromGroup(groupId, id),
        });
      } else {
        items.push({
          label: 'Создать группу',
          click: () => createGroupSuggesting(t, chromeOf(e), id),
        });
      }

      // Подменю «Добавить в группу» — только если есть группы.
      const allGroups = collectGroups(t.sidebarNodesSnapshot());
      const otherGroups = allGroups.filter((g) => g.id !== groupId);
      if (otherGroups.length > 0) {
        items.push({
          label: 'Добавить в группу',
          submenu: otherGroups.map((g) => ({
            label: g.label || 'Группа',
            click: () => addToGroupSuggesting(t, chromeOf(e), g.id, id),
          })),
        });
      }

      items.push({ type: 'separator' });
    }

    items.push({
      label: 'Закрыть вкладку',
      enabled: !isPinned,
      click: () => t.closeTab(id),
    });
    Menu.buildFromTemplate(items).popup({ window: w });
  });

  // ПКМ по кнопке «Новая вкладка» — обычная / инкогнито / восстановить закрытую (как в Chrome).
  ipcMain.handle(IPC.NEW_TAB_SHOW_MENU, (e) => {
    const w = winOf(e);
    const t = tabsOf(e);
    if (!t || !w) return;
    Menu.buildFromTemplate([
      { label: 'Новая вкладка', accelerator: 'Ctrl+T', click: () => t.activate(HUB_ID) },
      { label: 'Новая вкладка инкогнито', accelerator: 'Ctrl+Shift+N', click: () => t.createTab(undefined, false, false, true) },
      { type: 'separator' },
      // Список закрытых — у каждого окна свой: вернуть в этом окне вкладку, закрытую в соседнем,
      // человек не просил.
      { label: 'Открыть закрытую вкладку', accelerator: 'Ctrl+Shift+T', enabled: t.hasClosedTabs(), click: () => t.reopenLastClosedTab() },
    ]).popup({ window: w });
  });

  // Нативное ПКМ-меню заголовка группы.
  ipcMain.handle(IPC.GROUP_SHOW_MENU, (e, groupId: string) => {
    const w = winOf(e);
    const t = tabsOf(e);
    if (!t || !w) return;
    const GROUP_COLORS: Array<{ label: string; value: string }> = [
      { label: 'Без цвета',   value: '' },
      { label: 'Красный',     value: 'red' },
      { label: 'Оранжевый',   value: 'orange' },
      { label: 'Жёлтый',      value: 'yellow' },
      { label: 'Зелёный',     value: 'green' },
      { label: 'Синий',       value: 'blue' },
      { label: 'Фиолетовый',  value: 'purple' },
    ];
    const groupTitle = t.getGroupTitle(groupId) || 'Папка';
    const groupToGraph = buildAddToGraphMenuItem(
      graphs, t.getGroupContents(groupId), groupTitle, notifyGraphChanged,
    );
    const items: MenuItemConstructorOptions[] = [
      {
        label: 'Переименовать',
        click: () => sendTo(chromeOf(e), IPC.GROUP_RENAME_PROMPT, groupId),
      },
      {
        label: 'Цвет',
        submenu: GROUP_COLORS.map(({ label, value }) => ({
          label,
          click: () => t.setGroupColor(groupId, value || null),
        })),
      },
      ...(groupToGraph ? [groupToGraph] : []),
      { type: 'separator' },
      {
        label: 'Свернуть / развернуть',
        click: () => t.toggleGroupCollapse(groupId),
      },
      {
        label: 'Скопировать содержимое',
        click: () => {
          const contents = t.getGroupContents(groupId);
          if (contents.length === 0) return;
          // Оба формата одним clipboard.write() — атомарно, оба представления сразу доступны любому
          // приёмнику: html для редакторов с форматированием, text — Markdown-подобный список для
          // обычных текстовых полей. Экранируем title — заголовок страницы задаёт сам сайт,
          // не доверенный ввод для сборки HTML-строки руками.
          // <p> вместо <br><br> — двойной <br> в HTML даёт неряшливый сдвоенный отступ, абзацы
          // разделяются самим редактором единообразно с тем, как он разделяет свои собственные.
          const html = contents
            .map(({ url, title }) => `<p><a href="${escapeHtmlAttr(url)}">${escapeHtml(title)}</a></p>`)
            .join('');
          // '\n\n' (не '\n') — пустая строка между ссылками при вставке в обычное текстовое поле;
          // join не оставляет заключающего разделителя, поэтому хвостовой пустой строки в конце нет.
          const text = contents.map(({ url, title }) => `[${title}](${url})`).join('\n\n');
          clipboard.write({ text, html });
        },
      },
      { type: 'separator' },
      {
        label: 'Расформировать группу',
        click: () => t.disbandGroup(groupId),
      },
      {
        label: 'Закрыть группу и вкладки',
        click: () => t.closeGroupAndTabs(groupId),
      },
    ];
    Menu.buildFromTemplate(items).popup({ window: w });
  });

  // Имя-заготовка для группы, СОБРАННОЙ РУКАМИ (AI-IDEAS.md №5). Группы строятся двумя шагами
  // нативного меню: «Создать группу» (одна вкладка) → «Добавить в группу» (вторая, третья…).
  // Осмысленное имя возможно только когда вкладок ДВЕ и БОЛЬШЕ, поэтому зовём это после каждого
  // изменения состава, а не при создании.
  // ⚠️ Гейты, каждый несущий:
  //  • label всё ещё дефолтный «Новая группа» — не перебиваем ни имя человека, ни имя от «Навести
  //    порядок»/правил (те создают группы уже с меткой), и не дёргаем модель на каждый 3-й/4-й add;
  //  • вкладок ≥2 — одну называть нечего;
  //  • модель тёплая — холодную 9B ради подписи не будим (~30 с), тогда остаётся ручной ввод;
  //  • не «в полёте» уже — быстрые два add подряд не должны запускать две генерации.
  // Асинхронно и не блокирует: группа уже на экране, имя приезжает через ~секунду и открывает
  // inline-правку с выделенным текстом — принять Enter'ом или переписать (цена ошибки — Backspace).
  const namingInFlight = new Set<string>();
  const maybeSuggestGroupName = (t: TabManager, chrome: Electron.WebContents | null, groupId: string): void => {
    if (!isModelWarm() || namingInFlight.has(groupId)) return;
    if (t.groupLabel(groupId) !== 'Новая группа') return;
    const tabs = t.groupTabInfos(groupId);
    if (tabs.length < 2) return;
    namingInFlight.add(groupId);
    void suggestGroupName(tabs).then((name) => {
      namingInFlight.delete(groupId);
      // За время генерации человек мог сам назвать группу или её расформировать — тогда не трогаем.
      if (!name || t.groupLabel(groupId) !== 'Новая группа') return;
      t.renameGroup(groupId, name);
      sendTo(chrome, IPC.GROUP_RENAME_PROMPT, groupId); // inline-правка в том же окне
    }).catch(() => { namingInFlight.delete(groupId); });
  };
  const createGroupSuggesting = (t: TabManager, chrome: Electron.WebContents | null, tabId: string): void => {
    const groupId = t.createGroup(tabId);
    if (groupId) maybeSuggestGroupName(t, chrome, groupId); // при 1 вкладке пропустится по гейту
  };
  const addToGroupSuggesting = (t: TabManager, chrome: Electron.WebContents | null, groupId: string, tabId: string): void => {
    t.addTabToGroup(groupId, tabId);
    maybeSuggestGroupName(t, chrome, groupId);
  };

  // Группо-операции.
  ipcMain.handle(IPC.SIDEBAR_NODES_GET,      (e)                                => tabsOf(e)?.sidebarNodesSnapshot() ?? []);
  ipcMain.handle(IPC.GROUP_CREATE,           (e, tabId: string)               => { const t = tabsOf(e); if (t) createGroupSuggesting(t, chromeOf(e), tabId); });
  ipcMain.handle(IPC.GROUP_ADD_TAB,          (e, gId: string, tabId: string)  => { const t = tabsOf(e); if (t) addToGroupSuggesting(t, chromeOf(e), gId, tabId); });
  ipcMain.handle(IPC.GROUP_REMOVE_TAB,       (e, gId: string, tabId: string)  => tabsOf(e)?.removeTabFromGroup(gId, tabId));
  ipcMain.handle(IPC.GROUP_RENAME,           (e, gId: string, label: string)  => tabsOf(e)?.renameGroup(gId, label));
  ipcMain.handle(IPC.GROUP_COLOR,            (e, gId: string, color: string | null) => tabsOf(e)?.setGroupColor(gId, color));
  ipcMain.handle(IPC.GROUP_TOGGLE_COLLAPSE,  (e, gId: string)                 => tabsOf(e)?.toggleGroupCollapse(gId));
  ipcMain.handle(IPC.GROUP_DISBAND,          (e, gId: string)                 => tabsOf(e)?.disbandGroup(gId));
  ipcMain.handle(IPC.GROUP_REORDER_CHILDREN, (e, gId: string, ids: string[])  => tabsOf(e)?.reorderGroupChildren(gId, ids));

  // Детект железа (см. electron/HardwareInfo.ts) — задел под подбор модели. Ленивый: ничего не
  // считает на старте, первый запрос из renderer инициирует расчёт.
  ipcMain.handle(IPC.HARDWARE_GET_SNAPSHOT, () => HardwareInfo.get());
  ipcMain.handle(IPC.HARDWARE_REFRESH_SNAPSHOT, () => HardwareInfo.refresh());

  // Загрузчик GGUF-моделей (см. electron/ModelDownloader.ts) — задел, потребителей в UI нет.
  // Тот же приём, что HISTORY_CONTENT_BACKFILL_PROGRESS (main.ts:1006-1010): модуль зовёт колбэк,
  // main решает, куда слать, сам модуль про окна не знает. Загрузка одна на приложение — её
  // прогресс идёт во все окна, иначе полоса замерла бы у того, кто открыл настройки вторым.
  ModelDownloader.setProgressListener((p) => {
    broadcastToChrome(IPC.MODEL_DOWNLOAD_PROGRESS, p);
  });
  ipcMain.on(IPC.MODEL_DOWNLOAD_START, (_e, spec: ModelDownloadSpec) => { void ModelDownloader.startDownload(spec); });
  ipcMain.on(IPC.MODEL_DOWNLOAD_CANCEL, () => ModelDownloader.cancelDownload());
  ipcMain.handle(IPC.MODEL_DOWNLOAD_STATUS, () => ModelDownloader.getProgress());

  // Курируемый каталог моделей (см. electron/ModelCatalog.ts) — задел, потребителей в UI нет.
  ipcMain.handle(IPC.MODEL_CATALOG_GET, () => ModelCatalog.getCatalogWithFit());

  // Явная выгрузка модели из VRAM (см. TranslationService.ts::unloadModel) — задел, потребителей
  // в UI нет.
  ipcMain.handle(IPC.MODEL_UNLOAD, () => unloadModel());

  // Удаление модели с диска (см. ModelRegistry.ts::deleteModel) — задел, потребителей в UI нет.
  // Необратимо.
  ipcMain.handle(IPC.MODEL_DELETE, (_e, id: string) => ModelRegistry.deleteModel(id));

  // Список установленных моделей (см. ModelRegistry.ts::list) — задел, потребителей в UI нет.
  ipcMain.handle(IPC.MODEL_INSTALLED_LIST, () => ModelRegistry.list());

  // Дефолтная модель (см. ModelRegistry.ts::getDefault/setDefault) — задел, потребителей в UI нет.
  // ModelRegistry.setDefault() сама молча игнорирует неизвестный id (void, без сигнала об ошибке) —
  // валидация NOT_FOUND сделана здесь, на границе IPC, а не внутри ModelRegistry.ts (её логику эта
  // задача не трогает). Установка несуществующего дефолта иначе сломала бы ensureLoaded() при следующем
  // старте. Смена дефолта НЕ выгружает уже загруженную модель — та остаётся в VRAM до unloadModel().
  ipcMain.handle(IPC.MODEL_DEFAULT_GET, () => ModelRegistry.getDefault()?.id ?? null);
  ipcMain.handle(IPC.MODEL_DEFAULT_SET, (_e, id: string) => {
    if (!ModelRegistry.getById(id)) return { ok: false, reason: 'NOT_FOUND' };
    ModelRegistry.setDefault(id);
    return { ok: true };
  });

  // Модель, сейчас загруженная в VRAM (см. TranslationService.ts::getLoadedModelId) — задел,
  // потребителей в UI нет.
  ipcMain.handle(IPC.MODEL_LOADED_GET, () => getLoadedModelId());
}

// Собирает GroupNode[] плоским списком из верхнего уровня дерева.
function collectGroups(nodes: SidebarNode[]): GroupNode[] {
  const groups: GroupNode[] = [];
  for (const node of nodes) {
    if (node.type === 'group') groups.push(node as GroupNode);
  }
  return groups;
}

// Имя сайта для вопроса «кто хочет открыть приложение». Пустая строка, если адрес не разбирается
// (about:blank и подобное) — вопрос тогда задаётся без имени, но задаётся.
function originOfUrl(url: string): string {
  try { return new URL(url).host; } catch { return ''; }
}

// Ссылки в чужие приложения (mailto:, tel:, sbolpay:, tg: …) — отдаём ОС, спросив человека.
// ⚠️ Раньше здесь знали ровно две схемы, mailto и tel. Всё остальное — включая переход в
// банковское приложение при оплате по СБП — не приводило НИ К ЧЕМУ: Chromium схему не знает,
// страница остаётся на месте, и со стороны это выглядит как «кнопка оплаты не работает».
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e, url) => {
    if (!isExternalAppUrl(url)) return;
    e.preventDefault();
    const win = BrowserWindow.fromWebContents(contents) ?? contextFromSender(contents)?.win ?? mainWin;
    void openExternalWithConsent(win, url, originOfUrl(contents.getURL()));
  });
  // Любая наша chrome-страница (главный рендерер + все поповеры), догрузившись, получает текущую
  // тему — так лениво создаваемые поповеры сразу открываются в нужном (в т.ч. инкогнито) виде.
  contents.on('did-finish-load', () => applyChromeThemeTo(contents));
});

// ── Одна копия на профиль ──────────────────────────────────────────────────────
//
// ⚠️ Обязательно именно для роли браузера по умолчанию: система запускает нас заново на КАЖДУЮ
// открытую ссылку. Без замка это был бы второй процесс на том же userData — два владельца
// session.json и открытых SQLite-баз разом, то есть прямая дорога к потере вкладок и битым
// файлам. Со замком второй запуск умирает сразу, передав адрес уже работающему окну.
//
// Исключение — изолированные тестовые стенды (OBLAKO_*_TEST): они намеренно живут отдельно и
// боевого профиля не касаются.
const singleInstance = LLAMA_TEST || TRANSLATE_TEST || app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {

// Ссылка из другого приложения при УЖЕ запущенном браузере: открываем вкладку и поднимаем окно.
app.on('second-instance', (_e, argv) => {
  const url = firstUrlFromArgv(argv);
  const ctx = mainContext() ?? allContexts()[0];
  if (!ctx) return;
  if (ctx.win.isMinimized()) ctx.win.restore();
  ctx.win.focus();
  if (url) ctx.tabs.createTab(url);
});

// macOS отдаёт ссылки не аргументом, а событием. Пути расходятся только здесь.
app.on('open-url', (e, url) => {
  e.preventDefault();
  const ctx = mainContext() ?? allContexts()[0];
  if (ctx) ctx.tabs.createTab(url);
  else pendingStartUrl = url;
});

app.whenReady().then(async () => {
  startT0 = Date.now();
  // Заставка — САМОЕ первое, что делаем: она закрывает паузу между кликом по ярлыку и
  // появлением окна, а эта пауза и ощущается зависанием. Всё тяжёлое идёт после.
  if (!LLAMA_TEST && !TRANSLATE_TEST && !PRICE_PROBE) showSplash();
  Menu.setApplicationMenu(null); // прячем дефолтное меню — у нас свой хром
  registerModelProtocol();
  registerChromeProtocol();

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
  if (PRICE_PROBE) {
    // ⚠️ Боевой чром не поднимаем: стенд только читает страницы. История, сессия и индекс не
    // трогаются — писать их некому, вкладок через TabManager он не создаёт.
    const { runPriceProbe } = await import('./PriceProbe');
    // Адреса приходят JSON-массивом: в них есть и запятые, и амперсанды, и любой самодельный
    // разделитель пришлось бы экранировать.
    let urls: string[] = [];
    try { urls = JSON.parse(process.env.OBLAKO_PRICE_PROBE_URLS ?? '[]') as string[]; } catch { urls = []; }
    await runPriceProbe(urls).catch((e: unknown) => console.error('[price-probe] FATAL', e));
    app.quit();
    return;
  }

  registerIpc();

  // safeStorage требует app.isReady() — грузим сохранённый (зашифрованный) ключ Gemini здесь,
  // не на верхнем уровне модуля (см. AiKeyStore.ts, заход D шаг 3).
  aiKeyStore.loadFromDisk();
  tracking.initialize();
  initTrackingChecker(tracking);
  // ⚠️ Тост Windows — нативный (Notification), свой центр уведомлений не нужен: система даёт и
  // очередь, и «не беспокоить», и историю. Клик по тосту открывает страницу товара — иначе он
  // сообщает новость, с которой ничего нельзя сделать.
  setTrackingEventHandler(({ title, url, text }) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: title.slice(0, 80), body: text });
    n.on('click', () => {
      const ctx = mainContext() ?? allContexts()[0];
      if (!ctx || ctx.win.isDestroyed()) return;
      if (ctx.win.isMinimized()) ctx.win.restore();
      ctx.win.focus();
      ctx.tabs.createTab(url);
    });
    n.show();
  });
  searxngKeyStore.loadFromDisk();
  vpnKeyStore.loadFromDisk();
  skillsStore.loadFromDisk();

  // История: нативный модуль может отсутствовать — падение не блокирует запуск.
  await history.initialize().catch((e) =>
    console.error('[History] инициализация упала:', e),
  );
  // Закладки — тот же паттерн деградации, отдельный файл (см. BookmarkManager.ts).
  await bookmarks.initialize().catch((e) =>
    console.error('[Bookmarks] инициализация упала:', e),
  );
  // Графы — та же деградация: нет better-sqlite3, значит вкладка графов пустая, браузер цел.
  await graphs.initialize().catch((e) =>
    console.error('[Graph] инициализация упала:', e),
  );
  // Движок должен видеть пользовательские пресеты картинок, но не знать про хранилище.
  setImagePresetsSource(() => graphs.listImagePresets());

  // Сейф паролей: та же гарантия — падение (нет better-sqlite3, safeStorage недоступен) не
  // блокирует старт, браузер работает без него (см. PasswordManager.ts::initialize).
  await passwords.initialize().catch((e) =>
    console.error('[Passwords] инициализация упала:', e),
  );

  // Автозаполнение (адреса/карты): та же гарантия — падение не блокирует старт (см.
  // AutofillManager.ts::initialize).
  await autofill.initialize().catch((e) =>
    console.error('[Autofill] инициализация упала:', e),
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
  //
  // Ждать инициализацию или нет — решаем по наличию кэша движка, и это принципиально разные
  // случаи, а не микрооптимизация:
  //   • кэш есть (любой запуск после первого) — ЖДЁМ. Это десериализация локального файла,
  //     десятки миллисекунд, зато к моменту пробуждения восстановленной активной вкладки
  //     (tabs.activate → wakeTab, см. восстановление сессии ниже) фильтр уже стоит. Защита в
  //     повседневном сценарии не меняется ни на йоту.
  //   • кэша нет (самый первый запуск) — НЕ ждём. Иначе окно не появляется, пока движок не
  //     скачается с CDN: замерено 2774 мс против 974 мс, а в пределе — FETCH_TIMEOUT_MS = 15 с.
  //     Документация Electron (tutorial/performance) прямо запрещает держать main-поток на
  //     сетевой операции. Плата за это ровно одна и разовая: на ПЕРВОМ запуске восстановленная
  //     активная вкладка может успеть загрузиться до того, как фильтр встанет.
  const adblockReady = adblock
    .initialize((state) => { broadcastToChrome(IPC.ADBLOCK_STATE_CHANGED, state); })
    .catch((e) => { console.error('[AdBlock] инициализация упала, браузер работает без блокировки:', e); });
  if (adblock.hasCachedEngine()) {
    await adblockReady;
  } else {
    console.log('[AdBlock] кэша движка нет — качаем в фоне, окно не ждёт');
  }

  // Автообновление. Ставится ПОСЛЕ adblock и БЕЗ await: initialize() только подписывается на
  // события и заводит отложенный таймер, сеть трогается через 20 с после старта — запуск окна
  // это не задерживает ни на миллисекунду. В dev-режиме метод не делает вообще ничего.
  updates.initialize((s) => broadcastToChrome(IPC.UPDATE_CHANGED, s));

  createWindow();

  // Холодный старт по ссылке (кликнули по ссылке в почте, браузер ещё не запущен): адрес
  // приезжает аргументом командной строки. Открываем ПОСЛЕ восстановления сессии — иначе
  // вкладка-гостья появилась бы раньше, чем вернулись свои, и осталась бы в конце списка.
  const startUrl = pendingStartUrl ?? firstUrlFromArgv(process.argv);
  pendingStartUrl = null;
  if (startUrl) mainTabs?.createTab(startUrl);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

} // конец ветки single-instance

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Синхронная запись перед выходом — никаких await, иначе процесс умрёт раньше.
// На Windows/Linux это уже избыточно (win.on('close') в createWindow успевает раньше и обнуляет
// tabs/sess), но на macOS Cmd+Q шлёт before-quit ДО закрытия окна — здесь ещё всё живо, это тот
// путь, где сработает эта подстраховка. Оставлено ради будущего macOS-порта (см. CLAUDE.md).
app.on('before-quit', () => {
  isShuttingDown = true; // macOS Cmd+Q путь — здесь ещё раньше, чем win.on('close') выше
  if (mainTabs && mainSess) mainSess.saveNow(mainTabs.getSessionSnapshot(), mainTabs);
  // Процесс инференса — дочерний, и Windows не убивает такие сама (та же причина, по которой
  // явно останавливается xray.exe): без этого он остался бы висеть с моделью в видеопамяти.
  shutdownInference();
});
