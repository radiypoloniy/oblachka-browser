import { app, BrowserWindow, WebContentsView, ipcMain, Menu, webContents, nativeTheme, Notification } from 'electron';
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
//
// ⚠️ …но ТОЛЬКО в упакованном приложении, и это оплачено живой поломкой. AUMID для Windows — не
// метка, а ИДЕНТИЧНОСТЬ программы: по нему группируются кнопки на панели задач и по нему же
// система ищет ярлык, чтобы понять, что закреплять и каким значком рисовать. Для показа тоста
// Electron требует ярлык в «Пуске» с этим AUMID и в незапакованном запуске ЗАВОДИТ ЕГО САМ —
// указывающим на node_modules\electron\dist\electron.exe. В результате на AUMID боевого браузера
// претендовали два ярлыка, установленный и наш отладочный, Windows выбирал второй, и человек
// видел у запущенного браузера значок Electron, а закреплённая кнопка запускала голый Electron
// вместо браузера. Ярлык на рабочем столе при этом работал: он ведёт на exe напрямую, мимо AUMID.
//
// Отсюда: из отладочного запуска боевую идентичность не занимаем. Свой AUMID у него остаётся —
// уведомления в разработке продолжают работать, просто под отдельным именем.
app.setAppUserModelId(app.isPackaged ? 'com.oblako.browser' : 'com.oblako.browser.dev');
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
import { TabManager } from './TabManager';
import { closeWindowView } from './viewTeardown';
import { SessionManager } from './SessionManager';
import { AdBlockManager } from './AdBlockManager';
import { UpdateManager } from './UpdateManager';
import { BangStore } from './BangStore';
import { HistoryManager } from './HistoryManager';
import { BookmarkManager } from './BookmarkManager';
import { GraphStore } from './GraphStore';
import { setImagePresetsSource } from './GraphEngine';
import { buildAddToGraphMenuItem } from './GraphInbox';
import { setTabManager as setGraphWebAppTabManager } from './GraphWebAppManager';
import { createChromiumImporters } from './bookmarkImport/ChromiumBookmarkImporter';
import { ImportManager } from './browserImport/ImportManager';
import { faviconService } from './FaviconService';
import { setTabManager as setNotebookExtractTabManager } from './NotebookExtract';
import { verifyUser } from './osAuth';
import { PasswordManager } from './PasswordManager';
import { AutofillManager } from './AutofillManager';
import { DownloadManager } from './DownloadManager';
import { PermissionManager } from './PermissionManager';
import { SettingsManager } from './SettingsManager';
import * as ModelRegistry from './ModelRegistry';
import * as ModelDownloader from './ModelDownloader';
import { HubChatManager } from './HubChatManager';
import { IPC, isDarkTheme } from '../shared/ipc';
import type { ThemePaletteId, ThemePrefs } from '../shared/ipc';
import type { FindResult, SidebarNode, GroupNode, BergamotStatus, QuickHit, SearchTarget } from '../shared/ipc';
import type { SavedNode } from './SessionManager';
import { showTranslatePopover, closeTranslatePopoverOnTabSwitch, closeTranslatePopoverForClosedTab } from './TranslatePopoverManager';
import { warmup as warmupTranslation } from './TranslationService';
import { shutdownInference } from './inference/InferenceHost';
import { isExternalAppUrl, openExternalWithConsent, setExternalConsentAsk } from './ExternalProtocol';
import { localPathToFileUrl } from './localFileUrl';
import { installCertificateTrust } from './CertificateTrust';
import { prewarmPanel, onTabsSynced, setTabManager, setSettingsManager as setAiPanelSettingsManager, setChromeView as setAiPanelChromeView, setOnChatIntent as setOnAiPanelChatIntent, setOnPanelFocus as setOnAiPanelFocus } from './AiPanelManager';
import { onTabsSynced as onPageTranslateTabsSynced, setTabManager as setPageTranslateTabManager, onStateChanged as onPageTranslateStateChanged, onProgressChanged as onPageTranslateProgressChanged } from './PageTranslateManager';
import { setActiveEngineId, registerEngine, setCacheManager } from './TranslationEngineRegistry';
import { BergamotTranslationEngine } from './BergamotTranslationEngine';
import { TranslationCacheManager } from './TranslationCacheManager';
import { showFindBar, closeFindBar, sendFindResult, setTabManager as setFindBarTabManager } from './FindBarManager';
import { captureTabScreenshot, saveCurrentScreenshot, closeScreenshot, setScreenshotTabManager } from './ScreenshotManager';
import { mapFormFields, type FormFieldDescriptor } from './AutofillFieldMapper';
import { profileSession, incognitoSession as incognitoBrowsingSession, allBrowsingSessions } from './ProfileSession';
import { RuleStore } from './RuleStore';
import { applyRules } from './RuleEngine';
import { prewarmDropZones } from './DropZoneManager';
import { suggestTabTitle } from './TabRenamer';
import { showPermissionRequest, dropPermissionRequests } from './PermissionPopoverManager';
import { showSearchPopover, closeSearchPopover, setOnSearchRun, setOnQuickQuery, setOnQuickOpen, setTabManager as setSearchPopoverTabManager } from './SearchPopoverManager';
import { buildSearchTargets } from './SearchTargets';
import { readPageSelection } from './PageSelection';
import { SearchTargetStore } from './SearchTargetStore';
import { applyBangTemplate, isValidBangTemplate, parseBangCandidate, bangHomeUrl } from '../shared/bangs';
import { CHROME_OVERLAY_PX } from '../shared/chromeGround';
import { hideSuggestDropdown } from './SuggestDropdownManager';
import { initPasswordPopover, showPasswordPopover, closePasswordPopover, syncPasswordPopoverAnchorBounds } from './PasswordPopoverManager';
import { initAutofillPopover, showAutofillPopover, closeAutofillPopover, syncAutofillPopoverAnchorBounds } from './AutofillPopoverManager';
import * as autofillOrchestrator from './AutofillOrchestrator';
import { parseAddressBlob } from './AddressParser';
import { initDownloadsPopover, closeDownloadsPopover, broadcastDownloads, setDuplicatePrompt, setDuplicateDecisionHandler } from './DownloadsPopoverManager';
import { initSitePopover, closeSitePopover } from './SitePopoverManager';
import * as aiKeyStore from './AiKeyStore';
import * as searxngKeyStore from './SearxngKeyStore';
import * as vpnKeyStore from './VpnKeyStore';
import * as skillsStore from './SkillsStore';
import * as vpnProcess from './VpnProcess';
import * as passwordAutofill from './PasswordAutofillManager';
import { initMediaSession, handleMediaReport, forgetMediaTab } from './MediaSessionManager';
import { indexVisit } from './HistoryIndexer';
import type { PermissionRequest } from '../shared/ipc';
import { setTabManager as setOrganizerTabManager, setHistoryManager as setOrganizerHistoryManager } from './TabOrganizer';
import { suggestFolderForBookmark } from './BookmarkFolderPick';
import { detectProduct } from './ProductDetector';
import { TrackingStore } from './TrackingStore';
import { initTrackingChecker, setTrackingEventHandler } from './TrackingChecker';
import { findMatchFor } from './ProductMatcher';
import * as clipboardBuffer from './ClipboardBuffer';
import { initClipboardPopover, toggleClipboardPopover, closeClipboardPopover } from './ClipboardPopoverManager';
import type { ProductState } from '../shared/ipc';
import type { BookmarkNode } from '../shared/ipc';
import { registerTabsIpc } from './ipc/tabs';
import { registerTrackingIpc } from './ipc/tracking';
import { registerOverlaysIpc } from './ipc/overlays';
import { registerWindowsIpc } from './ipc/windows';
import { registerSearchIpc } from './ipc/search';
import { registerAiHubIpc } from './ipc/aiHub';
import { registerVpnIpc } from './ipc/vpn';
import { registerWidgetsIpc } from './ipc/widgets';
import { registerGraphIpc } from './ipc/graph';
import { registerPasswordsIpc } from './ipc/passwords';
import { registerHistoryIpc } from './ipc/history';
import { registerSystemIpc } from './ipc/system';
import { registerMenusIpc } from './ipc/menus';

// Последняя сеть под main-процессом. Заведена под охоту на "Object has been destroyed"
// (closeTab → exitSplit на закрытии окна со split) и своё отработала — стек указал точную
// строку; оставлена насовсем, потому что молча умерший main выглядит для человека как
// «браузер просто исчез», и разбираться потом не по чему. Точечные [shutdown]-логи убраны,
// а Error.stackTraceLimit вернулся к штатному: бесконечный стек нужен был только на охоте
// и стоит времени на КАЖДОМ создании Error, включая рядовые перехваченные.
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

// Прогрев оверлея перетаскивания (DropZoneManager.ts::prewarmDropZones) — та же природа, что у
// панели: спавн WebContentsView + её бандл, никакой модели. Свой тик, ещё позже панели: жест
// перетаскивания вкладки в первые две секунды после запуска человек физически не начинает, а
// бить три прогрева в одну точку старта незачем. Без него первый за сессию жест платил холодную
// цену целиком — ту самую заметную задержку перед появлением карточки в руке.
const DROPZONES_PREWARM_DELAY_MS = 2200;

// Изолированные стенды AI-инфраструктурных тестов (node-llama-cpp).
// OBLAKO_LLAMA_TEST=1 / OBLAKO_TRANSLATE_TEST=1 npm start → вместо боевого окна открывается
// только тестовое, боевой чром (TabManager/SessionManager/adblock/history) не инициализируется.
const LLAMA_TEST = process.env.OBLAKO_LLAMA_TEST === '1';
const TRANSLATE_TEST = process.env.OBLAKO_TRANSLATE_TEST === '1';
// Замер «читается ли цена товара» перед фичей отслеживания (см. PriceProbe.ts). Адреса приходят
// JSON-массивом в OBLAKO_PRICE_PROBE_URLS. Боевое окно не поднимается.
const PRICE_PROBE = process.env.OBLAKO_PRICE_PROBE === '1';
// Показ примеров уведомлений об отслеживании (npm run notify-preview). ⚠️ Браузер при этом
// запускается ОБЫЧНЫЙ: как выглядит тост, видно только в настоящем окружении приложения —
// с его AppUserModelID, иконкой и системными настройками уведомлений.
const NOTIFY_PREVIEW = process.env.OBLAKO_NOTIFY_PREVIEW === '1';

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

// Electron 42: политика WebRTC живёт на WebContents, не на Session. Иначе STUN обходит SOCKS.
// 'default' только при прямом выходе — звонки без VPN не ломаем.
let currentWebrtcPolicy: 'default' | 'disable_non_proxied_udp' = 'default';

function applyWebrtcPolicy(wc: WebContents): void {
  if (wc.isDestroyed()) return;
  wc.setWebRTCIPHandlingPolicy(currentWebrtcPolicy);
}

app.on('web-contents-created', (_e, wc) => applyWebrtcPolicy(wc));

// Тема chrome-страниц. Главный рендерер (App.tsx) сам ставит data-theme/data-incognito на свой
// documentElement, но КАЖДЫЙ поповер/дропдаун (AI-панель, перевод, findbar, пароли, VPN,
// автозаполнение, дропдаун подсказок) — отдельная WebContentsView со своим document, который
// этих атрибутов не видит. Держим актуальную тему в main и раскидываем во ВСЕ наши chrome-вью
// (oblako-chrome://…) через executeJavaScript — без правок в каждом preload/entry. Реальные
// сайты (гостевые вкладки) не трогаем (isChromePageUrl отсекает по URL).
let currentChromeTheme: {
  dark: boolean;
  incognito: boolean;
  palette: ThemePaletteId;
  wash: { accent: string; tint: string } | null;
} = { dark: false, incognito: false, palette: 'charcoal', wash: null };
function isChromePageUrl(u: string): boolean {
  return u.startsWith('oblako-chrome://') || u.includes('localhost:5173'); // прод + dev-сервер Vite
}
function isWashHex(v: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(v);
}
function chromeThemeJs(t: typeof currentChromeTheme): string {
  const wash = t.wash && isWashHex(t.wash.accent) && isWashHex(t.wash.tint)
    ? `r.style.setProperty('--accent','${t.wash.accent.toLowerCase()}');`
      + `r.style.setProperty('--sidebar-tint','${t.wash.tint.toLowerCase()}');`
    : `r.style.removeProperty('--accent');r.style.removeProperty('--sidebar-tint');`;
  return `(function(){try{var r=document.documentElement;`
    + `r.setAttribute('data-theme','${t.dark ? 'dark' : 'light'}');`
    // Палитра — вторая ось темы (см. palettes.css): без неё поповеры остались бы на базовой земле,
    // а окно перекрасилось бы, и стык был бы виден на каждом дропдауне.
    + `r.setAttribute('data-palette','${t.palette}');`
    + (t.incognito ? `r.setAttribute('data-incognito','true');` : `r.removeAttribute('data-incognito');`)
    // wash — акцент от сетки окна. Без него кнопки и поповеры остаются цвета палитры, а земля —
    // цвета градиента, и это снова «часть синим, часть зелёным».
    + wash
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
/**
 * Тост об изменении цены. Вынесен функцией, потому что его зовёт и показ примеров
 * (OBLAKO_NOTIFY_PREVIEW): примерка обязана идти тем же путём, что настоящее уведомление, иначе
 * она показывала бы не то, что человек получит.
 *
 * ⚠️ Клик открывает страницу товара: уведомление, сообщающее новость, с которой ничего нельзя
 * сделать, — это просто помеха.
 */
function showTrackingToast(title: string, url: string, text: string): void {
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
}

// Пункты меню отслеживания цены. ⚠️ Вынесены из showProductMenu отдельной функцией, потому что
// у них теперь ДВА места показа: своя кнопка-индикатор и подменю «⋯» в адресной строке. Собирать
// один и тот же список дважды — гарантированный способ однажды поправить только одну копию.
// null = на этой странице цены нет, значит и пунктов быть не должно.
function productMenuTemplate(win: BrowserWindow): MenuItemConstructorOptions[] | null {
  const ctx = contextForWindow(win);
  const active = ctx?.tabs.snapshot().find((t) => t.isActive && !t.isHub);
  const state = productStateFor(win);
  if (!active || !state) return null;
  const found = productByTab.get(active.id);
  if (!found) return null;

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
  return template;
}

function showProductMenu(win: BrowserWindow): void {
  const template = productMenuTemplate(win);
  if (template) Menu.buildFromTemplate(template).popup({ window: win });
}

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
  profileSession().setSpellCheckerLanguages(['ru', 'en-US']);

  // Клиентские подсказки Sec-CH-UA (см. BrowserIdentity.ts): Electron их не шлёт вовсе,
  // а без них наша строка UA «Chrome/144» противоречит поведению настоящего Chrome и вход
  // в аккаунт Google отвечает «This browser or app may not be secure».
  applyClientHints(profileSession());

  // Доверие корню Минцифры — своё, внутри браузера, и только для банков из списка (см.
  // CertificateTrust.ts: там же разбор, почему список, а не «доверять везде»). Ставится и на
  // приватную сессию: в инкогнито Сбер должен открываться так же, как в обычной вкладке.
  installCertificateTrust(profileSession());
  installCertificateTrust(incognitoBrowsingSession());

  // Тема, известная main'у ДО того, как хром успеет её прислать. Без этого поповер, созданный
  // раньше первого CHROME_THEME_SET, открывался бы светлым в тёмной теме — видимая вспышка.
  const startPrefs = currentThemePrefs();
  currentChromeTheme = { dark: isDarkTheme(startPrefs), incognito: false, palette: startPrefs.palette, wash: null };

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
  downloads.attach(profileSession(), (entries) => {
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
  permissions.attach(profileSession(), onPermissionRequest);

  // Инкогнито-сессия (in-memory, см. INCOGNITO_PARTITION). Привязываем к ней тот же набор, что к
  // дефолтной, чтобы приватный режим был НЕ хуже обычного: адблок, загрузки, разрешения. Прокси
  // VPN — в applyVpnProxy (обязательно, иначе инкогнито-трафик тёк бы мимо VPN/kill-switch).
  incognitoSession = incognitoBrowsingSession();
  applyClientHints(incognitoSession); // приватная вкладка обязана выглядеть НЕ подозрительнее обычной
  adblock.attachSession(incognitoSession);
  downloads.observeSession(incognitoSession);
  permissions.attach(incognitoSession, onPermissionRequest);
  void applyVpnProxy(); // синхронизируем прокси инкогнито-сессии с текущим состоянием VPN сразу

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
    (w) => {
      chromeOfWin(w)?.send(IPC.DOWNLOADS_POPOVER_CLOSED);
      // ⚠️ ВОЗВРАЩАЕМ OS-ФОКУС СТРАНИЦЕ, как это делает FindBar при закрытии. Вью поповера фокус
      // забирает (запретить это Electron не даёт, electron/electron#42922), а вернуть его было
      // некому — и после закрытия хоткеи страницы молчали, пока человек не щёлкнет по ней сам.
      // Особенно больно это на вопросе «файл уже скачан»: тот открывает поповер БЕЗ клика
      // человека, то есть фокус уезжал у него из-под рук просто оттого, что он что-то качал.
      // Живая жалоба «Ctrl+Shift+S приходилось нажимать по нескольку раз» — отсюда: хоткеи
      // слушает before-input-event самой страницы, а без OS-фокуса он молчит.
      contextForWindow(w)?.tabs.focusActiveView();
    },
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
  initClipboardPopover((w) => chromeOfWin(w)?.send(IPC.CLIPBOARD_POPOVER_CLOSED));
  // Реестр медиасессий: рассылка «что играет» во все окна (см. MediaSessionManager.ts).
  initMediaSession((state) => broadcastToChrome(IPC.MEDIA_STATE_CHANGED, state));
  initAutofillPopover(
    // Поповер закрылся (крестик, клик мимо, Esc) — незавершённый разбор вставки забываем:
    // молчаливое согласие тут недопустимо, значения не должны пережить отказ.
    (w, declined) => {
      autofillOrchestrator.forgetParsedPaste(w);
      if (declined) autofillOrchestrator.notifyDeclined(w);
    },
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
      height: CHROME_OVERLAY_PX,
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
      // Прогрев оверлея перетаскивания — ДО отсечки isMain ниже: вью зон своя у КАЖДОГО окна
      // (см. DropZoneManager.ts, perWindow), и вкладку тащат в лёгком окне ровно так же.
      setTimeout(() => {
        if (!thisWin.isDestroyed()) prewarmDropZones(thisWin);
      }, DROPZONES_PREWARM_DELAY_MS);
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
      closeTranslatePopoverOnTabSwitch(); closeFindBar(win); closeSearchPopover(); hideSuggestDropdown(win); closePasswordPopover(win); closeAutofillPopover(win); closeDownloadsPopover(); closeSitePopover(); closeScreenshot(win); closeClipboardPopover(win);
      // Вопрос о разрешении привязан к конкретной странице — над чужой вкладкой ему не место.
      if (win) for (const id of dropPermissionRequests(win)) permissions.cancel(id);
      // Менеджер паролей, шаг 2: индикатор в omnibox всегда про АКТИВНУЮ вкладку — пересылаем
      // её текущее состояние (или null) при каждом реальном переключении.
      passwordAutofill.onActiveTabChanged(win);
      // Индикатор товара — тоже всегда про АКТИВНУЮ вкладку.
      pushProductState(win);
    },
    (wc, tabId) => {
      closeTranslatePopoverForClosedTab(wc); closePasswordPopover(win); closeAutofillPopover(win); closeDownloadsPopover(); closeSitePopover(); closeScreenshot(win); passwordAutofill.onTabClosed(tabId); forgetMediaTab(tabId);
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
      closeDownloadsPopover();
      // ⚠️ Без этой строки поповер сайта не закрывался кликом по странице: слушатель «клика мимо»
      // живёт в слое хрома, а клики по странице до него не доходят вовсе — страница это отдельная
      // нативная вью. Закрывать такие поповеры умеет только main, по этому самому сигналу.
      closeSitePopover();
      closeClipboardPopover(win);
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
      }, 'field');
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
      }, 'field');
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
  // Что играет в этой вкладке — в общий реестр медиасессий (см. MediaSessionManager.ts).
  tabs.setOnMediaReport((tabId, report, url) => handleMediaReport(win, tabId, report, url));
  tabs.setOnPasswordDismiss(() => closePasswordPopover(win));

  // Буфер скопированного со страниц. ⚠️ Инкогнито отсекает сам TabManager — приватная вкладка не
  // оставляет следов нигде, и список скопированного такой же след, как история.
  tabs.setOnPageCopy((text, url, title, rich) => {
    clipboardBuffer.recordCopy(text, url, title, rich);
    broadcastToChrome(IPC.CLIPBOARD_CHANGED, clipboardBuffer.listCopies().length);
  });
  tabs.setOnClipboardToggle(() => toggleClipboardPopover(win));
  // «Сохранить картинку как…» — разовый обход тумблера «спрашивать, куда сохранять» (он выключен
  // по умолчанию). Менеджер вкладок про загрузки не знает, умение приходит сюда колбэком.
  tabs.setOnSaveAs((url) => downloads.askLocationOnce(url));

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
      }, 'field');
      showAutofillPopover(win, state);
    }).catch((e) => console.warn('[address-parse] ошибка:', e));
  });

  // Ссылка в стороннее приложение, открытая новым окном (частый способ уйти на оплату).
  tabs.setOnExternalOpen((url, fromPageUrl, wcId) => {
    void openExternalWithConsent(win, url, fromPageUrl, wcId);
  });

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
  // «Этот сайт не выгружать» — читается ПРИ КАЖДОЙ проверке сна, а не копируется сюда списком:
  // правку делают из меню любого окна, и снимок списка в каждом менеджере пришлось бы
  // синхронизировать руками. Функция всегда спрашивает у настроек актуальное.
  tabs.setNeverSleepCheck((host) => settings.isNeverSleepHost(host));
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
    // Клик в AI-панель — это «мимо поповера тулбара». Слушатель клика мимо живёт в слое хрома, а
    // панель отдельная нативная вью, и её клики до хрома не доходят вовсе: без этой строки поповер
    // висел над панелью, и привычное «щёлкнуть мимо» там просто не работало. Тот же набор, что при
    // клике по странице (см. onContentFocus выше) — панель принадлежит полному окну.
    setOnAiPanelFocus(() => {
      closePasswordPopover(win);
      closeAutofillPopover(win);
      closeDownloadsPopover();
      closeSitePopover();
      closeClipboardPopover(win);
    });
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
    tabs?.dispose(); // таймер сна + вью всех вкладок окна (см. TabManager.dispose)
    tabs = null;
    // Слой хрома закрываем сами по той же причине, что и вкладки: окно не уносит с собой дочерние
    // вью, и его сайдбар с тулбаром остался бы жить отдельным процессом рендерера (разбор и
    // замер — в viewTeardown.ts).
    closeWindowView(chromeView);
    // Запасные ссылки на главное окно снимаем только вместе с ним самим — иначе закрытие
    // лёгкого окна оставило бы приложение без адресата для отправителей вне реестра.
    if (isMain) { mainWin = null; mainChromeView = null; mainTabs = null; mainSess = null; }

    // ⚠️ ВЫХОД НЕ ЖДЁТ window-all-closed. Это событие приходит, только когда закрыто КАЖДОЕ окно
    // Electron, а у приложения есть СЛУЖЕБНЫЕ невидимые окна: фоновая проверка отслеживаемых
    // товаров грузит страницу в скрытом BrowserWindow (TrackingChecker.checkView). Пока такое окно
    // живо, window-all-closed не наступает, app.quit() не зовётся — и закрытый человеком браузер
    // продолжает висеть в процессах, удерживая single-instance lock. Дальше ссылка из мессенджера
    // не открывает ничего (второй запуск умирает о замок), и запуск по ярлыку тоже молчит.
    // Здесь мы смотрим на окна БРАУЗЕРА, а не на все подряд: не осталось ни одного — приложению
    // незачем жить, чем бы ни было занято служебное окно.
    if (process.platform !== 'darwin') {
      const browserWindowsLeft = allContexts().filter((c) => c.win !== win && !c.win.isDestroyed());
      if (browserWindowsLeft.length === 0) {
        const service = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w !== win);
        if (service.length > 0) {
          console.log(`[shutdown] окон браузера не осталось, служебных живо ${service.length} — выходим сами`);
        }
        app.quit();
      }
    }
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
  // ⚠️ Засеваем область контента от окна-источника ДО приёма вкладки. Иначе у свежего окна bounds
  // ещё {0,0,0,0}, и принятая вкладка активируется невидимой (0×0), пока не смонтируется его
  // renderer и его ResizeObserver не пришлёт настоящие размеры — на экране всё это время пустой
  // контент, будто открылась новая вкладка (живая жалоба, заметнее на медленной машине). Оценка
  // приблизительная (окна могут быть разного размера) и уточняется первым же bounds нового окна,
  // но вкладка видна СРАЗУ.
  const seed = from.contentBounds;
  if (seed.width > 0 && seed.height > 0) target.tabs.setContentBounds(seed);
  if (target.tabs.adoptTab(detached)) {
    // Источник мог опустеть: вынести единственную вкладку лёгкого окна в новое — значит оставить
    // за собой пустое окно, которого никто не просил. Та же уборка, что и при возврате вкладки
    // (closeIfEmptyLight сам проверит роль: главное окно не закрывается никогда).
    closeIfEmptyLight(from);
    return true;
  }
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
// трафик уже идёт напрямую). То же на время 'starting': человек уже нажал «Подключить»,
// интерфейс показывает ожидание защиты — в эти секунды запросы не должны уходить с реальным IP
// (аудит 11.08, находка 1). Страницы на секунду-две замирают — это цена, а не баг.
// 127.0.0.1:1 — заведомо мёртвый локальный порт (никогда не совпадает с реальным SOCKS-портом
// Xray, туда в принципе никто не слушает) — любой запрос через такой "прокси" гарантированно
// проваливается, а не тихо идёт мимо него.
const VPN_KILL_SWITCH_PROXY_RULES = 'socks5://127.0.0.1:1';

// Очередь: два быстрых перехода (error → stopped) не должны обогнать друг друга.
// Каждый прогон читает состояние НА СТАРТЕ своего await, не в момент постановки в очередь.
let vpnProxyChain: Promise<void> = Promise.resolve();

function applyVpnProxy(): Promise<void> {
  const run = async (): Promise<void> => {
    const state = vpnProcess.getState();
    const port = vpnProcess.getLocalSocksPort();
    const proxyRules = state === 'running' && port
      ? `socks5://127.0.0.1:${port}`
      : state === 'stopped'
        ? 'direct://' // человек сам отключил — прямой выход честен
        : VPN_KILL_SWITCH_PROXY_RULES; // 'starting' и 'error': ждёт защиты или туннель упал
    const cfg = { proxyRules };
    // ⚠️ Прокси ставится ВСЕМ сессиям, по которым идёт пользовательский трафик, и список берётся
    // из одного места (allBrowsingSessions). Раньше здесь были перечислены две сессии руками, и
    // забыть третью значило бы утечку ровно того вида, который закрывали в августе: приватный
    // трафик мимо туннеля. С профилями сессий станет больше — правка будет одна и не здесь.
    for (const s of allBrowsingSessions()) await s.setProxy(cfg);
    // WebRTC STUN иначе обходит SOCKS и отдаёт реальный IP при «VPN включён».
    // На прямом выходе политику возвращаем: звонки без VPN не ломаем.
    currentWebrtcPolicy = proxyRules === 'direct://' ? 'default' : 'disable_non_proxied_udp';
    for (const wc of webContents.getAllWebContents()) applyWebrtcPolicy(wc);
  };
  vpnProxyChain = vpnProxyChain.then(run, run);
  return vpnProxyChain;
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
//
// Сами обработчики живут в electron/ipc/*.ts — 298 штук, раньше они лежали здесь одной функцией
// на 1666 строк. Почему нарезаны непрерывными кусками, а не по доменам, разобрано в ipc/deps.ts.
// Здесь остаётся ровно то, что обработчикам нужно от main: маршрутизация по окну-отправителю,
// менеджеры и доступ к изменяемому состоянию.
export function makeIpcDeps() {
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

  return {
    // Маршрутизация по окну-отправителю
    tabsOf, winOf, chromeOf, sendTo,
    // Менеджеры-синглтоны
    adblock, autofill, bangs, bookmarkImporters, bookmarks, downloads, graphs, history, hubChat,
    importManager, passwords, permissions, rules, searchTargets, settings, tracking, updates,
    // Функции main
    applyVpnProxy, broadcastChromeTheme, buildMoveToWindowItems, collectGroups, createWindow,
    currentThemePrefs, ensurePasswordAuth, escapeHtml, escapeHtmlAttr, maybeLazyWarmupOnDemand,
    moveTabToExistingWindow, moveTabToNewWindow, notifyGraphChanged, pushProductState,
    renameTabSmart, showBookmarkMenu, showProductMenu,
    // Пункты отслеживания цены отдельно от их показа: меню «⋯» в адресной строке вкладывает их
    // подменю, а не строит второй такой же список (см. productMenuTemplate).
    productMenuTemplate,
    // ⚠️ Изменяемое состояние main — только доступом. Положить его в объект по значению значило бы
    // раздать обработчикам копию: запись ушла бы в никуда, а чтение отдавало бы значение на момент
    // сборки контекста.
    setChromeTheme: (t: typeof currentChromeTheme) => { currentChromeTheme = t; },
    getBergamotStatus: () => bergamotStatus,
    setEnsureVpnOnForRules: (fn: typeof ensureVpnOnForRules) => { ensureVpnOnForRules = fn; },
  };
}

function registerIpc() {
  const d = makeIpcDeps();
  registerTabsIpc(d);
  registerTrackingIpc(d);
  registerOverlaysIpc(d);
  registerWindowsIpc(d);
  registerSearchIpc(d);
  registerAiHubIpc(d);
  registerVpnIpc(d);
  registerWidgetsIpc(d);
  registerGraphIpc(d);
  registerPasswordsIpc(d);
  registerHistoryIpc(d);
  registerSystemIpc(d);
  registerMenusIpc(d);
}

// Собирает GroupNode[] плоским списком из верхнего уровня дерева.
function collectGroups(nodes: SidebarNode[]): GroupNode[] {
  const groups: GroupNode[] = [];
  for (const node of nodes) {
    if (node.type === 'group') groups.push(node as GroupNode);
  }
  return groups;
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
    void openExternalWithConsent(win, url, contents.getURL(), contents.id);
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

/**
 * Вывести окно на передний план по требованию извне.
 *
 * ⚠️ ОДНОГО focus() НА WINDOWS НЕДОСТАТОЧНО, и это не наша ошибка, а защита системы: SetForegroundWindow
 * работает только у процесса, который СЕЙЧАС активен. Наш экземпляр в этот момент фоновый —
 * активен тот, из которого кликнули ссылку, — поэтому focus() в лучшем случае мигает кнопкой в
 * панели задач, а окно остаётся там же, где было. Со стороны это неотличимо от «браузер не
 * запускается»: человек кликает ссылку, ничего не происходит, он идёт в диспетчер задач, видит
 * процессы Oblako и снимает их. Живой случай, разобранный по HWND: окно было развёрнуто на весь
 * экран и помечено видимым, а на переднем плане не оказалось.
 *
 * Короткое включение alwaysOnTop — общепринятый обход: оно поднимает окно в Z-порядке без участия
 * SetForegroundWindow, после чего флаг сразу снимается, иначе окно осталось бы поверх всех чужих.
 * app.focus({ steal: true }) добирает активацию там, где система её всё-таки отдаёт.
 */
function bringToFront(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.setAlwaysOnTop(true);
  win.moveTop();
  win.setAlwaysOnTop(false);
  win.focus();
  app.focus({ steal: true });
}

// Ссылка из другого приложения при УЖЕ запущенном браузере: открываем вкладку и поднимаем окно.
app.on('second-instance', (_e, argv) => {
  const url = firstUrlFromArgv(argv);
  const ctx = mainContext() ?? allContexts()[0];
  // ⚠️ Окон может не быть вовсе (все закрыты, а процесс ещё жив — например, доигрывает выход).
  // Молча терять ссылку нельзя: для человека это «браузер не открыл страницу». Поднимаем окно
  // заново и отдаём адрес ему.
  if (!ctx) {
    const revived = createWindow();
    if (url) revived.tabs.createTab(url);
    bringToFront(revived.win);
    return;
  }
  bringToFront(ctx.win);
  if (url) ctx.tabs.createTab(url);
});

// macOS отдаёт ссылки не аргументом, а событием. Пути расходятся только здесь.
app.on('open-url', (e, url) => {
  e.preventDefault();
  const ctx = mainContext() ?? allContexts()[0];
  if (ctx) { bringToFront(ctx.win); ctx.tabs.createTab(url); }
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
  // Примеры уведомлений — чтобы человек увидел, как они выглядят, не дожидаясь реальной скидки.
  // Идут через ТОТ ЖЕ обработчик, что и настоящие: иначе примерка показывала бы не то, что придёт.
  if (NOTIFY_PREVIEW) {
    setTimeout(() => {
      const samples = [
        { title: 'Ноутбук CHUWI Corebook Air 14"', text: 'Подешевело на 1 500 ₽ (-3%), сейчас 47 490 ₽' },
        { title: 'Биты для шуруповёрта IMPACT PH2', text: 'Больше нет в наличии' },
        { title: 'Умный выключатель Aqara H2', text: 'Снова в наличии — 4 592 ₽' },
      ];
      samples.forEach((s, i) => setTimeout(() => showTrackingToast(s.title, 'https://example.com', s.text), i * 4000));
    }, 4000);
  }

  setTrackingEventHandler(({ title, url, text }) => showTrackingToast(title, url, text));
  searxngKeyStore.loadFromDisk();
  vpnKeyStore.loadFromDisk();
  skillsStore.loadFromDisk();
  // Закреплённое в буфере — единственное, что буфер вообще держит на диске (см. ClipboardPins.ts).
  // Поднимаем ДО первых копий: загрузка сдвигает счётчик id, иначе новая копия получила бы id уже
  // лежащей на полке записи.
  clipboardBuffer.loadPinnedFromDisk();

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
  // Вопрос «открыть ссылку в приложении?» идёт тем же путём, что камера и геопозиция: свой
  // поповер, общая таблица, отзыв в разделе «Разрешения» (разбор — в ExternalProtocol.ts).
  setExternalConsentAsk((origin, wcId) => permissions.askOwn(origin, 'external-app', wcId));
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
