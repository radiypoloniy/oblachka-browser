import { WebContentsView, BrowserWindow, Menu, clipboard } from 'electron';
import type { MenuItemConstructorOptions, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { TabState, TabErrorState, ContentBounds, FindResult, SidebarNode, SingleNode, SplitPairNode, GroupNode, AiAction } from '../shared/ipc';
import type { SessionSnapshot, SavedNode, SavedSingleNode, SavedSplitPairNode, SavedGroupNode, SavedActiveRef } from './SessionManager';

const CLOSED_STACK_MAX = 10;

const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 2.5;
const ZOOM_STEP = 0.1; // 10% за шаг, как в Chrome

// Ширина зазора между split-панелями (px). Должна совпадать с SPLIT_GAP в App.tsx.
const SPLIT_GAP = 8;
const SPLIT_RATIO_MIN = 0.2;
const SPLIT_RATIO_MAX = 0.8;

const SLEEP_TIMEOUT_NORMAL = 2 * 60 * 60 * 1000;  // 2 часа без активности
const SLEEP_TIMEOUT_PINNED = 8 * 60 * 60 * 1000;  // 8 часов для закреплённых
const SLEEP_CHECK_INTERVAL = 60_000;               // проверка раз в минуту

// «Краткая выжимка» имеет смысл только для достаточно длинного выделения (иначе выжимать нечего) —
// одно место, легко поменять. ~40 слов ~ 250 символов на кириллице/латинице.
const SUMMARIZE_MIN_CHARS = 250;

// Обрезает длинный текст для лейблов меню, чтобы не растягивало окно.
function truncate(text: string, max = 40): string {
  const s = text.trim().replace(/\s+/g, ' ');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// Поисковик по умолчанию — DuckDuckGo (приватный), как в спеке (3.2).
const SEARCH_URL = (q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;

// id вкладки-хаба фиксирован: это НЕ WebContentsView, а наш React-экран.
export const HUB_ID = 'hub';

// Метаданные, сохраняемые при усыплении вкладки.
interface SleepingMeta {
  url: string;
  title: string;
  faviconUrl: string | null;
}

// Прямоугольник (селекшена или фоллбэк-точки клика) в координатах ОКНА — уже с добавленным
// оффсетом view.getBounds(), готов к использованию для позиционирования поповера в main.ts.
export interface SelectionRect { x: number; y: number; width: number; height: number }

interface ManagedTab {
  id: string;
  view: WebContentsView | null; // null = хаб (sleeping===null) ИЛИ спящая (sleeping!==null)
  sleeping: SleepingMeta | null;
  lastActiveAt: number; // Date.now() последней активности — для таймера сна
}

// Скрипт проверки незаполненных форм — только top-frame (v1: поля внутри iframe не проверяются).
const HAS_FILLED_FORMS_SCRIPT = `(function(){
  var sel='input:not([type=checkbox]):not([type=radio]):not([type=hidden])' +
    ':not([type=submit]):not([type=button]):not([type=reset]):not([type=file]),' +
    'textarea,[contenteditable="true"]';
  var els=document.querySelectorAll(sel);
  for(var i=0;i<els.length;i++){
    var v=els[i].value||els[i].textContent||'';
    if(v.trim().length>0)return true;
  }
  return false;
})()`;

// Прямоугольник выделения (последний range) в координатах viewport страницы — для позиционирования
// поповера перевода. null, если выделения нет (тогда — фоллбэк на p.x/p.y клика ПКМ) — и ТАК ЖЕ
// null, если bounding rect всего выделения больше вьюпорта или начинается за его пределами (напр.
// выделили несколько экранов текста с прокруткой — rect в основном закадровый, якорить под ним
// поповер уводит его далеко от видимого текста, диагностировано логами: height=1649 при вьюпорте
// ~744, y=-1278). В этом случае координата клика ПКМ (она точно на экране) надёжнее bounding rect
// всего выделения — для НОРМАЛЬНОГО выделения, влезающего во вьюпорт, поведение не меняется.
const SELECTION_RECT_SCRIPT = `(function(){
  var sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  var r = sel.getRangeAt(0).getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  if (r.height > window.innerHeight || r.width > window.innerWidth || r.top < 0 || r.left < 0) return null;
  return { x: r.left, y: r.top, width: r.width, height: r.height };
})()`;

export class TabManager {
  private win: BrowserWindow;

  // ── Единый источник истины — три структуры ──────────────────────────────────
  // hubTab   — хаб (всегда существует, не входит в nodes и pinnedTabs).
  // pinnedTabs — упорядоченный список закреплённых (переживают рестарт).
  // nodes    — упорядоченное дерево узлов для секции «Открытые вкладки».
  //            Phase 0: только SingleNode. split-pair / group — Фазы 2–4.
  // tabMap   — все non-hub вкладки, O(1) доступ по id.
  // Один и тот же nodes обслуживает отрисовку, Ctrl+1–9, Ctrl+Tab и автосейв.
  private hubTab: ManagedTab;
  private pinnedTabs: ManagedTab[] = [];
  private nodes: SidebarNode[] = [];
  private tabMap = new Map<string, ManagedTab>();

  private activeId: string = HUB_ID;
  private bounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
  private onChange: () => void;
  private onFindResultCb: (r: FindResult) => void;
  private onFindOpenCb: () => void;
  private onFindCloseCb: () => void;
  private onOmniboxFocusCb: () => void;
  private onFocusChromeCb: () => void;
  private onNavigateCb?: (url: string, title: string) => void;
  private onTitleUpdateCb?: (url: string, title: string) => void;
  private onHistoryOpenCb?: () => void;
  private onFirstTabLoadCb?: () => void;
  // Общий колбэк для ВСЕХ AI-действий над выделением (перевод/выжимка/пересказ/объяснение) — та же
  // труба «координаты → Qwen → поповер», разные action только меняют промпт (см. TranslationService.ts).
  private onAiActionCb?: (action: AiAction, text: string, rect: SelectionRect, wc: WebContents) => void;
  // Поповер перевода анкорится к конкретной вкладке/области — при смене активной вкладки его
  // позиция теряет смысл, при закрытии ИМЕННО этой вкладки — тем более. Два отдельных сигнала
  // (не переиспользуем onChange — он общий и палит на ~20 несвязанных мутаций).
  private onActiveTabChangedCb?: () => void;
  private onTabClosedCb?: (wc: WebContents) => void;
  private firstTabLoaded = false; // защита: колбэк вызывается ровно один раз
  private closedTabs: string[] = []; // стек URL закрытых вкладок для Ctrl+Shift+T
  private errors = new Map<string, TabErrorState>(); // per-tab ошибки загрузки/краша
  private lastQuery = ''; // последний поисковый запрос (чтобы отличить новый от навигации)
  // Флаг: открыта ли панель поиска (нужен для приоритета Esc: сначала закрыть поиск).
  private findBarOpen = false;
  // Снимок nodes до последней AI-группировки: null = нет чего откатывать.
  // Сбрасывается при любом ручном структурном изменении (drag, создание/удаление группы и т.п.).
  private organizeSnapshot: SidebarNode[] | null = null;
  // Состояние split-режима: null = обычный режим.
  // splitRatio — доля левой панели (0.2..0.8), сохраняется пока split существует.
  // Phase 2: когда split-pair станет узлом в nodes, splitState уйдёт — split начнёт
  // переживать рестарт. Это намеренный будущий эффект, пока не реализован.
  private splitState: {
    leftId: string;
    rightId: string;
    activePanel: 'left' | 'right';
    splitRatio: number;
  } | null = null;

  constructor(
    win: BrowserWindow,
    onChange: () => void,
    onFindResult: (r: FindResult) => void,
    onFindOpen: () => void,
    onFindClose: () => void,
    onOmniboxFocus: () => void,
    onFocusChrome: () => void,
    onNavigate?: (url: string, title: string) => void,
    onTitleUpdate?: (url: string, title: string) => void,
    onHistoryOpen?: () => void,
    onFirstTabLoad?: () => void,
    onAiAction?: (action: AiAction, text: string, rect: SelectionRect, wc: WebContents) => void,
    onActiveTabChanged?: () => void,
    onTabClosed?: (wc: WebContents) => void,
  ) {
    this.win = win;
    this.onChange = onChange;
    this.onFindResultCb = onFindResult;
    this.onFindOpenCb = onFindOpen;
    this.onFindCloseCb = onFindClose;
    this.onOmniboxFocusCb = onOmniboxFocus;
    this.onFocusChromeCb = onFocusChrome;
    this.onNavigateCb = onNavigate;
    this.onTitleUpdateCb = onTitleUpdate;
    this.onHistoryOpenCb = onHistoryOpen;
    this.onFirstTabLoadCb = onFirstTabLoad;
    this.onAiActionCb = onAiAction;
    this.onActiveTabChangedCb = onActiveTabChanged;
    this.onTabClosedCb = onTabClosed;
    // Хаб существует всегда; не входит в tabMap, pinnedTabs или nodes.
    this.hubTab = { id: HUB_ID, view: null, sleeping: null, lastActiveAt: 0 };
    this.startSleepTimer();
  }

  // ── Парсинг omnibox: это URL или поисковый запрос ──
  // Явные правила из спеки (3.7). Edge-кейсы лучше прописать заранее.
  private resolveInput(input: string): string {
    const s = input.trim();
    if (!s) return 'about:blank';
    // Уже есть схема
    if (/^(https?|file|about):/i.test(s)) return s;
    // localhost / IP / есть точка и нет пробела -> трактуем как хост
    const looksLikeHost =
      /^localhost(:\d+)?(\/.*)?$/i.test(s) ||
      /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(s) ||
      (!/\s/.test(s) && /\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s));
    if (looksLikeHost) return `https://${s}`;
    return SEARCH_URL(s);
  }

  private isHttpView(view: WebContentsView | null): view is WebContentsView {
    return view !== null;
  }

  // ── Снимок состояния для UI ──
  // Порядок: хаб → закреплённые → узлы (flat, Phase 0: всё SingleNode).
  // Совпадает с визуальным порядком сайдбара и порядком Ctrl+1–9 / Ctrl+Tab.
  snapshot(): TabState[] {
    const result: TabState[] = [];

    // Хаб
    result.push({
      id: HUB_ID, isActive: HUB_ID === this.activeId,
      tabError: null,
      url: '', title: 'Новая вкладка · AI-хаб',
      faviconUrl: null, isLoading: false,
      canGoBack: false, canGoForward: false, isHub: true, isPinned: false,
      splitSide: null, isSleeping: false,
    });

    // Закреплённые
    for (const t of this.pinnedTabs) result.push(this.#tabToState(t, true));

    // Обычные (через узлы)
    for (const t of this.#flattenNodes()) result.push(this.#tabToState(t, false));

    // DBG: инвариант — каждый split-pair в nodes должен иметь оба таба в tabMap.
    this.#debugCheckSplitInvariant('snapshot');

    return result;
  }

  // Превращает ManagedTab в TabState; isPinned явно передаётся — известно по списку.
  #tabToState(t: ManagedTab, isPinned: boolean): TabState {
    if (t.sleeping) {
      return {
        id: t.id, isActive: t.id === this.activeId,
        tabError: null,
        url: t.sleeping.url, title: t.sleeping.title, faviconUrl: t.sleeping.faviconUrl,
        isLoading: false, canGoBack: false, canGoForward: false,
        isHub: false, isPinned,
        splitSide: !this.splitState ? null
          : t.id === this.splitState.leftId  ? 'left' as const
          : t.id === this.splitState.rightId ? 'right' as const
          : null,
        isSleeping: true,
      };
    }
    if (!this.isHttpView(t.view)) {
      // Хаб обрабатывается отдельно выше; сюда не должны попадать.
      return {
        id: t.id, isActive: t.id === this.activeId,
        tabError: null, url: '', title: '', faviconUrl: null,
        isLoading: false, canGoBack: false, canGoForward: false,
        isHub: false, isPinned, splitSide: null, isSleeping: false,
      };
    }
    const wc = t.view.webContents;
    return {
      id: t.id, isActive: t.id === this.activeId,
      tabError: this.errors.get(t.id) ?? null,
      url: wc.getURL(),
      title: wc.getTitle() || wc.getURL() || 'Загрузка…',
      faviconUrl: (wc as unknown as { _oblakoFavicon?: string })._oblakoFavicon ?? null,
      isLoading: wc.isLoadingMainFrame(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      isHub: false, isPinned,
      splitSide: !this.splitState ? null
        : t.id === this.splitState.leftId  ? 'left' as const
        : t.id === this.splitState.rightId ? 'right' as const
        : null,
      isSleeping: false,
    };
  }

  // Плоский список ManagedTab из дерева узлов (рекурсивный — обходит группы).
  #flattenNodes(nodes: SidebarNode[] = this.nodes): ManagedTab[] {
    const result: ManagedTab[] = [];
    for (const node of nodes) {
      if (node.type === 'single') {
        const t = this.tabMap.get(node.tabId);
        if (t) result.push(t);
      } else if (node.type === 'split-pair') {
        const left = this.tabMap.get(node.leftTabId);
        const right = this.tabMap.get(node.rightTabId);
        if (left) result.push(left);
        if (right) result.push(right);
      } else if (node.type === 'group') {
        result.push(...this.#flattenNodes(node.children));
      }
    }
    return result;
  }

  // Ищет родительский массив и индекс узла, содержащего tabId (рекурсивно).
  #findTabParent(tabId: string, nodes: SidebarNode[] = this.nodes): { parent: SidebarNode[]; idx: number } | null {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.type === 'single' && node.tabId === tabId)
        return { parent: nodes, idx: i };
      if (node.type === 'split-pair' && (node.leftTabId === tabId || node.rightTabId === tabId))
        return { parent: nodes, idx: i };
      if (node.type === 'group') {
        const found = this.#findTabParent(tabId, node.children);
        if (found) return found;
      }
    }
    return null;
  }

  // Ищет GroupNode по id (рекурсивно).
  #findGroupById(groupId: string, nodes: SidebarNode[] = this.nodes): GroupNode | null {
    for (const node of nodes) {
      if (node.type === 'group') {
        if (node.id === groupId) return node;
        const found = this.#findGroupById(groupId, node.children);
        if (found) return found;
      }
    }
    return null;
  }

  // Возвращает родительский массив для группы (или null если группа на верхнем уровне).
  #findGroupParent(groupId: string, nodes: SidebarNode[] = this.nodes): SidebarNode[] | null {
    for (const node of nodes) {
      if (node.type === 'group') {
        if (node.id === groupId) return nodes;
        const found = this.#findGroupParent(groupId, node.children);
        if (found) return found;
      }
    }
    return null;
  }

  // URL вкладки: из sleeping-метаданных или из живого WebContents.
  #tabUrl(tab: ManagedTab): string {
    if (tab.sleeping) return tab.sleeping.url;
    if (this.isHttpView(tab.view)) return tab.view.webContents.getURL();
    return '';
  }

  // Заменяет SplitPairNode двумя SingleNode — рекурсивный поиск (пара может быть в группе).
  #dissolveSplitPair(leftId: string, rightId: string): void {
    this.#dissolveSplitPairIn(leftId, rightId, this.nodes);
  }

  #dissolveSplitPairIn(leftId: string, rightId: string, nodes: SidebarNode[]): boolean {
    const idx = nodes.findIndex(
      (n) => n.type === 'split-pair' && n.leftTabId === leftId && n.rightTabId === rightId,
    );
    if (idx !== -1) {
      nodes.splice(idx, 1,
        { type: 'single', tabId: leftId },
        { type: 'single', tabId: rightId },
      );
      return true;
    }
    for (const node of nodes) {
      if (node.type === 'group') {
        if (this.#dissolveSplitPairIn(leftId, rightId, node.children)) return true;
      }
    }
    return false;
  }

  // Вычисляет SavedActiveRef (v4 формат: 'url' вместо 'normal'/'split').
  // URL однозначно идентифицирует активную вкладку в подавляющем большинстве случаев.
  #computeActiveRef(): SavedActiveRef {
    if (this.activeId === HUB_ID) return { type: 'hub' };

    const pinnedIdx = this.pinnedTabs.findIndex((t) => t.id === this.activeId);
    if (pinnedIdx !== -1) return { type: 'pinned', index: pinnedIdx };

    const tab = this.tabMap.get(this.activeId);
    const url = tab ? this.#tabUrl(tab) : '';
    if (/^https?:\/\//i.test(url)) return { type: 'url', url };
    return { type: 'hub' }; // фоллбэк: about:blank или без реального URL
  }

  // Текущее дерево узлов для SYNC_CHANGED (шлём как есть из this.nodes).
  sidebarNodesSnapshot(): SidebarNode[] {
    // DBG: проверяем инвариант split-pair в момент сборки nodes-снимка.
    this.#debugCheckSplitInvariant('sidebarNodesSnapshot');
    return this.nodes;
  }

  // Структурированный снимок для сериализации (рекурсивный — поддерживает группы).
  // Возвращает null если нарушен инвариант — сейв пропускается.
  getSessionSnapshot(): SessionSnapshot | null {
    const isReal = (url: string) => /^https?:\/\//i.test(url);

    const pinnedTabs: { url: string }[] = [];
    for (const t of this.pinnedTabs) {
      const url = this.#tabUrl(t);
      if (isReal(url)) pinnedTabs.push({ url });
    }

    const nodes = this.#serializeNodes(this.nodes, isReal);

    // Инвариант: число сериализованных вкладок == число вкладок tabMap с реальным URL.
    const expectedCount = [...this.tabMap.values()]
      .filter((t) => isReal(this.#tabUrl(t))).length;
    const actualCount = pinnedTabs.length + this.#countSavedTabs(nodes);

    if (actualCount !== expectedCount) {
      console.error(
        `[TabManager] инвариант сессии нарушен: ожидали ${expectedCount}, сериализовали ${actualCount}. Сохранение пропущено.`,
      );
      return null;
    }

    return { pinnedTabs, nodes, activeRef: this.#computeActiveRef() };
  }

  // Рекурсивная сериализация узлов с деградацией split-pair при отсутствии реальных URL.
  #serializeNodes(nodes: SidebarNode[], isReal: (url: string) => boolean): SavedNode[] {
    const result: SavedNode[] = [];
    for (const node of nodes) {
      if (node.type === 'single') {
        const tab = this.tabMap.get(node.tabId);
        if (!tab) continue;
        const url = this.#tabUrl(tab);
        if (isReal(url)) result.push({ type: 'single', url });
      } else if (node.type === 'split-pair') {
        const leftTab  = this.tabMap.get(node.leftTabId);
        const rightTab = this.tabMap.get(node.rightTabId);
        const leftUrl  = leftTab  ? this.#tabUrl(leftTab)  : '';
        const rightUrl = rightTab ? this.#tabUrl(rightTab) : '';
        if (isReal(leftUrl) && isReal(rightUrl)) {
          const ratio = (this.splitState?.leftId === node.leftTabId)
            ? this.splitState.splitRatio : node.ratio;
          result.push({ type: 'split-pair', leftUrl, rightUrl, ratio });
        } else if (isReal(leftUrl)) {
          result.push({ type: 'single', url: leftUrl });
        } else if (isReal(rightUrl)) {
          result.push({ type: 'single', url: rightUrl });
        }
      } else if (node.type === 'group') {
        const children = this.#serializeNodes(node.children, isReal);
        if (children.length > 0) {
          result.push({
            type: 'group', id: node.id, label: node.label,
            color: node.color, collapsed: node.collapsed, children,
          });
        }
      }
    }
    return result;
  }

  // Рекурсивный подсчёт вкладок в сериализованном дереве.
  #countSavedTabs(nodes: SavedNode[]): number {
    let count = 0;
    for (const n of nodes) {
      if (n.type === 'single')     count++;
      else if (n.type === 'split-pair') count += 2;
      else if (n.type === 'group') count += this.#countSavedTabs(n.children);
    }
    return count;
  }

  // Восстанавливает дерево узлов из сохранённой сессии.
  // urlToIds: URL → очередь tabId (поддерживает дубликаты URL).
  // Вызывается после создания всех вкладок через createTab, ДО activate().
  rebuildNodeTree(savedNodes: SavedNode[], urlToIds: Map<string, string[]>): void {
    this.nodes = [];
    this.splitState = null;
    this.#buildNodesFromSaved(savedNodes, urlToIds, this.nodes);
    this.#detectSplitState(this.nodes);
  }

  #buildNodesFromSaved(
    savedNodes: SavedNode[],
    urlToIds: Map<string, string[]>,
    target: SidebarNode[],
  ): void {
    for (const saved of savedNodes) {
      if (saved.type === 'single') {
        const id = urlToIds.get(saved.url)?.shift();
        if (id) target.push({ type: 'single', tabId: id });
      } else if (saved.type === 'split-pair') {
        const leftId  = urlToIds.get(saved.leftUrl)?.shift();
        const rightId = urlToIds.get(saved.rightUrl)?.shift();
        if (leftId && rightId) {
          const ratio = Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, saved.ratio));
          target.push({ type: 'split-pair', leftTabId: leftId, rightTabId: rightId, ratio });
        }
      } else if (saved.type === 'group') {
        const children: SidebarNode[] = [];
        this.#buildNodesFromSaved(saved.children, urlToIds, children);
        target.push({
          type: 'group', id: saved.id, label: saved.label,
          color: saved.color, collapsed: saved.collapsed, children,
        });
      }
    }
  }

  // DBG: проверяет, что каждый SplitPairNode в дереве ссылается на существующие tabMap-записи.
  #debugCheckSplitInvariant(label: string, nodes: SidebarNode[] = this.nodes): void {
    for (const node of nodes) {
      if (node.type === 'split-pair') {
        const hasLeft  = this.tabMap.has(node.leftTabId);
        const hasRight = this.tabMap.has(node.rightTabId);
        if (!hasLeft || !hasRight) {
          console.error(
            `[TabMgr][${label}] SPLIT INVAR FAIL: leftTabId=${node.leftTabId}(in tabMap:${hasLeft}) rightTabId=${node.rightTabId}(in tabMap:${hasRight})`,
            `| splitState=${JSON.stringify(this.splitState)}`,
            `| activeId=${this.activeId}`,
            `| tabMap.size=${this.tabMap.size}`,
            `| nodes.length=${this.nodes.length}`,
          );
        }
      } else if (node.type === 'group') {
        this.#debugCheckSplitInvariant(label, node.children);
      }
    }
  }

  // Удаляет пустые GroupNode из дерева (рекурсивно).
  #pruneEmptyGroups(nodes: SidebarNode[]): void {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.type === 'group') {
        this.#pruneEmptyGroups(node.children);
        if (node.children.length === 0) nodes.splice(i, 1);
      }
    }
  }

  // Проходит по nodes и устанавливает splitState для первой найденной пары.
  #detectSplitState(nodes: SidebarNode[]): void {
    for (const node of nodes) {
      if (node.type === 'split-pair') {
        this.splitState = {
          leftId: node.leftTabId, rightId: node.rightTabId,
          activePanel: 'left', splitRatio: node.ratio,
        };
        return;
      }
      if (node.type === 'group') {
        this.#detectSplitState(node.children);
        if (this.splitState) return;
      }
    }
  }

  getActiveId() { return this.activeId; }

  // ── Создание новой вкладки с реальной страницей ──
  // background=true: вкладка создаётся в фоне, без переключения (средний клик по ссылке).
  createTab(rawUrl?: string, background = false): string {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        // Жёсткая изоляция: страница не имеет доступа к Node.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const tab: ManagedTab = { id, view, sleeping: null, lastActiveAt: Date.now() };
    this.tabMap.set(id, tab);
    this.nodes.push({ type: 'single', tabId: id });
    this.wirePageEvents(id, view);

    const target = this.resolveInput(rawUrl ?? 'about:blank');
    if (target !== 'about:blank') view.webContents.loadURL(target);

    if (background) {
      this.onChange(); // показываем новую вкладку в сайдбаре без переключения
    } else {
      this.activate(id);
    }
    return id;
  }

  // Создаёт закреплённую вкладку — используется только при восстановлении сессии.
  createPinnedTab(rawUrl: string): string {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const tab: ManagedTab = { id, view, sleeping: null, lastActiveAt: Date.now() };
    this.tabMap.set(id, tab);
    this.pinnedTabs.push(tab);
    this.wirePageEvents(id, view);

    const target = this.resolveInput(rawUrl);
    if (target !== 'about:blank') view.webContents.loadURL(target);

    this.onChange();
    return id;
  }

  // Закрепить / открепить существующую вкладку.
  togglePin(id: string): void {
    if (id === HUB_ID || !this.tabMap.has(id)) return;
    this.clearOrganizeSnapshot();
    const pinnedIdx = this.pinnedTabs.findIndex((t) => t.id === id);
    if (pinnedIdx !== -1) {
      // Открепить: убрать из pinnedTabs, добавить SingleNode в конец nodes.
      const [tab] = this.pinnedTabs.splice(pinnedIdx, 1);
      // Если вкладка была в split — снимаем split при откреплении (split не поддерживает закреплённые).
      if (this.splitState && (id === this.splitState.leftId || id === this.splitState.rightId)) {
        this.exitSplit(id);
      }
      this.nodes.push({ type: 'single', tabId: tab.id });
    } else {
      // Закрепить: если вкладка в split — сначала выходим (другая остаётся).
      if (this.splitState && (id === this.splitState.leftId || id === this.splitState.rightId)) {
        const { leftId, rightId } = this.splitState;
        const otherId = id === leftId ? rightId : leftId;
        const currentlyInSplit = this.activeId === leftId || this.activeId === rightId;
        if (currentlyInSplit) {
          this.exitSplit(otherId); // разворачивает пару в два SingleNode
        } else {
          const pairIdx = this.nodes.findIndex(
            (n) => n.type === 'split-pair' && n.leftTabId === leftId && n.rightTabId === rightId,
          );
          if (pairIdx !== -1) this.nodes.splice(pairIdx, 1, { type: 'single', tabId: otherId });
          this.splitState = null;
        }
      }
      // Теперь id гарантированно в SingleNode — убираем из nodes (рекурсивно, если в группе).
      const found = this.#findTabParent(id);
      if (found && found.parent[found.idx].type === 'single') {
        found.parent.splice(found.idx, 1);
        this.#pruneEmptyGroups(this.nodes);
      }
      const tab = this.tabMap.get(id)!;
      this.pinnedTabs.push(tab);
    }
    this.onChange();
  }

  isTabPinned(id: string): boolean {
    return this.pinnedTabs.some((t) => t.id === id);
  }

  // ── Усыпление: выгружаем WebContentsView, сохраняем метаданные ──
  private sleepTab(id: string): void {
    const tab = this.tabMap.get(id);
    if (!tab || !this.isHttpView(tab.view) || tab.sleeping) return;
    const wc = tab.view.webContents;
    const url = wc.getURL();
    // Не усыпляем вкладки без реального URL (about:blank и т.п.)
    if (!/^https?:\/\//i.test(url)) return;
    tab.sleeping = {
      url,
      title: wc.getTitle() || url,
      faviconUrl: (wc as unknown as { _oblakoFavicon?: string })._oblakoFavicon ?? null,
    };
    try { this.win.contentView.removeChildView(tab.view); } catch { /* noop */ }
    try { (wc as unknown as { close?: () => void }).close?.(); } catch { /* noop */ }
    tab.view = null;
    this.errors.delete(id);
    this.onChange();
  }

  // ── Пробуждение: пересоздаём WebContentsView и начинаем загрузку ──
  // Синхронный: создаёт вьюху и стартует загрузку. Страница появится когда загрузится (did-navigate).
  private wakeTab(id: string): void {
    const tab = this.tabMap.get(id);
    if (!tab?.sleeping) return;
    const { url } = tab.sleeping;
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    tab.sleeping = null;
    tab.view = view;
    tab.lastActiveAt = Date.now();
    this.errors.delete(id);
    this.wirePageEvents(id, view);
    view.webContents.loadURL(url);
  }

  // ── Таймер засыпания: периодически проверяет кандидатов ──
  private startSleepTimer(): void {
    setInterval(async () => {
      const now = Date.now();
      const currentlyInSplit = !!this.splitState &&
        (this.activeId === this.splitState.leftId || this.activeId === this.splitState.rightId);

      // Набор защищённых id: активная вкладка + обе панели активного split.
      const protectedIds = new Set<string>([this.activeId]);
      if (currentlyInSplit && this.splitState) {
        protectedIds.add(this.splitState.leftId);
        protectedIds.add(this.splitState.rightId);
      }

      for (const tab of this.tabMap.values()) {
        // Пропускаем: уже спящие, защищённые вкладки, не-http вьюхи
        if (tab.sleeping || protectedIds.has(tab.id)) continue;
        if (!this.isHttpView(tab.view)) continue;

        // Таймаут ещё не истёк — не трогаем (и не гоняем дорогой JS-запрос зря)
        const timeout = this.isTabPinned(tab.id) ? SLEEP_TIMEOUT_PINNED : SLEEP_TIMEOUT_NORMAL;
        if (now - tab.lastActiveAt < timeout) continue;

        const wc = tab.view.webContents;

        // Играет медиа — пропускаем
        if (wc.isCurrentlyAudible()) continue;

        // Async: проверяем незаполненные формы — только после прохождения всех sync-фильтров
        let hasForms = false;
        try {
          hasForms = await wc.executeJavaScript(HAS_FILLED_FORMS_SCRIPT, true);
        } catch {
          continue; // WebContents недоступен — пропускаем
        }
        if (hasForms) continue;

        // Перепроверяем после await: вкладка могла стать активной пока шёл JS-запрос
        if (protectedIds.has(tab.id) || tab.sleeping || !this.isHttpView(tab.view)) continue;
        if (tab.id === this.activeId) continue;
        if (this.splitState) {
          const inActiveSplit = this.activeId === this.splitState.leftId ||
                                this.activeId === this.splitState.rightId;
          if (inActiveSplit &&
              (tab.id === this.splitState.leftId || tab.id === this.splitState.rightId)) continue;
        }

        this.sleepTab(tab.id);
      }
    }, SLEEP_CHECK_INTERVAL);
  }

  private wirePageEvents(id: string, view: WebContentsView) {
    const wc = view.webContents;
    const notify = () => this.onChange();

    // Когда WebContentsView получает OS-фокус от клика мышью — проверяем, не нужно ли
    // активировать панель split. DOM-дивы в renderer не получают клик, перекрытый вьюхой.
    wc.on('focus', () => {
      if (this.splitState &&
          (id === this.splitState.leftId || id === this.splitState.rightId) &&
          this.activeId !== id) {
        const side = id === this.splitState.leftId ? 'left' : 'right';
        this.focusSplitPanel(side);
      }
    });

    // Таймер первой контентной вкладки: вызывается ровно один раз.
    if (!this.firstTabLoaded) {
      wc.once('did-finish-load', () => {
        if (this.firstTabLoaded) return;
        this.firstTabLoaded = true;
        this.onFirstTabLoadCb?.();
      });
    }

    // Новая попытка загрузки — очищаем предыдущую ошибку сразу.
    wc.on('did-start-loading', () => { this.errors.delete(id); notify(); });
    wc.on('did-stop-loading', notify);
    // Успешный коммит навигации — показываем вьюху + сбрасываем поиск.
    // Не на did-start-loading: вьюха не должна мигать при retry, который снова упадёт.
    wc.on('did-navigate', () => {
      const isActivePanel = this.activeId === id;
      const isInSplit = !!this.splitState
        && (id === this.splitState.leftId || id === this.splitState.rightId);
      if (isActivePanel) {
        wc.stopFindInPage('clearSelection');
        this.lastQuery = '';
        this.onFindCloseCb();
      }
      // Навигация = активность; обновляем lastActiveAt для активных/split-вкладок.
      if (isActivePanel || isInSplit) {
        const tab = this.tabMap.get(id);
        if (tab) tab.lastActiveAt = Date.now();
      }
      // Показываем вьюху как для активной вкладки, так и для split-партнёра.
      if (isActivePanel || isInSplit) this.revealView(id);
      // Записываем визит: один URL = один UPSERT с инкрементом счётчика.
      this.onNavigateCb?.(wc.getURL(), wc.getTitle());
      notify();
    });
    wc.on('did-navigate-in-page', notify);
    wc.on('page-title-updated', (_e, title) => {
      // Обновляем только заголовок — без инкремента счётчика посещений.
      this.onTitleUpdateCb?.(wc.getURL(), title);
      notify();
    });

    wc.on('page-favicon-updated', (_e, favicons) => {
      (wc as unknown as { _oblakoFavicon?: string })._oblakoFavicon = favicons?.[0];
      notify();
    });

    // Результат findInPage — пробрасываем в renderer для обновления счётчика.
    wc.on('found-in-page', (_e, result) => {
      this.onFindResultCb({ activeMatch: result.activeMatchOrdinal, count: result.matches });
    });

    // Политика окон: target=_blank / window.open -> НОВАЯ ВКЛАДКА, не окно.
    // disposition='background-tab' = средний клик или Ctrl+клик → фон (стандарт браузеров).
    wc.setWindowOpenHandler(({ url, disposition }) => {
      this.createTab(url, disposition === 'background-tab');
      return { action: 'deny' };
    });

    // Ctrl+колесо → наш зум (preventDefault гасит нативный зум Chromium).
    // Chromium перехватывает Ctrl+scroll как gesture, поэтому страница не скроллится.
    wc.on('zoom-changed', (event, direction) => {
      event.preventDefault();
      this.adjustZoom(direction === 'in' ? ZOOM_STEP : -ZOOM_STEP);
    });

    // Ошибка загрузки основного фрейма (DNS, сеть, TLS…)
    // errorCode === -3 (ERR_ABORTED) — пользователь остановил загрузку; не ошибка.
    wc.on('did-fail-load', (_e, errorCode, _desc, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      const url = wc.getURL() || validatedURL;
      this.errors.set(id, { type: 'load', code: errorCode, url });
      const isInSplit = !!this.splitState
        && (id === this.splitState.leftId || id === this.splitState.rightId);
      if (this.activeId === id || isInSplit) this.hideView(id);
      notify();
    });

    // Краш рендер-процесса: вьюха мертва — прячем, показываем экран ошибки.
    wc.on('render-process-gone', () => {
      const url = wc.getURL();
      this.errors.set(id, { type: 'crash', code: 0, url });
      const isInSplit = !!this.splitState
        && (id === this.splitState.leftId || id === this.splitState.rightId);
      if (this.activeId === id || isInSplit) this.hideView(id);
      notify();
    });

    wc.on('context-menu', (_e, p) => {
      const items: MenuItemConstructorOptions[] = [];

      // ── Ссылка ──────────────────────────────────────────────────────────────
      if (p.linkURL) {
        items.push(
          { label: 'Открыть ссылку в новой вкладке', click: () => this.createTab(p.linkURL) },
          { label: 'Копировать адрес ссылки', click: () => clipboard.writeText(p.linkURL) },
        );
      }

      // ── Картинка ─────────────────────────────────────────────────────────────
      if (p.mediaType === 'image' && p.srcURL) {
        if (items.length) items.push({ type: 'separator' });
        items.push(
          { label: 'Копировать картинку', click: () => wc.copyImageAt(p.x, p.y) },
          { label: 'Сохранить картинку как…', click: () => wc.downloadURL(p.srcURL) },
          { label: 'Открыть картинку в новой вкладке', click: () => this.createTab(p.srcURL) },
        );
      }

      // ── Редактируемое поле ───────────────────────────────────────────────────
      // isEditable обрабатываем ДО selectionText: cut/copy/paste — главное для инпутов.
      if (p.isEditable) {
        if (items.length) items.push({ type: 'separator' });
        items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' });
        if (p.selectionText.trim()) {
          items.push({ type: 'separator' });
          items.push({
            label: `Поиск «${truncate(p.selectionText)}» в DuckDuckGo`,
            click: () => this.createTab(SEARCH_URL(p.selectionText)),
          });
        }
      } else if (p.selectionText.trim()) {
        // ── Выделенный текст (не в инпуте) ──────────────────────────────────
        if (items.length) items.push({ type: 'separator' });
        items.push(
          { role: 'copy' },
          {
            label: `Поиск «${truncate(p.selectionText)}» в DuckDuckGo`,
            click: () => this.createTab(SEARCH_URL(p.selectionText)),
          },
        );
        if (this.onAiActionCb) {
          // Общий диспетчер для всех AI-действий над выделением — только action меняется,
          // координаты/фоллбэк/лог одни и те же (см. onAiActionCb в TranslationService.ts).
          const dispatchAiAction = (action: AiAction) => {
            const text = p.selectionText;
            const tClick = performance.now();
            void (async () => {
              // Фоллбэк на координаты клика ПКМ, если запрос rect не удался/не дал результата
              // (напр. выделение снялось до клика по пункту меню — редкий race).
              let local: { x: number; y: number; width: number; height: number };
              let fellBack = false;
              try {
                const scriptResult = await wc.executeJavaScript(SELECTION_RECT_SCRIPT, true);
                if (scriptResult) { local = scriptResult; } else { local = { x: p.x, y: p.y, width: 0, height: 0 }; fellBack = true; }
              } catch {
                local = { x: p.x, y: p.y, width: 0, height: 0 };
                fellBack = true;
              }
              const viewBounds = view.getBounds();
              const rect: SelectionRect = {
                x: viewBounds.x + local.x,
                y: viewBounds.y + local.y,
                width: local.width,
                height: local.height,
              };
              console.log(`[popover] selrect: fellBack=${fellBack} local=${JSON.stringify(local)} viewBounds=${JSON.stringify(viewBounds)} computed=${JSON.stringify(rect)}`);
              console.log(`[perf] selection->request: ${(performance.now() - tClick).toFixed(0)}ms`);
              this.onAiActionCb!(action, text, rect, wc);
            })();
          };

          items.push({ label: 'Перевести', click: () => dispatchAiAction('translate') });
          items.push({ label: 'Пересказать проще', click: () => dispatchAiAction('simplify') });
          items.push({ label: 'Объяснить', click: () => dispatchAiAction('explain') });
          // «Краткая выжимка» — только для достаточно длинного выделения (см. SUMMARIZE_MIN_CHARS).
          if (p.selectionText.trim().length >= SUMMARIZE_MIN_CHARS) {
            items.push({ label: 'Краткая выжимка', click: () => dispatchAiAction('summarize') });
          }
        }
      }

      // ── Фоллбэк: просто страница (ни ссылки, ни картинки, ни выделения) ────
      if (!items.length) {
        items.push(
          { label: 'Назад',    enabled: wc.canGoBack(),     click: () => wc.goBack() },
          { label: 'Вперёд',   enabled: wc.canGoForward(),  click: () => wc.goForward() },
          { label: 'Обновить',                               click: () => wc.reload() },
        );
      }

      // Инспектор — всегда в конце; inspectElement подсвечивает элемент под курсором.
      items.push({ type: 'separator' });
      items.push({
        label: 'Просмотреть код',
        click: () => {
          if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' });
          wc.inspectElement(p.x, p.y);
        },
      });

      Menu.buildFromTemplate(items).popup({ window: this.win });
    });

    this.registerHotkeyHandler(wc);
  }

  // ── Активация: показываем нужную вьюху, прячем остальные ──
  activate(id: string) {
    // Хаб не в tabMap — обрабатываем отдельно.
    const tab = id === HUB_ID ? this.hubTab : this.tabMap.get(id);
    if (!tab) return;

    // Поповер перевода анкорится к прежней активной вкладке — при реальной смене (не при
    // повторном activate() того же id, напр. клик по уже активной вкладке в сайдбаре) его пора
    // закрыть. Раньше остального в функции — событие должно уйти сразу, а не в конце разбора.
    if (this.activeId !== id) this.onActiveTabChangedCb?.();

    // Пробуждаем вкладку, если она спит (до любой логики с view).
    if (tab.sleeping) this.wakeTab(id);

    // Останавливаем поиск на уходящей вкладке перед переключением.
    if (this.activeId !== id) {
      const prev = this.activeId === HUB_ID ? null : this.tabMap.get(this.activeId);
      if (prev && this.isHttpView(prev.view)) {
        prev.view.webContents.stopFindInPage('clearSelection');
        this.lastQuery = '';
      }
      this.findBarOpen = false; // FindBar уйдёт при смене activeId в renderer'е
    }

    if (this.splitState) {
      if (id === this.splitState.leftId || id === this.splitState.rightId) {
        // Возврат к split-вкладке: восстанавливаем обе панели, скрываем постороннее.
        const otherId = id === this.splitState.leftId ? this.splitState.rightId : this.splitState.leftId;
        const otherTab = this.tabMap.get(otherId);
        if (otherTab?.sleeping) this.wakeTab(otherId);

        this.splitState.activePanel = id === this.splitState.leftId ? 'left' : 'right';
        this.activeId = id;
        const activatedTab = this.tabMap.get(id);
        if (activatedTab) activatedTab.lastActiveAt = Date.now();

        for (const t of this.tabMap.values()) {
          if (!this.isHttpView(t.view)) continue;
          if (t.id !== this.splitState.leftId && t.id !== this.splitState.rightId) {
            t.view.setVisible(false);
          }
        }
        this.repositionViews();
        this.onChange();
        this.focusActiveView();
        return;
      }
      // Уход на стороннюю вкладку — прячем панели, НО splitState НЕ сбрасываем.
      for (const splitId of [this.splitState.leftId, this.splitState.rightId]) {
        const splitTab = this.tabMap.get(splitId);
        if (splitTab && this.isHttpView(splitTab.view)) splitTab.view.setVisible(false);
      }
    }

    this.activeId = id;
    tab.lastActiveAt = Date.now();

    for (const t of this.tabMap.values()) {
      if (!this.isHttpView(t.view)) continue;
      if (t.id === id) {
        if (!this.errors.has(id)) {
          const children = this.win.contentView.children;
          if (!children.includes(t.view)) this.win.contentView.addChildView(t.view);
          t.view.setVisible(true);
          this.applyBounds(t.view);
        } else {
          t.view.setVisible(false);
        }
      } else {
        t.view.setVisible(false);
      }
    }
    this.onChange();
    this.focusActiveView();
  }

  // После программного переключения вкладки явно передаём OS-фокус нужному view.
  // Без этого before-input-event замолкает: Windows освобождает фокус на BrowserWindow HWND,
  // не перекидывая его на дочерние view автоматически.
  private focusActiveView(): void {
    const tab = this.tabMap.get(this.activeId);
    if (tab && this.isHttpView(tab.view) && !this.errors.has(this.activeId)) {
      tab.view.webContents.focus();
    } else {
      this.onFocusChromeCb();
    }
  }

  closeTab(id: string) {
    if (id === HUB_ID) return;
    if (this.isTabPinned(id)) return;
    this.clearOrganizeSnapshot();

    // Закрытие вкладки, входящей в (возможно припаркованный) split.
    if (this.splitState && (id === this.splitState.leftId || id === this.splitState.rightId)) {
      const { leftId, rightId } = this.splitState;
      const otherId = id === leftId ? rightId : leftId;
      const currentlyInSplit = this.activeId === leftId || this.activeId === rightId;
      if (currentlyInSplit) {
        this.exitSplit(otherId);
      } else {
        // Парковый split: заменяем SplitPairNode одним SingleNode выжившей вкладки.
        // Пара может быть внутри группы — используем рекурсивный поиск.
        const pairParent = this.#findTabParent(leftId);
        if (pairParent) {
          const pairNode = pairParent.parent[pairParent.idx];
          if (pairNode.type === 'split-pair') {
            pairParent.parent.splice(pairParent.idx, 1, { type: 'single', tabId: otherId });
          }
        }
        this.splitState = null;
      }
    }

    const tab = this.tabMap.get(id);
    if (!tab) return;

    // Убираем из дерева узлов (рекурсивно — вкладка может быть в группе).
    const found = this.#findTabParent(id);
    if (found) {
      const node = found.parent[found.idx];
      if (node.type === 'single') {
        found.parent.splice(found.idx, 1);
        // Если группа опустела после удаления — расформировываем её.
        this.#pruneEmptyGroups(this.nodes);
      }
    }
    // DBG: логируем каждое удаление из tabMap со стеком — ищем, кто удаляет split-вкладку.
    console.warn('[TabMgr] tabMap.delete', id, new Error('stack').stack?.split('\n').slice(1, 5).join(' | '));
    this.tabMap.delete(id);
    this.errors.delete(id);

    if (this.isHttpView(tab.view)) {
      const url = tab.view.webContents.getURL();
      if (/^https?:\/\//i.test(url)) {
        this.closedTabs.push(url);
        if (this.closedTabs.length > CLOSED_STACK_MAX) this.closedTabs.shift();
      }
      // Поповер перевода анкорится к WebContents конкретной вкладки (см. TranslatePopoverManager.ts) —
      // если закрывается именно она, поповер сравнит ссылку и закроется сам. До removeChildView/close,
      // чтобы сравнение ссылки точно застало ещё живой объект.
      this.onTabClosedCb?.(tab.view.webContents);
      try { this.win.contentView.removeChildView(tab.view); } catch { /* noop */ }
      (tab.view.webContents as unknown as { close?: () => void }).close?.();
    } else if (tab.sleeping) {
      const url = tab.sleeping.url;
      if (/^https?:\/\//i.test(url)) {
        this.closedTabs.push(url);
        if (this.closedTabs.length > CLOSED_STACK_MAX) this.closedTabs.shift();
      }
    }

    // Если закрыли активную — переключаемся на соседнюю по визуальному порядку или хаб.
    if (this.activeId === id) {
      const ordered = this.tabsInVisualOrder(true);
      const idx = ordered.findIndex((t) => t.id === id);
      const next = ordered[idx + 1] ?? ordered[idx - 1] ?? this.hubTab;
      this.activate(next.id);
    } else {
      this.onChange();
    }
  }

  reopenLastClosedTab(): void {
    const url = this.closedTabs.pop();
    if (url) this.createTab(url);
  }

  // ── Переупорядочивание вкладок (drag-and-drop) ──────────────────────────────
  // orderedIds — новый порядок от renderer. Перед применением сверяем множества:
  // если есть лишние/дублирующиеся/отсутствующие id — берём пересечение и
  // дописываем пропущенные в конец. Слепому доверию списку нет места: рассинхрон
  // UI↔main мог возникнуть при быстрых операциях (закрытие во время drag).
  reorderTabs(section: 'normal' | 'pinned', orderedIds: string[]): void {
    this.clearOrganizeSnapshot();
    if (section === 'pinned') {
      const currentMap = new Map(this.pinnedTabs.map((t, i) => [t.id, i]));
      const valid = orderedIds.filter((id) => currentMap.has(id));
      // Дедупликация: берём только первое вхождение каждого id.
      const seen = new Set<string>();
      const deduped = valid.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
      // Дописываем вкладки, отсутствующие в присланном списке.
      const missing = this.pinnedTabs.filter((t) => !seen.has(t.id));
      const final = [...deduped, ...missing.map((t) => t.id)];
      const byId = new Map(this.pinnedTabs.map((t) => [t.id, t]));
      this.pinnedTabs = final.map((id) => byId.get(id)!);
    } else {
      // Строим карту itemId → узел (только верхний уровень; внутри групп — отдельный reorder).
      // SingleNode: itemId=tabId. SplitPairNode: itemId=leftTabId. GroupNode: itemId='group:${id}'.
      const itemToNode = new Map<string, SidebarNode>();
      for (const node of this.nodes) {
        if (node.type === 'single') {
          itemToNode.set(node.tabId, node);
        } else if (node.type === 'split-pair') {
          itemToNode.set(node.leftTabId, node);
        } else if (node.type === 'group') {
          itemToNode.set(`group:${node.id}`, node);
        }
      }

      const allItemIds = [...itemToNode.keys()];
      const currentSet = new Set(allItemIds);
      const valid = orderedIds.filter((id) => currentSet.has(id));
      const seen = new Set<string>();
      const deduped = valid.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
      const missing = allItemIds.filter((id) => !seen.has(id));
      const final = [...deduped, ...missing];

      // Реконструируем nodes из итогового порядка item-ID.
      this.nodes = final.map((id) => itemToNode.get(id)!);
    }
    this.onChange(); // → TABS_CHANGED немедленно + scheduleSave (debounce 1.5s)
  }

  // Атомарный перенос вкладки между секциями (drag через границу).
  // Одна транзакция: убрать из A + добавить в B. При нарушении инварианта — откат без onChange.
  moveTabSection(tabId: string, targetSection: 'pinned' | 'normal', targetIndex: number): void {
    if (tabId === HUB_ID || !this.tabMap.has(tabId)) return;
    this.clearOrganizeSnapshot();

    const isPinned = this.pinnedTabs.some((t) => t.id === tabId);
    const isNormal = this.nodes.some((n): n is SingleNode => n.type === 'single' && n.tabId === tabId);

    // Снимок для отката
    const prevPinned = [...this.pinnedTabs];
    const prevNodes  = [...this.nodes];

    if (targetSection === 'pinned' && !isPinned && isNormal) {
      // Обычная → закреплённые
      const nodeIdx = this.nodes.findIndex(
        (n): n is SingleNode => n.type === 'single' && n.tabId === tabId,
      );
      this.nodes.splice(nodeIdx, 1);
      const tab = this.tabMap.get(tabId)!;
      const safeIdx = Math.max(0, Math.min(targetIndex, this.pinnedTabs.length));
      this.pinnedTabs.splice(safeIdx, 0, tab);

    } else if (targetSection === 'normal' && isPinned && !isNormal) {
      // Закреплённая → обычные
      const pinnedIdx = this.pinnedTabs.findIndex((t) => t.id === tabId);
      const [tab] = this.pinnedTabs.splice(pinnedIdx, 1);

      // Если вкладка в split — снимаем (не должно быть для закреплённых, но защитно)
      if (this.splitState && (tabId === this.splitState.leftId || tabId === this.splitState.rightId)) {
        this.exitSplit(tabId);
      }

      // targetIndex — item-индекс (SplitPairNode считается единицей), граница = nodes.length.
      const safeIdx = Math.max(0, Math.min(targetIndex, this.nodes.length));
      this.nodes.splice(safeIdx, 0, { type: 'single', tabId: tab.id });

    } else {
      return; // уже в нужной секции — нет операции
    }

    // Валидация инварианта: вкладка ровно в одной структуре, состав tabMap не изменился
    const inPinnedAfter = this.pinnedTabs.some((t) => t.id === tabId);
    const inNodesAfter  = this.nodes.some((n): n is SingleNode => n.type === 'single' && n.tabId === tabId);

    if (inPinnedAfter === inNodesAfter) {
      // Нарушение (обе или ни одна) → откат
      this.pinnedTabs = prevPinned;
      this.nodes      = prevNodes;
      console.error('[TabManager] moveTabSection: нарушение инварианта, откат');
      return;
    }

    const pinnedSet = new Set(this.pinnedTabs.map((t) => t.id));
    // #flattenNodes рекурсивно обходит группы — без этого дети GroupNode не попадали в nodeSet,
    // и инвариант всегда нарушался при наличии хотя бы одной группы → откат вместо переноса.
    const nodeSet   = new Set(this.#flattenNodes().map((t) => t.id));
    const mapIds = [...this.tabMap.keys()];
    const setsValid = mapIds.length === pinnedSet.size + nodeSet.size
      && mapIds.every((id) => pinnedSet.has(id) !== nodeSet.has(id));

    if (!setsValid) {
      this.pinnedTabs = prevPinned;
      this.nodes      = prevNodes;
      console.error('[TabManager] moveTabSection: несоответствие состава, откат');
      return;
    }

    this.onChange();
  }

  // ── Группы вкладок ───────────────────────────────────────────────────────────

  // Оборачивает SingleNode в новую группу на том же уровне.
  createGroup(tabId: string): void {
    const found = this.#findTabParent(tabId);
    if (!found) return;
    this.clearOrganizeSnapshot();
    const node = found.parent[found.idx];
    if (node.type !== 'single') return; // split-pair в группу не заворачиваем
    const group: GroupNode = {
      type: 'group', id: randomUUID(),
      label: 'Новая группа', color: null, collapsed: false, children: [node],
    };
    found.parent.splice(found.idx, 1, group);
    this.onChange();
  }

  // Перемещает SingleNode в конец children указанной группы.
  addTabToGroup(groupId: string, tabId: string): void {
    const group = this.#findGroupById(groupId);
    if (!group) return;
    this.clearOrganizeSnapshot();
    const found = this.#findTabParent(tabId);
    if (!found) return;
    const node = found.parent[found.idx];
    if (node.type !== 'single') return;
    found.parent.splice(found.idx, 1);
    group.children.push(node);
    this.onChange();
  }

  // Вынимает вкладку из группы; помещает SingleNode после группы.
  // Если группа опустела — расформировывает её.
  removeTabFromGroup(groupId: string, tabId: string): void {
    const group = this.#findGroupById(groupId);
    if (!group) return;
    this.clearOrganizeSnapshot();
    const childIdx = group.children.findIndex(
      (c) => c.type === 'single' && (c as SingleNode).tabId === tabId,
    );
    if (childIdx === -1) return;
    const [node] = group.children.splice(childIdx, 1);
    if (group.children.length === 0) {
      // Пустая группа — расформировываем.
      this.#disbandGroupIn(groupId, this.nodes);
      this.nodes.push(node);
    } else {
      // Вставляем после группы в её родительском массиве.
      const groupParent = this.#findGroupParent(groupId) ?? this.nodes;
      const gi = groupParent.findIndex((n) => n.type === 'group' && (n as GroupNode).id === groupId);
      groupParent.splice(gi + 1, 0, node);
    }
    this.onChange();
  }

  renameGroup(groupId: string, label: string): void {
    const group = this.#findGroupById(groupId);
    if (!group) return;
    group.label = label.trim() || 'Группа';
    this.onChange();
  }

  setGroupColor(groupId: string, color: string | null): void {
    const group = this.#findGroupById(groupId);
    if (!group) return;
    group.color = color;
    this.onChange();
  }

  toggleGroupCollapse(groupId: string): void {
    const group = this.#findGroupById(groupId);
    if (!group) return;
    group.collapsed = !group.collapsed;
    this.onChange();
  }

  // Расформировывает группу: дети выносятся на место группы в родительском массиве.
  disbandGroup(groupId: string): void {
    this.clearOrganizeSnapshot();
    this.#disbandGroupIn(groupId, this.nodes);
    this.onChange();
  }

  #disbandGroupIn(groupId: string, nodes: SidebarNode[]): boolean {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.type === 'group') {
        if (node.id === groupId) {
          nodes.splice(i, 1, ...node.children);
          return true;
        }
        if (this.#disbandGroupIn(groupId, node.children)) return true;
      }
    }
    return false;
  }

  // Перестановка детей внутри группы (аналог reorderTabs для group.children).
  reorderGroupChildren(groupId: string, orderedIds: string[]): void {
    const group = this.#findGroupById(groupId);
    if (!group) return;
    this.clearOrganizeSnapshot();
    const childMap = new Map<string, SidebarNode>();
    for (const child of group.children) {
      if (child.type === 'single')     childMap.set(child.tabId, child);
      else if (child.type === 'split-pair') childMap.set(child.leftTabId, child);
      else if (child.type === 'group') childMap.set(`group:${child.id}`, child);
    }
    const allIds = [...childMap.keys()];
    const seen = new Set<string>();
    const deduped = orderedIds.filter((id) => childMap.has(id) && (seen.has(id) ? false : (seen.add(id), true)));
    const missing = allIds.filter((id) => !seen.has(id));
    group.children = [...deduped, ...missing].map((id) => childMap.get(id)!);
    this.onChange();
  }

  // Возвращает true если вкладка находится в какой-либо группе.
  isTabInGroup(tabId: string): boolean {
    const found = this.#findTabParent(tabId);
    return !!found && found.parent !== this.nodes;
  }

  // Возвращает groupId если вкладка непосредственно в группе, иначе null.
  // Phase 3: группы не вложены, достаточно одного уровня.
  getTabGroupId(tabId: string): string | null {
    for (const node of this.nodes) {
      if (node.type !== 'group') continue;
      for (const child of node.children) {
        if (child.type === 'single' && child.tabId === tabId) return node.id;
        if (child.type === 'split-pair' &&
            (child.leftTabId === tabId || child.rightTabId === tabId)) return node.id;
      }
    }
    return null;
  }

  // Перезагружает все живые (не спящие) вкладки. Если domain задан — только с этим hostname
  // (и его поддоменами). Используется адблоком после смены настроек.
  reloadTabsForDomain(domain?: string): void {
    for (const tab of this.tabMap.values()) {
      if (!this.isHttpView(tab.view) || tab.sleeping) continue;
      const url = tab.view.webContents.getURL();
      if (!url) continue;
      if (domain) {
        let hostname: string;
        try { hostname = new URL(url).hostname.toLowerCase(); } catch { continue; }
        if (hostname !== domain && !hostname.endsWith('.' + domain)) continue;
      }
      tab.view.webContents.reload();
    }
  }

  // ── Split View ────────────────────────────────────────────────────────────

  // Войти в split: текущая активная вкладка → левая панель, rightId → правая.
  // Только обычные (не закреплённые, не хаб) вкладки могут участвовать.
  enterSplit(rightId: string): void {
    // Уже в split — блокируем: максимум 2 панели.
    if (this.splitState) return;
    this.clearOrganizeSnapshot();
    const rightTab = this.tabMap.get(rightId);
    if (!rightTab || (!this.isHttpView(rightTab.view) && !rightTab.sleeping) || this.isTabPinned(rightId)) return;

    const leftId = this.activeId;
    if (leftId === rightId) return;

    const leftTab = this.tabMap.get(leftId);
    if (!leftTab || (!this.isHttpView(leftTab.view) && !leftTab.sleeping) || this.isTabPinned(leftId)) return;

    // Обе вкладки должны быть в одном родительском массиве (верхний уровень или одна группа).
    const leftParent  = this.#findTabParent(leftId);
    const rightParent = this.#findTabParent(rightId);
    if (!leftParent || !rightParent || leftParent.parent !== rightParent.parent) return;

    if (rightTab.sleeping) this.wakeTab(rightId);

    const activeWc = this.getActiveWebContents();
    if (activeWc) { activeWc.stopFindInPage('clearSelection'); this.lastQuery = ''; }
    this.findBarOpen = false;
    this.onFindCloseCb();

    for (const t of this.tabMap.values()) {
      if (!this.isHttpView(t.view)) continue;
      if (t.id !== leftId && t.id !== rightId) t.view.setVisible(false);
    }

    // Заменяем два SingleNode одним SplitPairNode в родительском массиве.
    const pair: SplitPairNode = { type: 'split-pair', leftTabId: leftId, rightTabId: rightId, ratio: 0.5 };
    const targetNodes = leftParent.parent;
    let pairInserted = false;
    const newNodes: SidebarNode[] = [];
    for (const node of targetNodes) {
      if (node.type === 'single' && (node.tabId === leftId || node.tabId === rightId)) {
        if (!pairInserted) { newNodes.push(pair); pairInserted = true; }
      } else {
        newNodes.push(node);
      }
    }
    if (!pairInserted) newNodes.push(pair);
    targetNodes.splice(0, targetNodes.length, ...newNodes);

    this.splitState = { leftId, rightId, activePanel: 'left', splitRatio: 0.5 };

    for (const splitId of [leftId, rightId]) {
      const splitTab = this.tabMap.get(splitId);
      if (!splitTab || !this.isHttpView(splitTab.view)) continue;
      const children = this.win.contentView.children;
      if (!children.includes(splitTab.view)) this.win.contentView.addChildView(splitTab.view);
    }

    this.repositionViews();
    this.onChange();
    this.focusActiveView();
  }

  // Выйти из split, оставив keepId активной вкладкой (по умолчанию — активная панель).
  // Явный выход: splitState = null насовсем. Отличается от «ухода» (activate другой вкладки),
  // который сохраняет splitState для последующего восстановления.
  exitSplit(keepId?: string): void {
    if (!this.splitState) return;
    this.clearOrganizeSnapshot();
    const { leftId, rightId, activePanel } = this.splitState;

    const currentlyInSplit = this.activeId === leftId || this.activeId === rightId;

    // Всегда разворачиваем SplitPairNode → два SingleNode (до сброса splitState).
    this.#dissolveSplitPair(leftId, rightId);

    // Явный выход при припаркованном split (кнопка в сайдбаре, пока смотрим другую вкладку):
    // просто снимаем splitState и остаёмся там, где были. Обе вкладки и так уже скрыты.
    if (!currentlyInSplit && keepId === undefined) {
      this.splitState = null;
      this.onChange();
      return;
    }

    const stayId = keepId ?? (activePanel === 'left' ? leftId : rightId);
    const hideId = stayId === leftId ? rightId : leftId;

    this.splitState = null;

    const hideTab = this.tabMap.get(hideId);
    if (hideTab && this.isHttpView(hideTab.view)) {
      hideTab.view.webContents.stopFindInPage('clearSelection');
      hideTab.view.setVisible(false);
    }

    this.activeId = stayId;
    const stayTab = this.tabMap.get(stayId);
    if (stayTab && this.isHttpView(stayTab.view) && !this.errors.has(stayId)) {
      const children = this.win.contentView.children;
      if (!children.includes(stayTab.view)) this.win.contentView.addChildView(stayTab.view);
      stayTab.view.setVisible(true);
      this.applyBounds(stayTab.view);
    }

    this.onChange();
    this.focusActiveView();
  }

  // Установить соотношение панелей split (вызывается при drag разделителя).
  setSplitRatio(ratio: number): void {
    if (!this.splitState) return;
    const clamped = Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, ratio));
    this.splitState.splitRatio = clamped;
    // Синхронизируем с SplitPairNode, чтобы следующий сейв взял актуальный ratio.
    const { leftId, rightId } = this.splitState;
    const pair = this.nodes.find(
      (n): n is SplitPairNode => n.type === 'split-pair' && n.leftTabId === leftId && n.rightTabId === rightId,
    );
    if (pair) pair.ratio = clamped;
    this.repositionViews();
  }

  // Переключить фокус между левой и правой панелью split.
  focusSplitPanel(side: 'left' | 'right'): void {
    if (!this.splitState) return;
    const newId = side === 'left' ? this.splitState.leftId : this.splitState.rightId;
    if (this.activeId === newId) return;
    this.onActiveTabChangedCb?.(); // та же логика, что и в activate() — активная панель реально меняется

    // Останавливаем поиск на панели, с которой уходим.
    const prevWc = this.getActiveWebContents();
    if (prevWc) { prevWc.stopFindInPage('clearSelection'); this.lastQuery = ''; }
    this.findBarOpen = false;

    this.splitState.activePanel = side;
    this.activeId = newId;
    const tab = this.tabMap.get(newId);
    if (tab) tab.lastActiveAt = Date.now();
    this.onChange();
    this.focusActiveView();
  }

  // Визуальный порядок вкладок: хаб → закреплённые → узлы (flat).
  // Используется Ctrl+1–9 и Ctrl+Tab; совпадает с порядком сайдбара.
  private tabsInVisualOrder(withHub: boolean): ManagedTab[] {
    const normal = this.#flattenNodes();
    if (!withHub) return [...this.pinnedTabs, ...normal];
    return [this.hubTab, ...this.pinnedTabs, ...normal];
  }

  selectNext(): void {
    const ordered = this.tabsInVisualOrder(true);
    const idx = ordered.findIndex((t) => t.id === this.activeId);
    this.activate(ordered[(idx + 1) % ordered.length].id);
  }

  selectPrev(): void {
    const ordered = this.tabsInVisualOrder(true);
    const idx = ordered.findIndex((t) => t.id === this.activeId);
    this.activate(ordered[(idx - 1 + ordered.length) % ordered.length].id);
  }

  navigate(id: string, input: string) {
    // Хаб: навигация = создать новую вкладку.
    if (id === HUB_ID) { this.createTab(this.resolveInput(input)); return; }
    const tab = this.tabMap.get(id);
    if (!tab) return;
    const target = this.resolveInput(input);
    if (!this.isHttpView(tab.view) && !tab.sleeping) {
      this.createTab(target);
      return;
    }
    if (tab.sleeping) {
      this.wakeTab(id);
      this.activate(id);
      const freshTab = this.tabMap.get(id);
      if (freshTab && this.isHttpView(freshTab.view)) freshTab.view.webContents.loadURL(target);
      return;
    }
    tab.view!.webContents.loadURL(target);
  }

  goBack(id: string) {
    const t = this.tabMap.get(id);
    if (this.isHttpView(t?.view ?? null) && t!.view!.webContents.canGoBack())
      t!.view!.webContents.goBack();
  }
  goForward(id: string) {
    const t = this.tabMap.get(id);
    if (this.isHttpView(t?.view ?? null) && t!.view!.webContents.canGoForward())
      t!.view!.webContents.goForward();
  }
  reload(id: string) {
    const t = this.tabMap.get(id);
    if (!this.isHttpView(t?.view ?? null)) return;
    const err = this.errors.get(id);
    // После краша renderer-процесс мёртв — loadURL надёжно пересоздаёт процесс.
    if (err?.type === 'crash' && err.url) {
      t!.view!.webContents.loadURL(err.url);
    } else {
      t!.view!.webContents.reload();
    }
  }

  // ── Поиск по странице ────────────────────────────────────────────────────
  private getActiveWebContents() {
    const tab = this.tabMap.get(this.activeId);
    return tab && this.isHttpView(tab.view) ? tab.view.webContents : null;
  }

  findInPage(query: string, forward: boolean): void {
    const wc = this.getActiveWebContents();
    if (!wc) return;
    // findNext:true = продолжить существующий поиск; false = начать новый.
    wc.findInPage(query, { forward, findNext: query === this.lastQuery });
    this.lastQuery = query;
  }

  findNext(forward: boolean): void {
    const wc = this.getActiveWebContents();
    if (!wc || !this.lastQuery) return;
    wc.findInPage(this.lastQuery, { forward, findNext: true });
  }

  stopFind(): void {
    const wc = this.getActiveWebContents();
    if (wc) wc.stopFindInPage('clearSelection');
    this.lastQuery = '';
    this.findBarOpen = false;
  }

  // ── Зум активной вкладки ──────────────────────────────────────────────────
  // Хаб пропускаем: у него нет WebContentsView.
  private adjustZoom(delta: number): void {
    const tab = this.tabMap.get(this.activeId);
    if (!tab || !this.isHttpView(tab.view)) return;
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX,
      tab.view.webContents.getZoomFactor() + delta));
    tab.view.webContents.setZoomFactor(next);
  }

  private resetZoom(): void {
    const tab = this.tabMap.get(this.activeId);
    if (!tab || !this.isHttpView(tab.view)) return;
    tab.view.webContents.setZoomFactor(1.0);
  }

  // ── Ctrl+1..9: переключиться на вкладку по номеру ──
  // Счёт в визуальном порядке (закреплённые сверху, потом обычные), без хаба.
  // Ctrl+9 = всегда последняя (стандарт браузеров), Ctrl+1..8 = по индексу.
  selectByIndex(n: number): void {
    const real = this.tabsInVisualOrder(false); // без хаба
    if (real.length === 0) return;
    const target = n === 9 ? real[real.length - 1] : real[n - 1];
    if (target) this.activate(target.id);
  }

  // DevTools активной вкладки в отдельном окне (не путать с DevTools хром-слоя).
  private toggleActiveDevTools(): void {
    const wc = this.getActiveWebContents();
    if (!wc) return;
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools();
    } else {
      wc.openDevTools({ mode: 'detach' });
    }
  }

  // ── Хоткеи: перехватываем до рендерера, чтобы работало и на сайтах ──
  // Вызывается для каждой новой вкладки (из wirePageEvents) и для chromeView
  // (из main.ts), чтобы покрыть и страницы, и хаб.
  //
  // ВСЕ хоткеи матчим по input.code (физическая позиция клавиши), а НЕ по input.key.
  // input.key зависит от раскладки: на русской F→«а», W→«ц» и т.д.
  registerHotkeyHandler(wc: WebContents): void {
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const { code, shift } = input;

      // ── Без Ctrl ──────────────────────────────────────────────────────────
      if (!input.control) {
        // Esc: приоритет — закрыть FindBar; иначе — остановить загрузку страницы.
        if (code === 'Escape' && !shift) {
          if (this.findBarOpen) {
            event.preventDefault();
            this.findBarOpen = false;   // немедленный сброс, чтобы второй Esc не зацикливался
            this.onFindCloseCb();
          } else {
            const active = this.getActiveWebContents();
            if (active) { event.preventDefault(); active.stop(); }
          }
          return;
        }
        // F5: обновить активную вкладку.
        if (code === 'F5' && !shift) {
          event.preventDefault();
          this.reload(this.activeId);
          return;
        }
        // F12: DevTools активной вкладки (открыть / закрыть).
        if (code === 'F12' && !shift && !input.alt) {
          event.preventDefault();
          this.toggleActiveDevTools();
          return;
        }
        // Alt+← / Alt+→: назад / вперёд (клавиатурная альтернатива Mouse4/Mouse5).
        // Боковые кнопки мыши (XButton1/2) обрабатываются нативно через WebContentsViewAura.
        if (code === 'ArrowLeft' && input.alt && !shift) {
          event.preventDefault();
          this.goBack(this.activeId);
          return;
        }
        if (code === 'ArrowRight' && input.alt && !shift) {
          event.preventDefault();
          this.goForward(this.activeId);
          return;
        }
        return;
      }

      // ── Ctrl+... ──────────────────────────────────────────────────────────
      if (code === 'KeyT' && !shift) {
        event.preventDefault();
        this.activate(HUB_ID);             // Ctrl+T: открыть хаб
      } else if (code === 'KeyT' && shift) {
        event.preventDefault();
        this.reopenLastClosedTab();         // Ctrl+Shift+T: восстановить закрытую
      } else if (code === 'KeyW' && !shift) {
        event.preventDefault();
        this.closeTab(this.activeId);       // Ctrl+W: закрыть активную (хаб защищён)
      } else if (code === 'Tab' && !shift) {
        event.preventDefault();
        this.selectNext();                  // Ctrl+Tab: следующая вкладка
      } else if (code === 'Tab' && shift) {
        event.preventDefault();
        this.selectPrev();                  // Ctrl+Shift+Tab: предыдущая вкладка
      } else if (code === 'Equal' || code === 'NumpadAdd') {
        event.preventDefault();
        this.adjustZoom(ZOOM_STEP);         // Ctrl+= / Ctrl++
      } else if (code === 'Minus' || code === 'NumpadSubtract') {
        event.preventDefault();
        this.adjustZoom(-ZOOM_STEP);        // Ctrl+-
      } else if (code === 'Digit0' || code === 'Numpad0') {
        event.preventDefault();
        this.resetZoom();                   // Ctrl+0: сбросить к 100%
      } else if (code === 'KeyF' && !shift) {
        event.preventDefault();
        this.findBarOpen = true;
        this.onFindOpenCb();                // Ctrl+F: открыть / сфокусировать FindBar
      } else if (code === 'KeyR' && !shift) {
        event.preventDefault();
        this.reload(this.activeId);         // Ctrl+R: обновить страницу
      } else if (code === 'KeyL' && !shift) {
        event.preventDefault();
        this.onOmniboxFocusCb();            // Ctrl+L: фокус в омнибокс
      } else if (code === 'KeyH' && !shift) {
        event.preventDefault();
        this.onHistoryOpenCb?.();           // Ctrl+H: открыть панель истории
      } else if (code === 'KeyI' && shift) {
        event.preventDefault();
        this.toggleActiveDevTools();        // Ctrl+Shift+I: DevTools (альтернатива F12)
      } else if (code.startsWith('Digit') && !shift) {
        const n = parseInt(code[5]!, 10);   // 'Digit1'→1 … 'Digit9'→9
        if (n >= 1 && n <= 9) {
          event.preventDefault();
          this.selectByIndex(n);            // Ctrl+1..8: вкладка по номеру; Ctrl+9: последняя
        }
      }
    });
  }

  // ── Показать / скрыть вьюху активной вкладки ──
  // revealView: вызывается после did-navigate (успешная загрузка) — показываем.
  private revealView(id: string): void {
    const tab = this.tabMap.get(id);
    if (!tab || !this.isHttpView(tab.view)) return;
    const children = this.win.contentView.children;
    if (!children.includes(tab.view)) this.win.contentView.addChildView(tab.view);
    tab.view.setVisible(true);
    // В split: перепозиционируем обе панели (bounds мог прийти раньше вьюхи).
    if (this.splitState && (id === this.splitState.leftId || id === this.splitState.rightId)) {
      this.repositionViews();
    } else {
      this.applyBounds(tab.view);
    }
  }

  // hideView: вызывается при ошибке/краше — скрываем, React нарисует экран ошибки.
  private hideView(id: string): void {
    const tab = this.tabMap.get(id);
    if (!tab || !this.isHttpView(tab.view)) return;
    tab.view.setVisible(false);
  }

  // ── AI-группировка вкладок (Phase 4) ──────────────────────────────────────

  hasOrganizeSnapshot(): boolean {
    return this.organizeSnapshot !== null;
  }

  // Очищает снимок; вызывается в начале каждого структурного метода (drag, создание/удаление группы и т.п.),
  // чтобы баннер «Вернуть» пропал при любом ручном изменении топологии.
  private clearOrganizeSnapshot(): void {
    this.organizeSnapshot = null;
  }

  // Применяет предложенные кластеры: сохраняет снимок nodes, создаёт GroupNode-ы,
  // проверяет инвариант tabMap.size. При нарушении — откат без onChange-петли.
  applyOrganize(clusters: import('../shared/ipc').OrganizeCluster[]): void {
    if (clusters.length === 0) return;

    // Глубокая копия через JSON: SidebarNode сериализуем по определению.
    this.organizeSnapshot = JSON.parse(JSON.stringify(this.nodes)) as SidebarNode[];

    const toGroup = new Set<string>();
    for (const c of clusters) for (const id of c.nodeIds) toGroup.add(id);

    // Узлы, не входящие ни в одну предложенную группу, остаются на верхнем уровне.
    const remaining: SidebarNode[] = this.nodes.filter((node) => {
      if (node.type === 'single')     return !toGroup.has(node.tabId);
      if (node.type === 'split-pair') return !toGroup.has(node.leftTabId);
      return true; // существующие GroupNode — не трогаем
    });

    // Строим новые GroupNode по предложениям кластеризации.
    const newGroups: GroupNode[] = [];
    for (const c of clusters) {
      const children: SidebarNode[] = [];
      for (let i = 0; i < c.nodeIds.length; i++) {
        const nodeId = c.nodeIds[i]!;
        const ntype  = c.nodeTypes[i]!;
        if (ntype === 'single') {
          children.push({ type: 'single', tabId: nodeId });
        } else {
          // split-pair: берём оригинальный узел чтобы сохранить ratio
          const orig = (this.organizeSnapshot as SidebarNode[]).find(
            (n): n is SplitPairNode => n.type === 'split-pair' && n.leftTabId === nodeId,
          );
          if (orig) children.push({ ...orig });
        }
      }
      if (children.length === 0) continue;
      newGroups.push({
        type: 'group', id: randomUUID(),
        label: c.label, color: null, collapsed: false, children,
      });
    }

    this.nodes = [...remaining, ...newGroups];

    // Инвариант: каждый таб в tabMap должен присутствовать ровно один раз.
    const flatCount = this.#flattenNodes().length;
    if (this.pinnedTabs.length + flatCount !== this.tabMap.size) {
      console.error(
        `[TabManager] applyOrganize: инвариант нарушен ` +
        `(tabMap=${this.tabMap.size}, pinned=${this.pinnedTabs.length}, flat=${flatCount}). Откат.`,
      );
      this.nodes = this.organizeSnapshot;
      this.organizeSnapshot = null;
      this.onChange();
      return;
    }

    this.onChange();
  }

  // Возвращает nodes к состоянию до последней AI-группировки.
  rollbackOrganize(): void {
    if (!this.organizeSnapshot) return;
    this.nodes = this.organizeSnapshot;
    this.organizeSnapshot = null;
    this.onChange();
  }

  // ── Геометрия "дырки" под контент ──
  setContentBounds(b: ContentBounds) {
    this.bounds = b;
    this.repositionViews();
  }

  // Позиционирует видимые вьюхи согласно текущему режиму (single / split).
  // «Припаркованный» split (splitState есть, но активна другая вкладка) ведёт
  // себя как single: позиционируем только текущую активную вкладку.
  private repositionViews(): void {
    const currentlyInSplit = !!this.splitState
      && (this.activeId === this.splitState.leftId || this.activeId === this.splitState.rightId);

    if (!currentlyInSplit) {
      const active = this.tabMap.get(this.activeId);
      if (active && this.isHttpView(active.view) && !this.errors.has(this.activeId)) {
        this.applyBounds(active.view);
      }
      return;
    }
    // Split: разделяем bounds по текущему splitRatio с SPLIT_GAP-зазором.
    // splitState гарантированно не null: currentlyInSplit включает !!this.splitState.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const { leftId, rightId, splitRatio } = this.splitState!;
    const leftWidth = Math.floor((this.bounds.width - SPLIT_GAP) * splitRatio);
    const leftB:  ContentBounds = {
      x: this.bounds.x, y: this.bounds.y,
      width: leftWidth, height: this.bounds.height,
    };
    const rightB: ContentBounds = {
      x: this.bounds.x + leftWidth + SPLIT_GAP, y: this.bounds.y,
      width: this.bounds.width - leftWidth - SPLIT_GAP, height: this.bounds.height,
    };
    this.applySplitBounds(leftId, leftB);
    this.applySplitBounds(rightId, rightB);
  }

  // Позиционирует одну split-панель; при ошибке скрывает вьюху (React рисует TabError).
  private applySplitBounds(id: string, b: ContentBounds): void {
    const tab = this.tabMap.get(id);
    if (!tab || !this.isHttpView(tab.view)) return;
    if (this.errors.has(id)) { tab.view.setVisible(false); return; }
    const children = this.win.contentView.children;
    if (!children.includes(tab.view)) this.win.contentView.addChildView(tab.view);
    tab.view.setVisible(true);
    tab.view.setBounds({
      x: Math.round(b.x), y: Math.round(b.y),
      width: Math.max(0, Math.round(b.width)),
      height: Math.max(0, Math.round(b.height)),
    });
  }

  private applyBounds(view: WebContentsView) {
    const { x, y, width, height } = this.bounds;
    view.setBounds({
      x: Math.round(x), y: Math.round(y),
      width: Math.max(0, Math.round(width)),
      height: Math.max(0, Math.round(height)),
    });
  }
}
