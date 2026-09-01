// Показ главного окна и staggered-прогревы тяжёлых вью.
//
// Вынесено из createWindow: там это был безымянный блок в фигурных скобках на 90 строк, и
// единственным, что связывало его части, было соседство строк.
import { ipcMain } from 'electron';
import type { BrowserWindow, WebContentsView } from 'electron';
import { IPC } from '../../shared/ipc';
import type { SettingsManager } from '../SettingsManager';
import type { TabManager } from '../TabManager';
import { closeSplash } from '../SplashWindow';
import { prewarmDropZones } from '../DropZoneManager';
import { prewarmPanel } from '../AiPanelManager';
import { prewarmSitePopover } from '../SitePopoverManager';
import { prewarmDownloadsPopover } from '../DownloadsPopoverManager';
import * as ModelRegistry from '../ModelRegistry';

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
// Прогрев поповеров, которые открывает сам человек и часто: карточка сайта под замком и список
// загрузок. ⚠️ Разнесены во времени и идут ПОСЛЕ зон перетаскивания: каждая вью — отдельный
// рендер-процесс, и три подряд в одну точку старта дали бы ровно тот провал, ради ухода от
// которого staggered-задержки тут и появились. Поповеры, которые открывает СТРАНИЦА (пароли,
// разрешения, автозаполнение), остаются ленивыми — их в этом сеансе может не быть вовсе.
const SITE_POPOVER_PREWARM_DELAY_MS = 2600;
const DOWNLOADS_POPOVER_PREWARM_DELAY_MS = 3600;

export function showWhenReady({
  win, chromeView, isMain, startedAt, getTabs, settings, warmupTranslation, probeBergamot,
}: {
  win: BrowserWindow;
  chromeView: WebContentsView;
  isMain: boolean;
  startedAt: number;
  /** ⚠️ Колбэк, а не значение: TabManager создаётся ПОСЛЕ этого вызова, а показ окна асинхронен. */
  getTabs: () => TabManager | null;
  settings: SettingsManager;
  warmupTranslation: () => Promise<void>;
  probeBergamot: () => void;
}): void {
  // Показ окна: ждём сигнал «оболочка отрисована» (useEffect+rAF в src/main.tsx). Fallback-таймаут
  // обязателен — если сигнал не пришёл (упал preload/React, Vite ещё не поднялся в dev),
  // окно всё равно должно появиться, а не висеть невидимым.
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
        getTabs()?.focusActiveView();
        console.log(`[startup] show reason=${reason} ${Date.now() - startedAt}ms`);
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
        // Bergamot: только СТАТУС для настроек, воркер здесь больше не поднимается.
        // ⚠️ Прогрев отсюда убран по замеру: спавн воркера добавлял главному процессу 1170 МБ —
        // больше половины всей памяти браузера — на каждом старте, ради движка, которым за сеанс
        // могли ни разу не воспользоваться. Воркер поднимается при первом переводе страницы
        // (ensureActiveEngineWarm в TranslationEngineRegistry.ts).
        probeBergamot();
      }, TRANSLATION_WARMUP_DELAY_MS);
      // Прогрев AI-панели — своя, более ранняя задержка (см. AI_PANEL_PREWARM_DELAY_MS): лёгкий
      // прогрев (не модель), staggered отдельно от прогрева Qwen выше, чтобы не
      // бить оба прогрева в одну точку старта.
      setTimeout(() => {
        if (!thisWin.isDestroyed()) prewarmPanel();
      }, AI_PANEL_PREWARM_DELAY_MS);
      // Поповеры — общие на приложение (одна вью на все окна), поэтому под тем же `isMain`, что
      // и прогревы выше: второе окно не должно строить их заново.
      setTimeout(() => {
        if (!thisWin.isDestroyed()) prewarmSitePopover();
      }, SITE_POPOVER_PREWARM_DELAY_MS);
      setTimeout(() => {
        if (!thisWin.isDestroyed()) prewarmDownloadsPopover();
      }, DOWNLOADS_POPOVER_PREWARM_DELAY_MS);
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
