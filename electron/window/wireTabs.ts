// Проводка вкладок окна: поиск, бэнги, сон, поповеры, снимок, правила, граф, быстрый поиск,
// перенос вкладок между окнами.
//
// ⚠️ Границы взяты по СУЩЕСТВУЮЩЕМУ разрыву в createWindow — от настроек поиска до
// восстановления сессии, — а тело перенесено дословно. Разбор, почему нельзя раскладывать
// проводку «по доменам», — в шапке electron/ipc/deps.ts.
import type { BrowserWindow, WebContentsView } from 'electron';
import { applyBangTemplate, bangHomeUrl, isValidBangTemplate, parseBangCandidate } from '../../shared/bangs';
import { IPC } from '../../shared/ipc';
import type { QuickHit, SearchTarget } from '../../shared/ipc';
import { setTabManager, setModelStateProvider as setAiPanelModelStateProvider, setOnChatIntent as setOnAiPanelChatIntent, setOnPanelFocus as setOnAiPanelFocus } from '../AiPanelManager';
import { mapFormFields, type FormFieldDescriptor } from '../AutofillFieldMapper';
import { closeAutofillPopover } from '../AutofillPopoverManager';
import { showBookmarkMenu } from '../BookmarkMenu';
import { closeClipboardPopover } from '../ClipboardPopoverManager';
import { closeDownloadsPopover } from '../DownloadsPopoverManager';
import { faviconService } from '../FaviconService';
import { setTabManager as setFindBarTabManager } from '../FindBarManager';
import { buildAddToGraphMenuItem } from '../GraphInbox';
import { setTabManager as setGraphWebAppTabManager } from '../GraphWebAppManager';
import * as ModelRegistry from '../ModelRegistry';
import { setTabManager as setNotebookExtractTabManager } from '../NotebookExtract';
import { readPageSelection } from '../PageSelection';
import { onProgressChanged as onPageTranslateProgressChanged, onStateChanged as onPageTranslateStateChanged, setTabManager as setPageTranslateTabManager } from '../PageTranslateManager';
import { closePasswordPopover } from '../PasswordPopoverManager';
import { applyRules } from '../RuleEngine';
import { captureTabScreenshot, closeScreenshot, saveCurrentScreenshot, setScreenshotTabManager } from '../ScreenshotManager';
import { setOnQuickOpen, setOnQuickQuery, setOnSearchRun, setTabManager as setSearchPopoverTabManager, showSearchPopover } from '../SearchPopoverManager';
import { buildSearchTargets } from '../SearchTargets';
import { closeSitePopover } from '../SitePopoverManager';
import { setTabManager as setOrganizerTabManager } from '../TabOrganizer';
import { getLoadedModelId } from '../TranslationService';
import { allContexts } from '../WindowRegistry';
import type { TabManager } from '../TabManager';
import type { WindowDeps } from './deps';
import { toggleTaskManager } from '../TaskManagerWindow';

export function wireTabs(
  shell: {
    win: BrowserWindow;
    chromeView: WebContentsView;
    isMain: boolean;
    tabs: TabManager;
  },
  deps: WindowDeps,
): void {
  const { win, chromeView, isMain, tabs } = shell;
  const {
    adblock, bangs, bookmarks, createWindow, ensureVpnOnForRules, graphs, history,
    maybeLazyWarmupOnDemand, moveTabToExistingWindow, notifyGraphChanged, rules,
    searchTargets, settings,
  } = deps;
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

    // Имя и состояние модели для плашки панели. Политику знает main, панель получает готовую

    // пару «как называется» / «уже в памяти» — тем же приёмом, что прогрев выше.

    setAiPanelModelStateProvider(() => {

      const def = ModelRegistry.getDefault();

      return { label: def?.label ?? null, loaded: def !== null && getLoadedModelId() === def.id };

    });

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



    for (const b of bookmarks().list()) {

      if (hits.length >= 6) break;

      if (matches(b.title ?? '', b.url)) {

        add({ kind: 'bookmark', url: b.url, title: b.title || b.url });

      }

    }



    for (const h of history().search(text.trim())) {

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
  // Диспетчер задач по Shift+Esc. ⚠️ Окно одно на приложение, поэтому колбэк у каждого окна свой,
  // а поднимает он один и тот же экземпляр (см. TaskManagerWindow.ts).
  tabs.onTaskManager(() => { toggleTaskManager(); });

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
}
