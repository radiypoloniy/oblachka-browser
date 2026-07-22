// Рискованный бэкфилл: тихое переоткрытие уже накопленных URL в скрытой фоновой вьюхе, чтобы
// забрать полный текст страницы для history_content_chunks (обычный HistoryBackfill.ts даёт
// только заголовок+домен, см. его комментарий). Запускается ТОЛЬКО по явному, отдельному
// действию пользователя в Settings.tsx — с явным предупреждением в UI, никогда автоматически.
//
// Риски, которые здесь сознательно приняты (обсуждено с пользователем перед реализацией):
// - сайт может успел разлогинить/показать капчу/уже не существовать — тихо пропускаем,
//   не ретраим в рамках одного прогона;
// - вьюха скрыта (нулевые bounds), но живая — реально грузит сеть и исполняет JS страницы,
//   с той же сессией/куками, что у обычных вкладок (иначе половина сайтов дала бы логин-стену
//   ещё до открытия);
// - permission-запросы и загрузки файлов с таких страниц должны молча отклоняться, не всплывать
//   в UI как будто это сделал пользователь — см. BackgroundWebContents.ts + PermissionManager.ts/
//   DownloadManager.ts.
import { WebContentsView } from 'electron';
import type { BrowserWindow } from 'electron';
import type { HistoryManager } from './HistoryManager';
import { TEXT_EXTRACTION_VERSION } from './HistoryManager';
import type { BackfillProgress } from '../shared/ipc';
import { isNoisyForEmbedding } from './HistoryNoiseFilter';
import { extractEnrichedText, buildTextChunks } from './HistoryIndexer';
import { markBackground, unmarkBackground } from './BackgroundWebContents';

// Заметно консервативнее лёгкого бэкфилла (HistoryBackfill.ts::PAUSE_BETWEEN_CHUNKS_MS): там
// один embed()-вызов на строку, здесь — полная загрузка страницы (сеть + JS) на каждую. Пауза
// после каждой страницы, не пачками — эта работа тяжелее для CPU/сети, чем один текстовый вызов.
const PAUSE_BETWEEN_PAGES_MS = 1500;

// Общий бюджет на loadURL() одной страницы — отдельно от таймаутов внутри extractEnrichedText
// (did-finish-load + SPA-settle, см. HistoryIndexer.ts). Страница, которая не грузится вообще
// (DNS/редирект в никуда/зависший сервер), не должна остановить весь прогон.
const PAGE_LOAD_TIMEOUT_MS = 15_000;

// Прямые ссылки на файлы — не открываем: даже с молчаливой отменой в DownloadManager.ts (см. его
// комментарий) сама навигация на бинарник — трата сети без единого шанса на текст.
const SKIP_URL_EXT_RE = /\.(pdf|zip|rar|7z|exe|dmg|msi|apk|mp3|mp4|mkv|avi|mov|iso|docx?|xlsx?|pptx?)(\?|#|$)/i;

let running = false;
let cancelRequested = false;
let onProgress: ((p: BackfillProgress) => void) | null = null;

export function isContentBackfillRunning(): boolean {
  return running;
}

export function setContentBackfillProgressListener(cb: ((p: BackfillProgress) => void) | null): void {
  onProgress = cb;
}

export function cancelContentBackfill(): void {
  cancelRequested = true;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

// Создаёт вьюху, грузит URL, возвращает её или null при неудаче (навигация не удалась/не
// успела/окно закрылось). Не добавляет запись в историю навигации — это не «визит».
async function openHidden(win: BrowserWindow, url: string): Promise<WebContentsView | null> {
  if (win.isDestroyed()) return null;
  const view = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  markBackground(view.webContents.id);
  win.contentView.addChildView(view);
  // Нулевые bounds — тот же приём, что уже используется для скрытия WebContentsView (см.
  // App.tsx::pushBounds про Загрузки): вьюха живая (грузит/исполняет JS), просто невидима.
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

  try {
    const ok = await withTimeout(view.webContents.loadURL(url).then(() => true), PAGE_LOAD_TIMEOUT_MS);
    if (!ok || view.webContents.isDestroyed()) { closeHidden(win, view); return null; }
  } catch {
    // DNS/редирект/HTTP-ошибка и т.п. — страница мертва или недоступна, тихо пропускаем.
    closeHidden(win, view);
    return null;
  }
  return view;
}

function closeHidden(win: BrowserWindow, view: WebContentsView): void {
  unmarkBackground(view.webContents.id);
  try { if (!win.isDestroyed()) win.contentView.removeChildView(view); } catch { /* окно могло закрыться */ }
  try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch { /* уже закрыт */ }
}

export async function startContentBackfill(history: HistoryManager, win: BrowserWindow): Promise<void> {
  if (running) return;
  running = true;
  cancelRequested = false;

  const rows = history.getHistoryWithoutContent();
  const total = rows.length;
  let processed = 0;
  const report = (extra: Partial<BackfillProgress> = {}) =>
    onProgress?.({ processed, total, running: true, cancelled: false, ...extra });
  report();

  try {
    for (const row of rows) {
      if (cancelRequested) break;
      if (win.isDestroyed()) break;

      // Шумные (логин/OAuth/голый домен) и прямые ссылки на файлы — не открываем вообще,
      // не только не индексируем результат (экономит сеть и не рискует случайной загрузкой).
      if (isNoisyForEmbedding(row.url, row.title) || SKIP_URL_EXT_RE.test(row.url)) {
        processed++;
        report();
        continue;
      }

      const view = await openHidden(win, row.url);
      if (view) {
        try {
          const enrichedText = await extractEnrichedText(view.webContents, row.url);
          if (enrichedText) {
            const chunks = buildTextChunks(enrichedText);
            // Векторные колонки (vector/dims) — NOT NULL, но мёртвые: эмбеддинги убраны из пути
            // индексации на этом этапе (см. git log), схему не мигрируем — пишем пустышку.
            const chunkInputs = chunks.map((chunkText, i) => ({
              chunkIndex: i, url: row.url, title: row.title,
              text: chunkText, vector: new Float32Array(0), dims: 0,
            }));
            history.saveContentChunks(row.id, chunkInputs, TEXT_EXTRACTION_VERSION);
          }
        } catch (e) {
          console.warn(`[HistoryContentBackfill] страница пропущена (${row.url}):`, (e as Error).message);
        } finally {
          closeHidden(win, view);
        }
      }

      processed++;
      report();

      if (cancelRequested || win.isDestroyed()) break;
      await wait(PAUSE_BETWEEN_PAGES_MS);
    }
  } finally {
    running = false;
    onProgress?.({ processed, total, running: false, cancelled: cancelRequested });
  }
}
