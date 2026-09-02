
// Параметры titleBarOverlay для динамического обновления (смена темы).

// ── История посещений ────────────────────────────────────────────────────────
export interface HistoryEntry {
  id: number;
  url: string;
  title: string;
  lastVisit: number;  // Unix ms
  visitCount: number;
}

export type HistoryClearPeriod = 'hour' | 'day' | 'week' | 'all';

// «Итоги дня» (electron/DayDigest.ts). 'empty' с причиной, а не пустой список: виджету нужно
// сказать человеку разное — «сегодня ещё нечего обобщать» и «итог просто не собирали».
export interface DayDigestData {
  date: string;      // YYYY-MM-DD
  lines: string[];
  builtAt: number;
  visits: number;
}
export type DayDigestState =
  | { state: 'ready'; digest: DayDigestData }
  | { state: 'empty'; reason: 'no-history' | 'not-built' };

// ── Закладки ─────────────────────────────────────────────────────────────────
// ⚠️ Папка и ссылка — ОДНА таблица и один тип, различаются полем kind. Отличать их «по пустому
// url» нельзя: пустая строка — такое же значение, как любое другое, и две папки немедленно
// столкнулись бы в индексе уникальности адресов (подробности — в electron/bookmarksSchema.ts).
export type BookmarkKind = 'link' | 'folder';

export interface BookmarkEntry {
  id: number;
  kind: BookmarkKind;
  url: string;        // у папки всегда '' — адреса у неё нет
  title: string;
  parentId: number | null;  // null — корень
  position: number;         // порядок внутри своего родителя
  createdAt: number;  // Unix ms
}

// Предложение умной раскладки — ОДНА папка и закладки, которые модель хочет в неё положить.
// ⚠️ Это именно предложение: ничего не применяется, пока человек не согласится. Папка «Мусор»
// среди них — обычная папка с обычным названием, никакой особой сущности в системе для неё нет;
// удаляется она тем же способом, что любая другая.
export interface BookmarkFolderProposal {
  label: string;
  ids: number[];
}

// Узел дерева (BookmarkManager.listTree). children есть ТОЛЬКО у папок — по нему же в UI и
// отличается разворачиваемый узел от конечного, без повторной проверки kind.
export interface BookmarkNode extends BookmarkEntry {
  children?: BookmarkNode[];
}

// Дерево для импорта из другого браузера — as is, каким его отдал источник. id папок здесь нет
// вовсе: они узнаются только в момент вставки, поэтому родитель передаётся вложенностью, а не
// ссылкой (см. BookmarkManager.bulkInsertTree).
export interface ImportBookmarkNode {
  kind: BookmarkKind;
  title: string;
  url?: string;        // только у ссылок
  createdAt?: number;
  children?: ImportBookmarkNode[];
}

// Вход для BookmarkManager.bulkInsert — импорт из других браузеров. Элементы обязаны идти
// родитель-перед-детьми: вызывающая сторона формирует такой порядок обходом дерева источника.
export interface BulkBookmarkInput {
  parentId: number | null;
  kind?: BookmarkKind;  // по умолчанию 'link' — папки появились позже импорта
  url: string;
  title: string;
  position: number;
  createdAt?: number;
}

// Источник импорта закладок — реально найденный на диске браузер (см. electron/bookmarkImport/).
export interface BookmarkImportSource {
  id: string;     // 'chrome' | 'edge' | 'brave' | 'yandex' — стабильный id для BOOKMARK_IMPORT_RUN
  label: string;  // человекочитаемое имя для UI
}

export interface BookmarkImportResult {
  inserted: number;
  skipped: number;
}

// ── Общий импорт данных из браузеров (electron/browserImport/) ──────────────────
// Типы данных, которые умеем переносить из другого браузера. Автозаполнение (адреса/карты)
// сознательно НЕ входит — в браузере пока нет подсистемы автозаполнения форм, хранить нечего
// (дорожная карта п.3). Firefox/Safari добавятся тем же контрактом позже.
export type ImportDataType = 'bookmarks' | 'history' | 'passwords';

// Источник импорта = конкретный ПРОФИЛЬ конкретного браузера, реально найденный на диске.
// id — составной (вендор + каталог профиля), непрозрачен для renderer, только для IMPORT_RUN.
export interface ImportSource {
  id: string;               // напр. 'chrome::Default' — стабильный ключ для IMPORT_RUN
  label: string;            // 'Google Chrome' или 'Google Chrome — Профиль 1' (если профилей несколько)
  dataTypes: ImportDataType[]; // типы, которые для ЭТОГО источника И доступны на диске, И уже поддержаны
}

// Результат по одному типу. unsupported — записи, которые физически нельзя перенести (напр. пароли
// с App-Bound-шифрованием Chrome 127+, требующим SYSTEM-прав) — отдельно от skipped (дубли/уже были).
export interface ImportTypeResult {
  inserted: number;
  skipped: number;
  unsupported?: number;
}

// Ключи — из ImportDataType; присутствуют только реально запрошенные типы. null-значение типа —
// импортёр этого типа упал целиком (в отличие от {inserted:0} — отработал, но нечего было переносить).
export type ImportRunResult = Partial<Record<ImportDataType, ImportTypeResult | null>>;

// Результат импорта паролей из CSV-файла (см. shared/csvPasswords.ts, IPC.IMPORT_PASSWORDS_CSV).
// Отдельный от ImportTypeResult размеченный союз: у CSV-пути есть исходы, которых нет у чтения с
// диска, — человек мог закрыть диалог выбора файла, сейф может быть недоступен, файл может
// оказаться не тем CSV. Каждый исход обязан быть обработан в UI явно.
export type CsvPasswordImport =
  | { status: 'canceled' }          // диалог выбора файла закрыт — отчёта не показываем вовсе
  | { status: 'vault-unavailable' } // сейф недоступен (нет safeStorage) — переносить некуда
  | { status: 'read-error' }        // файл не прочитался
  | { status: 'empty' }             // прочитан, но ни одной пары url+password (не тот CSV/пустой)
  | { status: 'ok'; inserted: number; skipped: number };

// Заход G, блок 6/7 — результат векторного поиска. id/lastVisit/visitCount присутствуют
// намеренно (не только url/title/score) — так результат напрямую совместим с HistoryEntry
// и сливается в тот же byUrl-конвейер Toolbar.tsx::buildSuggestions, что и обычный поиск
// по истории, без отдельной ветки логики дедупа.
export interface SemanticSearchResult {
  id: number;
  url: string;
  title: string;
  lastVisit: number;
  visitCount: number;
  score: number;
  snippet?: string;
}

// Ответ умного поиска (searchHistorySmart) — degraded:true означает, что Qwen-реранк не
// отработал (упал/недоступна модель) и results — это cosine top-k без участия LLM, не то,
// что пользователь запросил кнопкой «умный поиск». false — реранк реально отработал (даже
// если вернул пустой список: это ЕГО осознанный ответ «ничего релевантного», не деградация).
export interface SmartSearchResponse {
  results: SemanticSearchResult[];
  degraded: boolean;
}

// Заход G, блок 5 — прогресс разового бэкфилла истории.
export interface BackfillProgress {
  processed: number;
  total: number;
  running: boolean;
  cancelled: boolean;
}

// Индикатор качества индекса умного поиска (см. HistoryManager.ts::countHistoryWithContent) —
// withContent считает страницы с реально извлечённым текстом, не только заголовок+домен
// (который получает КАЖДАЯ проиндексированная строка, включая шумные/непроверенные).
export interface HistoryContentCoverage {
  withContent: number;
  total: number;
}

// ── Загрузки ─────────────────────────────────────────────────────────────────
