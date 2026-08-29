// Восстановление дерева вкладок из session.json.
//
// ⚠️ Единственный кусок createWindow, ошибка в котором стоит человеку его открытых вкладок.
// Тело перенесено из createWindow ДОСЛОВНО, до строки; формат снимка версионирован (сейчас v5,
// типы — shared/session.ts), а раскладку дерева держит shared/sessionTree.ts под проверкой
// `npm test -- session`.
import type { SessionSnapshot } from '../../shared/session';
import type { SavedNode } from '../SessionManager';
import type { TabManager } from '../TabManager';

export function restoreSession(restored: SessionSnapshot, tabs: TabManager, startedAt: number): void {
    // Закреплённые сначала — стабильный порядок, всегда вверху сайдбара. Рождаются СПЯЩИМИ
    // (createSleepingPinnedTab — раньше здесь был createPinnedTab, реальный WebContentsView+
    // loadURL для КАЖДОЙ сразу: 10 закреплённых = 10 параллельных загрузок страниц на старте,
    // видимый пик CPU). Закреплённость больше не значит «грузить eagerly» — только activeRef
    // ниже решает, кого разбудить; будет ли разбуженная вкладка закреплённой или нет, роли не
    // играет (см. activate()::wakeTab — ему всё равно, откуда пришёл id, tabMap/pinnedTabs же
    // общий индекс).
    const pinnedIds: string[] = [];
    const pinnedUrlToId = new Map<string, string>();
    for (const { url, title, faviconData, profileId } of restored.pinnedTabs) {
      const id = tabs.createSleepingPinnedTab(url, title, faviconData, profileId);
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
          const id = tabs!.createSleepingTab(node.url, node.title, node.faviconData, node.profileId);
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
    // ⚠️ ФОЛЛБЭК — ХАБ, А НЕ ПЕРВАЯ ВКЛАДКА. Раньше здесь стояло
    // `tabs.snapshot().find((t) => !t.isHub)`, то есть первая по порядку сайдбара, а первыми там
    // идут ЗАКРЕПЛЁННЫЕ. Со стороны человека это выглядело так: браузер открывается на случайном
    // закреплённом сайте, которого он не открывал (живая жалоба «бесит»). Прежнее объяснение —
    // «иначе старт останется без единой живой вкладки» — сегодня неверно: хаб это полноценный
    // экран со столом и виджетами, а не пустота. Открыться не на том сайте хуже, чем открыться
    // на своей же новой вкладке.
    //
    // ⚠️ Причину промаха ЛОГИРУЕМ. Молчаливый фоллбэк и был тем, из-за чего поведение выглядело
    // случайным: разрешение activeRef могло не сработать (ссылка на адрес, которого больше нет,
    // повреждённый JSON), и понять это было неоткуда.
    const refMissed = !targetId && ref.type !== 'hub';
    if (refMissed) console.warn(`[startup] activeRef не разрешился (${ref.type}) — открываю хаб`);
    if (targetId) tabs.activate(targetId);

    // Диагностика ленивого восстановления: сколько вкладок реально восстановилось (сверить с
    // числом вкладок в session.json — ни одна не должна потеряться) и сколько из них уснувших.
    const restoredSnapshot = tabs.snapshot().filter((t) => !t.isHub);
    const sleepingCount = restoredSnapshot.filter((t) => t.isSleeping).length;
    console.log(
      `[startup] restore: pinned=${pinnedIds.length} tabs=${restoredSnapshot.length} ` +
      `sleeping=${sleepingCount} awake=${restoredSnapshot.length - sleepingCount} ${Date.now() - startedAt}ms`,
    );
}
