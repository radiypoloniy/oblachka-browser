import type { AutomationRule } from '../rules';
import type { ModelErrorCode } from './ai';
import type { GenSpec, GenKind } from '../genSpec';
import type { GenFeedItem } from '../genWeb';

// ── Узлы сайдбара ─────────────────────────────────────────────────────────────
// Дискриминированное объединение для трёх типов узлов.
// Phase 0: создаются только SingleNode.
// Phase 2+: split-pair и group.
export interface SingleNode {
  type: 'single';
  tabId: string;
}
export interface SplitPairNode {
  type: 'split-pair';
  leftTabId: string;
  rightTabId: string;
  ratio: number; // 0.2..0.8
}
export interface GroupNode {
  type: 'group';
  id: string;           // стабильный UUID для dnd-kit
  label: string;
  color: string | null; // 'red'|'orange'|'yellow'|'green'|'blue'|'purple'|null
  children: SidebarNode[];
  collapsed: boolean;
}
export type SidebarNode = SingleNode | SplitPairNode | GroupNode;

// Вопрос о повторной загрузке (см. electron/DownloadManager.ts). Пока он не отвечен, загрузка
// стоит на паузе и в списке не показывается — отказ не должен оставлять запись «Отменено».
export interface DuplicateDownloadPrompt {
  askId: string;
  filename: string;
  savePath: string;
  downloadedAt: number;
}
export type DuplicateDownloadDecision = 'download' | 'open' | 'cancel';

export interface FindResult {
  activeMatch: number; // порядковый номер текущего совпадения (1-based)
  count: number;       // всего совпадений
}

/**
 * Разбор фразы в СПЕКУ своего виджета (electron/GenSpecParser.ts): тип из закрытого каталога
 * плюс данные под него. Черновик приходит в renderer, ставит его человек — модель ничего не
 * заводит сама.
 *
 * ⚠️ Раньше здесь ездил HTML, написанный моделью. Почему так больше не делается — в шапке
 * shared/genSpec.ts; коротко: 4B не пишет рабочий интерфейс, а пустую плитку от рабочей
 * человеку не отличить.
 */
export type GenSpecOutcome =
  | { ok: true; spec: GenSpec; size: { w: number; h: number } }
  // 'link' — не сложилось со ссылкой, а не с моделью: по адресу не фид и не JSON, сайт не
  // ответил, ответ слишком большой. Отдельно от 'model-error' ради честной формулировки.
  | { ok: false; reason: 'unclear' | 'model-error' | 'link'; error?: string; kind?: GenKind };

/**
 * Что лежит по ссылке, которую дал человек. Ходит МAIN через сессию Electron — то есть запрос
 * уважает VPN, kill switch и адблок (см. electron/GenWebSource.ts).
 */
export type GenWebResult =
  | { ok: true; kind: 'feed'; items: GenFeedItem[]; title: string }
  | { ok: true; kind: 'json'; json: unknown }
  | { ok: false; error: string };

/**
 * Ход сборки своего виджета. `chars` — сколько символов модель уже написала на этой стадии.
 * ⚠️ Это НЕ доля выполнения: сколько будет всего, неизвестно ни модели, ни нам. Годится для
 * живости (движение в ритме модели), но не для процентов — проценты пришлось бы выдумать.
 */
export interface GenProgress {
  stage: 'kind' | 'data' | 'done';
  chars: number;
}

export type RuleParseOutcome =
  | { ok: true; rule: AutomationRule }
  // 'unclear' — фраза не легла в закрытый каталог (это нормальный и частый исход),
  // 'model-error' — модель не ответила/не загрузилась.
  | { ok: false; reason: 'unclear' | 'model-error'; error?: string };

// Ответ смыслового Ctrl+F (electron/SmartFind.ts). Панель поиска рисует по нему только статус:
// сам результат человек видит НА СТРАНИЦЕ — штатной подсветкой findInPage, к которой её и
// прокручивает. Отдельного окна с ответом нет намеренно: цитата и так на месте, в контексте.
export interface SmartFindResult {
  ok: boolean;
  // Цитаты СО СТРАНИЦЫ (модель выбирает номера фрагментов, а не пишет текст), лучшая первой.
  // ⚠️ Их несколько, а не одна: на подборке (например, список игр одного жанра) единственный
  // ответ выглядит как недоработка — человек видит на странице ещё подходящие места. Панель
  // листает их стрелками, как обычные совпадения.
  quotes?: string[];
  matches?: number; // сколько совпадений подсветилось у ПОКАЗАННОЙ сейчас цитаты
  // 'no-model' — модель не отвечает/не загрузилась, 'no-text' — со страницы нечего читать,
  // 'not-found' — модель ничего не выбрала либо цитата не нашлась подсветкой, 'busy' — уже ищем.
  reason?: 'no-model' | 'no-text' | 'not-found' | 'busy';
}

// Цель быстрого поиска (Ctrl+E, см. electron/SearchTargets.ts + SearchPopoverManager.ts).
// Смысл фичи — не заставлять называть цель ДО запроса («!yt котики»), а предложить её самой:
// первой идёт текущий сайт, если по его адресу удалось восстановить шаблон поиска.
export interface SearchTarget {
  // 'site' — текущий сайт, 'bang' — бэнг из хранилища, 'engine' — поисковик по умолчанию.
  id: string;
  name: string;
  kind: 'site' | 'bang' | 'engine';
  // Шаблон с {query} (тот же формат, что у бэнгов). Едет в поповер и возвращается обратно —
  // main обязан ПРОВЕРИТЬ его (isValidBangTemplate) перед навигацией, а не доверять на слово.
  template: string;
  // Favicon цели (FaviconService — только сам домен, с кэшем).
  faviconUrl?: string | null;
  // Ключ бэнга, если цель пришла из хранилища бэнгов. Показывается на чипе в развёрнутом
  // списке: без этого узнать, что цель вызывается набором «!wb», было неоткуда.
  bangKey?: string;
}

// Ответ на ввод в поповере быстрого поиска: находки в своих данных + разобранный бэнг.
// Бэнг разбирает main (BangStore видит и пользовательские, и встроенные, и импортированные) —
// второго парсера в поповере нет намеренно, см. shared/bangs.ts.
export interface QuickQueryResult {
  hits: QuickHit[];
  // Цель, названная бэнгом прямо в строке («!wb Xiaomi»). null — бэнга в строке нет.
  bangTarget: SearchTarget | null;
  // Строка без бэнга — то, что реально пойдёт в поиск.
  strippedQuery: string;
}

// Чем наполнять полосу целей быстрого поиска (Ctrl+E).
// 'auto' — контекстом: выученные сайты и свои бэнги, частые вперёд (см. SearchTargetStore).
// 'pinned' — строго набором, который человек закрепил сам.
// Текущий сайт и поисковик по умолчанию остаются в обоих режимах: первый — весь смысл фичи,
// второй — единственная цель, подходящая к любому запросу.
export interface SearchChipsConfig {
  mode: 'auto' | 'pinned';
  pinned: string[]; // id целей (bang:<ключ> / site:<хост>) в порядке закрепления
  // Цель, НА КОТОРОЙ поповер открывается: она стоит первой и уже выбрана, то есть Enter сразу
  // после набора уходит именно туда — без единого клика по полосе и без набора бэнга.
  // null — прежнее поведение: первым идёт сайт, на котором человек сейчас (а если цели для него
  // нет — поисковик по умолчанию). Кроме 'bang:'/'site:' допустимо 'engine' — поисковик.
  defaultId: string | null;
}

// Кандидат в цели — то, из чего выбирают в настройках. Список НЕ отдаётся целиком: источников
// вместе с импортированным набором DDG — тысячи, поэтому наружу он доступен только поиском
// (SEARCH_CHIPS_SEARCH) и точечным разрешением уже выбранных id (SEARCH_CHIPS_RESOLVE).
export interface SearchChipCandidate {
  id: string;
  name: string;
  kind: 'bang' | 'site';
  // Откуда взялся: свой бэнг, встроенный, выученный сайт или импортированный из DDG — UI это
  // показывает, иначе в общем списке не отличить «моё» от «наше».
  source: 'user' | 'builtin' | 'learned' | 'imported';
  // Домен цели — только под favicon в настройках (FaviconService), не для навигации.
  host: string;
  // Ключ бэнга, если он есть: та же цель зовётся «!wb» прямо из строки поиска.
  bangKey?: string;
}

// Находка в СВОИХ данных для того же поповера: открытая вкладка, история, закладка.
// Веб-поиск отвечает на «что об этом пишут», а это — на «где я это уже видел»; второе
// в браузере спрашивают не реже, а идти за ним приходилось в отдельную панель.
export interface QuickHit {
  kind: 'tab' | 'history' | 'bookmark';
  // Для 'tab' — id вкладки: её не открывают заново, на неё переключаются.
  tabId?: string;
  url: string;
  title: string;
  faviconUrl?: string | null;
}

export interface TabErrorState {
  type: 'load' | 'crash';
  code: number;   // errorCode из did-fail-load; 0 при краше
  url: string;    // URL, который не открылся — для показа и retry
  // Была ли сеть жива в момент ошибки (net.isOnline() в main). Один и тот же код приходит и
  // когда лежит сайт, и когда отвалился Wi-Fi, — а советовать в этих случаях надо разное.
  offline: boolean;
  // Сертификат сайта честно выписан УЦ Минцифры, просто этому домену мы его не доверяем (см.
  // CertificateTrust.ts). Отличается от любой другой ошибки сертификата тем, что у человека есть
  // осмысленный выход — разрешить конкретный сайт; всем остальным предлагать нечего.
  russianCa?: boolean;
}

// Партиция инкогнито-вкладок: БЕЗ префикса 'persist:' → сессия in-memory (куки/кэш/хранилище не
// пишутся на диск, живут только в памяти процесса). Общая для всех инкогнито-вкладок текущего
// запуска. Импортируется и main (создание сессии/привязка адблока/прокси), и TabManager
// (webPreferences.partition новой вьюхи). Данные чистятся при закрытии последней инкогнито-вкладки.
export const INCOGNITO_PARTITION = 'oblako-incognito';

// Псевдо-вкладки без WebContentsView (см. TabManager.createSpecialTab). Именованный тип, а не
// union по месту: копий было четыре (контракт, preload, обработчик в main, TabManager), и они
// уже разъехались — 'downloads' знали только две из них, хотя вкладка загрузок открывается из
// App.tsx. Рантайму это не вредило (типы стираются), но читающий main видел неправду.
export type SpecialTabKind = 'history' | 'settings' | 'bookmarks' | 'downloads';

export interface TabState {
  id: string;
  isActive: boolean;    // true = эта вкладка сейчас активна в main-процессе
  tabError: TabErrorState | null; // null = нет ошибки
  url: string;          // текущий реальный URL вкладки
  title: string;        // заголовок страницы (document.title)
  faviconUrl: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isHub: boolean;       // true = вкладка-хаб (наш UI), без WebContentsView
  isPinned: boolean;    // закреплена — переживает перезапуск, нельзя закрыть крестиком
  splitSide: 'left' | 'right' | null; // null = не в split-режиме
  isSleeping: boolean;  // WebContentsView выгружен, хранятся только url/title/favicon
  incognito: boolean;   // приватная вкладка (in-memory сессия, без истории) — для бейджа в UI
  // Вкладка прямо СЕЙЧАС воспроизводит звук. Нужно, чтобы было видно, откуда играет музыка:
  // с вертикальным сайдбаром и десятками вкладок иначе приходится обходить их по одной.
  // ⚠️ Это состояние момента, а не свойство вкладки: тишина между треками и пауза его снимают.
  // У спящих и псевдо-вкладок всегда false — там нет ни звука, ни самого WebContentsView.
  audible: boolean;
  // Звук вкладки выключен человеком. ⚠️ Отдельно от audible, а не «audible=false»: приглушённая
  // вкладка перестаёт считаться звучащей, и без своего признака значок исчез бы вместе с
  // единственным способом вернуть звук обратно.
  muted: boolean;
  // Вид содержимого вкладки — 'page' обычная страница (реальный WebContentsView), 'hub' —
  // единственный синглтон-хаб (isHub уже покрывает это, kind добавлен для полноты и симметрии
  // с history/settings). 'history'/'settings' — псевдо-вкладки без WebContentsView (view: null
  // в TabManager, тот же приём, что у хаба), обычные tabMap-записи: закрываемые, в нескольких
  // экземплярах, не участвуют в сессии/истории/усыплении (см. TabManager.createSpecialTab —
  // тот же путь #tabUrl()==='' → savable()===false / isHttpView(null)===false, что уже
  // естественно исключает их из session snapshot и sleep-таймера, без отдельных правок там).
  kind: 'page' | 'hub' | SpecialTabKind;
  // Начальный раздел для kind==='settings' (напр. 'ai') — необязателен, задаётся только когда
  // createSpecialTab('settings', section) вызван с разделом (см. AiPanelManager.ts кнопка "+" в
  // AI-панели). Для всех остальных kind не используется.
  section?: string;
}

// Атомарный снимок: вкладки + структура сайдбара в одном сообщении.
// Заменяет два раздельных push-канала (вкладки и дерево узлов по отдельности), чтобы
// renderer никогда не рендерил половинчатое состояние (узел пары есть, вкладка ещё нет).
export interface SyncState {
  tabs: TabState[];
  nodes: SidebarNode[];
  hasOrganizeSnapshot: boolean; // true = доступен откат последней AI-группировки
  hasRenameSnapshot: boolean;   // true = доступен откат последнего массового переименования
}

// Один предложенный кластер от TabOrganizer.ts → TabManager.applyOrganize().
export interface OrganizeCluster {
  nodeIds:   string[];                       // tabId (single) или leftTabId (split-pair)
  nodeTypes: ('single' | 'split-pair')[];   // по позиции
  label:     string;                         // название группы
}

// Тот же кластер, но для renderer-превью в App.tsx/Sidebar.tsx (до применения): titles — заголовки
// вкладок для показа списком, suggestedName — предложенное имя ДО того, как пользователь мог его
// принять (после «Применить» оно становится OrganizeCluster.label). Раньше жил в
// ClusteringService.ts (эмбеддинг-кластеризация, удалена) — тип пережил саму реализацию, всё ещё
// нужен для формы превью TabOrganizer.ts::suggestGroups().
export interface ClusterProposal {
  nodeIds: string[];
  nodeTypes: ('single' | 'split-pair')[];
  titles: string[];
  suggestedName: string;
}

// Результат TabOrganizer.ts::suggestGroups() — та же форма кластеров (OrganizeCluster), что уже
// умеет применять TabManager.applyOrganize()/renderer-превью. modelWasCold — была ли модель
// незагруженной НА ВХОДЕ в вызов (on-demand режим): группировка сама триггерит холодную загрузку,
// не отказывает — UI использует этот флаг, чтобы решить, показывать ли предупреждение про долгую
// первую загрузку (см. App.tsx::handleOrganize). ok:false — тот же формат ошибки, что
// TranslateResult/AiActionOutcome (errorCode из ModelErrorCode, где применимо) — раньше здесь была
// узкая MODEL_NOT_LOADED, но с уходом гейта вызов может упасть на реальной загрузке модели
// (NO_MODEL_INSTALLED/MODEL_FILE_MISSING/т.п.), а не только по этой одной причине.
export type OrganizeProposal =
  | { ok: true; clusters: OrganizeCluster[]; modelWasCold: boolean }
  | { ok: false; error: string; errorCode?: ModelErrorCode };

// Геометрия "дырки" под контент в координатах окна (CSS-пиксели).
// Renderer измеряет область и сообщает main, куда класть WebContentsView.
export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
