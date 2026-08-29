// Менеджер вкладок ОДНОГО окна: создание и проводка к поповерам, поиску, автозаполнению и
// паролям.
//
// ⚠️ Границы этого файла взяты по СУЩЕСТВУЮЩЕМУ разрыву в createWindow (до регистрации контекста
// окна), а тело перенесено дословно, до строки. Причина та же, что у нарезки IPC-обработчиков:
// проводка в createWindow идёт не смысловыми группами, а в порядке, который сложился
// исторически, и «разложить по доменам» означало бы собирать файл из перемежающихся фрагментов —
// то есть переписывать, а не переносить. Подробный разбор — в шапке electron/ipc/deps.ts.
import { WebContentsView } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc';
import { TabManager } from '../TabManager';
import type { SessionManager } from '../SessionManager';
import type { FindResult } from '../../shared/ipc';
import { DEFAULT_PROFILE_ID } from '../../shared/profiles';
import { parseAddressBlob } from '../AddressParser';
import { onTabsSynced } from '../AiPanelManager';
import * as autofillOrchestrator from '../AutofillOrchestrator';
import { closeAutofillPopover, showAutofillPopover, syncAutofillPopoverAnchorBounds } from '../AutofillPopoverManager';
import * as clipboardBuffer from '../ClipboardBuffer';
import { closeClipboardPopover, toggleClipboardPopover } from '../ClipboardPopoverManager';
import { closeDownloadsPopover } from '../DownloadsPopoverManager';
import { openExternalWithConsent } from '../ExternalProtocol';
import { closeFindBar, sendFindResult, showFindBar } from '../FindBarManager';
import { indexVisit } from '../HistoryIndexer';
import { forgetMediaTab, handleMediaReport } from '../MediaSessionManager';
import { onTabsSynced as onPageTranslateTabsSynced } from '../PageTranslateManager';
import * as passwordAutofill from '../PasswordAutofillManager';
import { closePasswordPopover, showPasswordPopover, syncPasswordPopoverAnchorBounds } from '../PasswordPopoverManager';
import { dropPermissionRequests } from '../PermissionPopoverManager';
import { historyFor } from '../ProfileData';
import { closeScreenshot } from '../ScreenshotManager';
import { closeSearchPopover } from '../SearchPopoverManager';
import { closeSitePopover } from '../SitePopoverManager';
import { hideSuggestDropdown } from '../SuggestDropdownManager';
import { closeTranslatePopoverForClosedTab, closeTranslatePopoverOnTabSwitch, showTranslatePopover } from '../TranslatePopoverManager';
import { broadcastToChrome } from '../WindowRegistry';
import type { WindowDeps } from './deps';

export interface WindowShell {
  win: BrowserWindow;
  chromeView: WebContentsView;
  isMain: boolean;
  sess: SessionManager | null;
}

/**
 * ⚠️ Возвращает НЕ просто менеджер, а пару {tabs, forget}. Причина не в стиле: колбэки, которые
 * TabManager получает в конструкторе, замыкают ЭТУ переменную `tabs`, и раньше `tabs = null` при
 * закрытии окна гасил их все разом — они видели null и молча ничего не делали. Верни мы отсюда
 * только сам менеджер, main обнулял бы СВОЮ ссылку, а здешние колбэки продолжали бы звать методы
 * уже уничтоженного менеджера. `forget()` — та же строчка `tabs = null`, просто теперь её надо
 * позвать явно.
 */
export function createWindowTabManager(
  shell: WindowShell, deps: WindowDeps,
): { tabs: TabManager; forget: () => void } {
  const { win, chromeView, sess } = shell;
  const {
    PRODUCT_DETECT_DELAY_MS, downloads, hubChat, incognitoSession, isShuttingDown,
    permissions, pushProductState, refreshProductForWebContents, searchTargets, startedAt,
  } = deps;
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
      if (!isShuttingDown()) onTabsSynced(tabsSnapshot);
      // Тот же снапшот — привязка полностраничного перевода к активной вкладке (сброс состояния
      // на навигацию/закрытие, см. PageTranslateManager.ts::onTabsSynced), тот же принцип.
      if (!isShuttingDown()) onPageTranslateTabsSynced(tabsSnapshot);
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
      // ⚠️ Профиль ВКЛАДКИ, а не активный: фоновая вкладка «Работы» догружается, пока человек
      // смотрит «Личное», и её визит ушёл бы в чужую историю. См. TabManager.profileOfWebContents.
      const visitHistory = historyFor(tabs?.profileOfWebContents(wc.id) ?? DEFAULT_PROFILE_ID);
      visitHistory.recordVisit(url, title);
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
      void indexVisit(visitHistory, url, title, wc).catch((e: unknown) =>
        console.warn('[HistoryIndexer] неожиданная ошибка:', e),
      );
      // Товар на странице (PRICE-TRACKING.md). ⚠️ С задержкой: JSON-LD у части магазинов
      // дорисовывается скриптом уже после did-navigate. Ничего не показываем и не пишем — только
      // запоминаем, чтобы индикатор в тулбаре знал, есть ли тут что отслеживать.
      setTimeout(() => { void refreshProductForWebContents(wc); }, PRODUCT_DETECT_DELAY_MS);
    },
    // ⚠️ Тоже по профилю ВКЛАДКИ, а не активного: page-title-updated стреляет у любой вкладки,
    // включая фоновую чужого профиля (SPA обновляют заголовок постоянно).
    (url, title, wc) => historyFor(tabs?.profileOfWebContents(wc.id) ?? DEFAULT_PROFILE_ID).updateTitle(url, title),
    ()              => chromeView?.webContents.send(IPC.HISTORY_OPEN),
    ()              => console.log(`[startup] firsttab ${Date.now() - startedAt}ms`),
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
      if (tabs?.takeIncognitoClearIfDone()) void incognitoSession()?.clearStorageData();
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

  return { tabs, forget: () => { tabs = null } };
}
