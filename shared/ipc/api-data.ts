// Контракт main ↔ renderer, часть data: Данные и сантехника: разрешения, пароли, загрузки, история, закладки, VPN, профили.
//
// ⚠️ Разрезано по ДОМЕНАМ, а не по объёму. Единый OblakoApi перевалил за 700 строк — порог, на
// котором список интерфейсов перестаёт читаться и начинает просматриваться. Домены выбраны те
// же, что у обработчиков в electron/ipc/ и у разделов документации, чтобы «где искать» был один
// вопрос, а не три.
//
// ⚠️ Сам OblakoApi по-прежнему ОДИН тип (api.ts наследует все части): звать его из renderer'а
// приходится как единое window.oblako, и дробить эту точку входа было бы правдой про файлы, а не
// про программу.
import type { BackfillProgress, BookmarkEntry, BookmarkFolderProposal, BookmarkImportResult, BookmarkImportSource, BookmarkNode, HistoryContentCoverage, CsvPasswordImport, ImportDataType, ImportRunResult, ImportSource } from './history';
import type { DownloadEntry } from './omnibox';
import type { PermKey, PermissionRecord } from './ai';
import type { DefaultBrowserRequest } from './app';


export interface DataApi {
  // Разрешения сайтов. revokePermission без key забывает ВСЁ по сайту.
  listPermissions(): Promise<PermissionRecord[]>;
  setPermission(origin: string, key: PermKey, decision: 'granted' | 'denied'): Promise<void>;
  revokePermission(origin: string, key?: PermKey): Promise<void>;
  // Точка на щите: 'ask' — вопрос без ответа, 'blocked' — молча отказали по прежнему решению.
  permissionHint(origin: string): Promise<'ask' | 'blocked' | null>;
  onPermissionHintChanged(cb: () => void): () => void;
  // Путь файла, брошенного в интерфейс браузера. ⚠️ Не канал в main, а функция самого preload:
  // `File.path` из Electron убран, а `webUtils.getPathForFile` обязан зваться там, где живёт File.
  // Синхронная — единственная такая во всём API, поэтому и оговорка.
  droppedFilePath(file: File): string | null;
  // Сайты, которым человек сам разрешил корень Минцифры (см. electron/CertTrustStore.ts) — соседи
  // разрешений по разделу настроек и по смыслу. Вшитый список банков сюда не входит: он не
  // отзывается и в интерфейсе не показывается. Добавления снаружи нет — только отзыв, см. IPC.
  listCertTrust(): Promise<Array<{ domain: string; addedAt: number }>>;
  removeCertTrust(domain: string): Promise<boolean>;

  listBookmarks(): Promise<BookmarkEntry[]>;
  // Дерево целиком — режим «Закладки» в сайдбаре рисует его сам, поэтому уровни не догружает.
  listBookmarkTree(): Promise<BookmarkNode[]>;
  // Звезда в омнибоксе и Ctrl+D: сохранить активную страницу и предложить папку. Адрес и
  // заголовок берёт сам main — у него активная вкладка под рукой, а рендереру пришлось бы их
  // передавать и рисковать разъехаться с реальной страницей.
  showBookmarkMenu(): Promise<void>;
  createBookmarkFolder(title: string, parentId: number | null): Promise<BookmarkEntry | null>;
  renameBookmark(id: number, title: string): Promise<boolean>;
  // Перенос в другого родителя, в конец уровня. Порядок внутри уровня — отдельно, reorderBookmarks.
  moveBookmark(id: number, parentId: number | null): Promise<boolean>;
  reorderBookmarks(parentId: number | null, orderedIds: number[]): Promise<boolean>;
  // Только считает. Пустой массив — законный исход: осмысленных папок не нашлось.
  suggestBookmarkFolders(): Promise<BookmarkFolderProposal[]>;
  // Выполняет уже ОДОБРЕННОЕ человеком. Возвращает, сколько закладок реально разложено.
  applyBookmarkFolders(proposals: BookmarkFolderProposal[]): Promise<number>;
  isBookmarked(url: string): Promise<boolean>;
  onBookmarksChanged(cb: () => void): () => void;
  // Импорт из других браузеров (см. electron/bookmarkImport/) — пока только Chromium-семейство.
  listBookmarkImportSources(): Promise<BookmarkImportSource[]>;
  runBookmarkImport(sourceId: string): Promise<BookmarkImportResult | null>;

  // Общий мультитиповый импорт (закладки/история/пароли) — диалог импорта + онбординг первого
  // запуска (см. electron/browserImport/). Отдельно от bookmark-only каналов выше.
  listImportSources(): Promise<ImportSource[]>;
  runImport(sourceId: string, dataTypes: ImportDataType[]): Promise<ImportRunResult>;
  // Пароли из CSV-экспорта другого браузера — единственный путь для Chrome 127+ (App-Bound v20),
  // чьи пароли с диска не читаются без прав SYSTEM. Диалог выбора файла открывает main.
  importPasswordsCsv(): Promise<CsvPasswordImport>;
  // «Навести порядок», вторая половина: имена вкладок по содержимому. Прогресс приходит
  // отдельным push'ем, сами имена — обычным SYNC_CHANGED по мере готовности.
  renameAllTabs(): Promise<void>;
  rollbackRenames(): Promise<void>;
  onRenameProgress(cb: (p: { done: number; total: number }) => void): () => void;

  // Экран первого запуска (см. ONBOARDING_SHOULD_SHOW): рассказ о браузере и перенос данных.
  shouldShowOnboarding(): Promise<boolean>;
  markOnboardingShown(): Promise<void>;

  // Открыть приложение панели (калькулятор, конвертер…) с рабочего стола новой вкладки.
  openPanelApp(appId: string): Promise<void>;
  /** Курс валюты за последние N дней (для графика в виджете). Пустой массив — данных нет. */
  getCurrencyHistory(code: string, days?: number): Promise<number[]>;
  /** То же для криптоактива по тикеру (BTC, ETH…). */
  getCryptoHistory(ticker: string, days?: number): Promise<number[]>;

  // Спрашивать ли, куда сохранять каждый файл.
  getAskDownloadLocation(): Promise<boolean>;
  setAskDownloadLocation(value: boolean): Promise<void>;

  // Браузер по умолчанию. requestDefaultBrowser открывает системный выбор и возвращает, что
  // именно произошло, — назначить себя молча Windows не даёт (см. electron/DefaultBrowser.ts).
  isDefaultBrowser(): Promise<boolean>;
  requestDefaultBrowser(): Promise<DefaultBrowserRequest>;

  // Индикатор качества индекса умного поиска — сколько страниц реально имеют извлечённый текст.
  getHistoryContentCoverage(): Promise<HistoryContentCoverage>;

  // Рискованный бэкфилл полного текста (electron/HistoryContentBackfill.ts) — тихое переоткрытие
  // старых URL. Тот же прогресс-контракт (BackfillProgress), но
  // отдельные каналы/методы — это независимый, гораздо более тяжёлый и рискованный процесс.
  startHistoryContentBackfill(): void;
  cancelHistoryContentBackfill(): void;
  getHistoryContentBackfillStatus(): Promise<BackfillProgress>;
  onHistoryContentBackfillProgress(cb: (p: BackfillProgress) => void): () => void;

  // Разрешений здесь нет: и вопрос, и ответ живут в собственной вью поповера
  // (electron/PermissionPopoverManager.ts + preload-permissionpopover.ts).

  // Загрузки
  getDownloads(): Promise<DownloadEntry[]>;
  pauseDownload(id: string): Promise<void>;
  resumeDownload(id: string): Promise<void>;
  cancelDownload(id: string): Promise<void>;
  clearDownload(id: string): Promise<void>;
  openDownloadFile(id: string): Promise<void>;
  showDownloadFolder(id: string): Promise<void>;
  retryDownload(id: string): Promise<void>;
  onDownloadsChanged(cb: (entries: DownloadEntry[]) => void): () => void;
  onDownloadsOpen(cb: () => void): () => void;
}
