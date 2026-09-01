// Организация вкладок, сертификаты, AI-панель, перевод, нативные меню, группы, железо и модели
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import { IPC } from '../../shared/ipc';
import type { ModelDownloadSpec, OrganizeCluster } from '../../shared/ipc';
import { toggleAiPanel } from '../AiPanelManager';
import { listUserTrusted, removeUserTrusted } from '../CertTrustStore';
import { refreshCertificateTrust } from '../CertificateTrust';
import { relayoutFindBar } from '../FindBarManager';
import { buildAddToGraphMenuItem } from '../GraphInbox';
import * as HardwareInfo from '../HardwareInfo';
import * as ModelCatalog from '../ModelCatalog';
import * as ModelDownloader from '../ModelDownloader';
import * as ModelRegistry from '../ModelRegistry';
import { togglePageTranslate, getActiveState as getPageTranslateActiveState } from '../PageTranslateManager';
import { relayoutScreenshot } from '../ScreenshotManager';
import { relayoutSearchPopover } from '../SearchPopoverManager';
import { HUB_ID, TabManager } from '../TabManager';
import { suggestGroupName, suggestGroups } from '../TabOrganizer';
import { suggestTabTitle } from '../TabRenamer';
import { getLoadedModelId, isModelWarm, unloadModel } from '../TranslationService';
import { broadcastToChrome, contextFromSender } from '../WindowRegistry';
import { Menu, clipboard, ipcMain } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import type { IpcDeps } from './deps';

export function registerMenusIpc(d: IpcDeps): void {
  const { buildMoveToWindowItems, chromeOf, collectGroups, escapeHtml, escapeHtmlAttr, graphs, moveTabToNewWindow, notifyGraphChanged, productMenuTemplate, renameTabSmart, sendTo, settings, tabsOf, winOf } = d;

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

  // Меню «⋯» в адресной строке — действия НАД ЭТОЙ СТРАНИЦЕЙ, которым не нужна постоянная кнопка.
  //
  // ⚠️ Перевод переехал сюда из правого кластера, и у него есть СОСТОЯНИЕ («перевожу»,
  // «переведено»), которого из закрытого меню не видно. Поэтому само «⋯» подсвечивается акцентом,
  // пока перевод активен (см. Toolbar.tsx): состояние остаётся на виду, а ширина полосы не пляшет.
  // Плата честная и осознанная — «показать оригинал» стало в два клика вместо одного.
  ipcMain.handle(IPC.OMNIBOX_MORE_MENU, (e) => {
    const w = winOf(e);
    if (!w) return;
    const state = getPageTranslateActiveState();
    const items: MenuItemConstructorOptions[] = [{
      label: state === 'translating' ? 'Перевожу страницу…'
        : state === 'translated' ? 'Показать оригинал'
        : 'Перевести страницу',
      // Пока идёт перевод, жать нечего — но пункт ВИДЕН: пустое меню ровно в тот момент, когда
      // человек пришёл проверить, что происходит, читалось бы как поломка.
      enabled: state !== 'translating',
      click: () => { void togglePageTranslate(); },
    }];
    // Цены на странице нет — и пунктов про неё нет. Обещать отслеживание там, где оно не
    // сработает, нельзя (тот же принцип, что у самого индикатора товара, см. PRICE-TRACKING.md).
    const product = productMenuTemplate(w);
    if (product) {
      items.push({ type: 'separator' });
      items.push({ label: 'Отслеживание цены', submenu: product });
    }
    Menu.buildFromTemplate(items).popup({ window: w });
  });

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
    // Пусто у хаба и псевдо-вкладок (История/Настройки) — им правило «не выгружать сайт» приписать
    // не к чему, поэтому пункт меню для них не появляется вовсе.
    const host = t.getTabHost(id);
    const toGraph = state
      ? buildAddToGraphMenuItem(graphs, [{ url: state.url, title: state.title || state.url }], undefined, notifyGraphChanged)
      : null;

    const items: MenuItemConstructorOptions[] = [
      {
        label: isPinned ? 'Открепить вкладку' : 'Закрепить вкладку',
        click: () => t.togglePin(id),
      },
      // Копия вкладки рядом с исходной, с её историей и приватностью (см. TabManager.duplicateTab).
      // Тот же признак «есть сайт», что и у пункта «Не выгружать из памяти» ниже: у хаба и
      // псевдо-вкладок (История/Настройки) host пуст, дублировать там нечего.
      {
        label: 'Дублировать вкладку',
        enabled: host !== '',
        click: () => { t.duplicateTab(id); },
      },
      // Звук вкладки. ⚠️ Пункт появляется, ТОЛЬКО когда звук вообще есть о чём говорить —
      // вкладка звучит либо уже приглушена. Постоянный пункт про звук у тихой страницы был бы
      // шумом в и без того длинном меню.
      // ⚠️ Это единственная дверь к звуку при СВЁРНУТОЙ панели вкладок: там у ячейки нет места
      // ни на что, кроме значка сайта, — живая жалоба «в свёрнутом сайдбаре звук не выключить».
      ...(state && (state.audible || state.muted) ? [{
        label: state.muted ? 'Включить звук' : 'Выключить звук',
        click: () => t.setTabMuted(id, !state.muted),
      } as MenuItemConstructorOptions] : []),
      // Перезагрузка мимо кэша. ⚠️ Для СПЯЩЕЙ вкладки пункт неактивен намеренно: живого
      // WebContents у неё нет, сбрасывать нечего, а пробуждение и так грузит страницу заново
      // (см. TabManager.reloadHard). Молча ничего не делающий пункт читался бы как поломка.
      {
        label: 'Обновить без кэша',
        accelerator: 'Ctrl+F5',
        enabled: host !== '' && t.getWebContentsForTab(id) !== null,
        click: () => t.reloadHard(id),
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
      // «Не выгружать из памяти» — решение ПРО САЙТ, а не про эту вкладку: закрыл вкладку —
      // правило осталось, открыл ту же почту завтра — она снова под защитой. Отменяется тем же
      // пунктом или в настройках («Браузер» → «Выгрузка вкладок из памяти»). Пункта нет у
      // псевдо-вкладок и хаба: у них нет сайта, которому это правило можно приписать.
      ...(host ? [{
        label: 'Не выгружать из памяти',
        type: 'checkbox' as const,
        checked: settings.isNeverSleepHost(host),
        click: () => {
          settings.toggleNeverSleepHost(host);
          // Раздел настроек мог быть открыт соседней вкладкой — пусть перечитает список.
          broadcastToChrome(IPC.NEVER_SLEEP_CHANGED);
        },
      }] : []),
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

  // Явная выгрузка модели из VRAM (см. TranslationService.ts::unloadModel). ⚠️ Уже не «задел без
  // потребителей»: кнопка есть в диспетчере задач (Shift+Esc).
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
