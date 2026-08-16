import type { PermKey } from './ai';

// ── Дропдаун подсказок омнибокса (нативная вью, заход 3/5) ───────────────────────────────────
// Та же форма, что локальный SuggestItem в Toolbar.tsx (переиспользуется оттуда напрямую) —
// пересекает IPC-границу chrome ↔ main ↔ вью дропдауна, поэтому здесь, а не ad-hoc в одном файле.
// 'suggest' — заход 10, живая веб-подсказка от suggest-API поисковика (не посещённая страница
// и не открытая вкладка — просто фраза-автодополнение, ведёт на её результаты поиска).
export type SuggestKind = 'history' | 'tab' | 'search' | 'suggest';
export interface SuggestDropdownItem {
  kind: SuggestKind;
  label: string;
  sub?: string;
  url: string;
  tabId?: string;
  // Окно, в котором живёт вкладка, — ТОЛЬКО когда это НЕ окно-отправитель (смысловой поиск ищет
  // по всем окнам, см. SmartTabHit). Пусто — вкладка своя, переключаемся обычным TAB_ACTIVATE.
  windowId?: number;
  // Подпись секции (по образцу Safari — «Предложения Google» / «Закладки и история») — ставится
  // ТОЛЬКО на первый элемент новой секции (Toolbar.tsx::buildSuggestions). Вью дропдауна ничего
  // не решает сама, просто рисует подпись, если она есть — источник группировки остаётся в
  // Toolbar.tsx, не размазывается по двум местам.
  sectionHeader?: string;
}

// ── Панель омнибокса (заход 11) ────────────────────────────────────────────────────────────────
// ВТОРОЙ РЕЖИМ той же вью дропдауна — то, что видно по клику в НЕТРОНУТУЮ строку, пока человек
// ничего не набрал. Раньше здесь был плоский список часто посещаемых, и после переезда омнибокса
// во flex-поток (строка занимает всю свободную полосу) список в 8 строк оставлял пустой всю правую
// половину карточки. Панель забирает ширину плитками и карточками.
//
// ⚠️ Порядок ВЫБОРА остаётся ПЛОСКИМ и принадлежит по-прежнему омнибоксу: sites, следом related —
// ровно тот же массив, что Toolbar.tsx держит в suggestions. Вью считает номер строки из длины
// sites и сама ничего не решает, как и в режиме списка (Enter выполняется в омнибоксе).
export interface OmniboxPanelSite {
  /** Хост открытой страницы без www — заголовок полоски. */
  host: string;
  /** https ли соединение — тот же замочек, что в самой строке. */
  secure: boolean;
  /** Вырезано трекеров/рекламы на этом сайте за сеанс (AdBlockManager). */
  blocked: number;
  /** Сайт в исключениях адблока — тогда счётчик показывать нечестно. */
  adblockOff: boolean;
  /** Что сайту уже разрешено — только значки, УПРАВЛЕНИЕ остаётся в поповере замочка. */
  perms: PermKey[];
  /** Фраза «изменилось с прошлого раза» (PageChanges). Пусто — показывать нечего. */
  changed?: string;
}
/** Сайт из набора «Рекомендуемые» — то, что человек собрал себе сам (см. SettingsManager). */
export interface RecommendedSite {
  url: string;
  title: string;
}
/**
 * Правка набора «Рекомендуемые» из режима карандаша В ПАНЕЛИ.
 * ⚠️ Только «добавить/убрать уже известный сайт» — и это не упрощение, а следствие конструкции:
 * окно дропдауна неактивируемое (`focusable: false`, на этом держится работа адресной строки),
 * то есть НАБРАТЬ текст внутри него физически нельзя. Произвольный адрес пришлось бы вводить в
 * другом окне; вместо этого сайт переносится кликом из «часто посещаемых».
 */
export interface OmniboxRecommendEdit {
  action: 'add' | 'remove';
  url: string;
  title: string;
}

export interface OmniboxPanel {
  /** Плитки «часто посещаемые» — они же первые элементы плоского массива выбора. */
  sites: SuggestDropdownItem[];
  /** Плитки «рекомендуемые» — набор человека; идут в плоском массиве СРАЗУ за sites. */
  recommended?: SuggestDropdownItem[];
  /** Шапка с текущим сайтом. Нет на новой вкладке — там про сайт сказать нечего. */
  site?: OmniboxPanelSite;
  /** Адрес открытой страницы — вью достаёт по нему значок сайта для шапки. */
  siteUrl?: string;
  /** «Вы это уже читали» — приезжает ПОЗЖЕ плиток, дорисовывается снизу (см. Toolbar.tsx). */
  related?: SuggestDropdownItem[];
}

export type DownloadState = 'progressing' | 'completed' | 'cancelled' | 'interrupted';

export interface DownloadEntry {
  id: string;
  filename: string;
  url: string;
  savePath: string;       // пустая строка пока не завершено / пользователь не выбрал путь
  mime: string;
  totalBytes: number;     // 0 = неизвестен до получения Content-Length
  receivedBytes: number;
  state: DownloadState;
  startedAt: number;      // Unix ms
  isPaused: boolean;
  bytesPerSec: number;    // 0 = неизвестна или завершено
  // Файла по savePath на диске уже нет (человек его удалил или перенёс между запусками).
  // Появилось вместе с хранением списка на диске: без этого «Открыть» на записи месячной
  // давности молча ничего не делало бы. Проверяется при чтении файла со списком, не на каждый кадр.
  fileMissing?: boolean;
}

// Имя файла по содержимому (см. electron/DownloadNamer.ts). Ошибка приезжает СТРОКОЙ для показа
// человеку: причин отказа много (скан без текста, файл занят, модели нет), и «просто не сработало»
// на действии, которое он нажал сам, было бы враньём.
export interface DownloadNameSuggestion {
  ok: boolean;
  name?: string;   // предложенное имя ЦЕЛИКОМ, с исходным расширением
  error?: string;
}

export interface DownloadRenameResult {
  ok: boolean;
  filename?: string; // имя, которое реально легло на диск (могло развестись из-за дубля)
  error?: string;
}

// Находка смыслового поиска вкладки (см. electron/TabSearch.ts).
//
// ⚠️ Отдаём НЕ голый id, как раньше, а описание вкладки вместе с окном. Причина: поиск теперь
// идёт по вкладкам ВСЕХ окон, а у окна-спрашивающего нет ни заголовка, ни адреса чужой вкладки —
// показать находку ему было бы нечем. Плюс `otherWindow` считает MAIN относительно отправителя:
// «в другом окне» — это факт про спрашивающего, а не про вкладку, и renderer его знать не обязан.
export interface SmartTabHit {
  tabId: string;
  windowId: number;
  title: string;
  url: string;
  otherWindow: boolean;
}

// Одна разобранная часть адреса (см. shared/addressParts.ts). Наружу отдаём и ключ поля, и
// подпись: ключ нужен форме настроек, чтобы разложить части по своим полям.
export interface ParsedAddressPart {
  key: string;
  label: string;
  value: string;
}

// Что изменилось на странице с прошлого визита (см. electron/PageChanges.ts).
export interface PageChangePiece { before: string; after: string }
export interface PageChangesResult {
  changed: boolean;
  summary?: string;                 // фраза от модели; пусто — показываем сам факт и куски
  pieces?: PageChangePiece[];
}

// Находка объединённого поиска по своим данным (см. electron/StuffSearch.ts).
// ⚠️ У загрузки в url лежит ПУТЬ НА ДИСКЕ, а не адрес: открывается она файлом, а не навигацией.
export interface StuffHit {
  kind: 'history' | 'bookmark' | 'download';
  title: string;
  url: string;
  subtitle: string;
  snippet?: string;
  // Только у загрузки: открываем её штатным DOWNLOAD_OPEN_FILE, а не своим путём — там уже есть
  // перепроверка «файл ещё на месте» в момент клика (см. DownloadManager.#stillOnDisk).
  downloadId?: string;
}

// Товар на активной вкладке — для индикатора в тулбаре. null означает «страница не товарная»,
// и это самое частое состояние.
export interface ProductState {
  title: string;
  price: number;
  currency: string;
  availability: string;
  tracked: boolean;
}

// Одна запись буфера: что скопировано, откуда и когда.
// Чем кончился переход к источнику скопированного (см. TabManager.revealCopiedText):
// 'highlighted' — страница открыта и фрагмент подсвечен, 'opened' — открыта, но фрагмента там уже
// нет (страницу переписали), 'no-source' — адрес записи не годится для перехода.
export type ClipboardRevealResult = 'highlighted' | 'opened' | 'no-source';

export interface ClipboardEntry {
  id: number;
  text: string;
  url: string;
  host: string;
  title: string;
  at: number;
}

// Предложение склеить два предложения одного товара. ⚠️ Только предложение: пока человек не
// подтвердил, ничего не объединено (см. shared/productMatch.ts).
export interface MatchSuggestion {
  aId: number;
  bId: number;
  aTitle: string;
  bTitle: string;
  aHost: string;
  bHost: string;
}

// Событие отслеживания: подешевело, подорожало, кончилось, вернулось, заканчивается.
export interface TrackingEvent {
  id: number;
  kind: string;
  text: string;
  at: number;
  title: string;
  url: string;
}

export interface TrackedPricePoint {
  price: number;
  availability: string;
  seenAt: number;
}

export interface TrackedProduct {
  id: number;
  url: string;
  host: string;
  title: string;
  brand: string;
  currency: string;
  createdAt: number;
  // Когда в последний раз ходили проверять и вышло ли. ⚠️ Неудача хранится и показывается: иначе
  // последняя известная цена выглядела бы свежей, а решение о покупке принималось бы по данным
  // непонятной давности.
  lastCheckedAt: number;
  lastCheckOk: number;
  /** Одна группа = один товар в разных магазинах. 0 — сам по себе. */
  groupId: number;
  points: TrackedPricePoint[];
}

// ── AdBlock ─────────────────────────────────────────────────────────────────
export interface AdBlockState {
  enabled: boolean;
  whitelist: string[];        // нормализованные домены (без www., без схемы)
  sessionBlockCount: number;  // счётчик за текущую сессию (сбрасывается при перезапуске)
}
