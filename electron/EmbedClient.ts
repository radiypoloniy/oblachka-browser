// Мост main→renderer→main для эмбеддингов (заход G). embeddingService (WASM/WebGPU worker)
// требует DOM lib и живёт только в renderer — electron/main.ts не может позвать его напрямую
// (electron/tsconfig.json: lib: ["ES2022"], без DOM; main-процесс — обычный Node, не Chromium
// renderer). Этот модуль просит renderer (chromeView) посчитать эмбеддинг и ждёт ответ по
// IPC.EMBED_RESPONSE, коррелируя запросы по requestId. Общий транспорт: не знает, кто и зачем
// просит вектор — используется индексатором истории и (позже) семантическим поиском (блок 6).
import { ipcMain } from 'electron';
import type { WebContentsView } from 'electron';
import { IPC } from '../shared/ipc';
import type { EmbedResponsePayload } from '../shared/ipc';

// Холодный старт модели в renderer ~3-6с (см. замеры захода F) — таймаут с запасом, чтобы не
// рубить легитимный первый запрос после старта приложения.
const REQUEST_TIMEOUT_MS = 20_000;

// EmbeddingGemma (см. src/services/EmbeddingService.ts::MODELS.embeddinggemma) обучена с
// task-префиксами (модельная карта Google) — без них модель работает вне обученного режима.
// Диагностика от 2026-07-2x: без префиксов cosine на этом корпусе структурно не давал сигнала —
// фиксированный набор generic-«магнитов» доминировал топ на ЛЮБОЙ запрос независимо от смысла.
// Единственное место, где префикс приклеивается — здесь, не в вызывающем коде (HistorySearch/
// HistoryIndexer/HistoryBackfill/HistoryContentBackfill): если размазать по вызывающим местам,
// следующий новый вызов requestEmbedding() его забудет, и порча вернётся молча, без единой
// точки, которую можно проверить или починить.
const QUERY_PREFIX = 'task: search result | query: ';
const DOCUMENT_PREFIX = 'title: none | text: ';

function applyTaskPrefix(text: string, kind: 'query' | 'document'): string {
  return (kind === 'query' ? QUERY_PREFIX : DOCUMENT_PREFIX) + text;
}

// ⚠️ Вектора с префиксом и без — разные пространства, несравнимые между собой (не косметика).
// Суффикс версии — ЕДИНСТВЕННЫЙ способ не дать новому cosine сравниваться со старыми
// непрефиксованными векторами: HistoryManager.ts фильтрует выборку по model_version на каждом
// пути (getAllEmbeddings/getAllContentChunks/searchContentChunksFts — см. отчёт диагностики),
// так что старые записи станут невидимы для поиска до пересчёта — это НАМЕРЕННЫЙ эффект смены
// версии, не побочный. Пересчёт истории (сам backfill) — отдельная задача, не этот коммит.
const MODEL_VERSION_SUFFIX = '+prefixed';

export interface EmbedResult {
  vector: Float32Array;
  dims: number;
  modelVersion: string;
}

interface Pending {
  resolve: (r: EmbedResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

let chromeViewRef: WebContentsView | null = null;
let nextRequestId = 1;
const pending = new Map<number, Pending>();
let ipcRegistered = false;

// Вызывается из main.ts везде, где меняется chromeView (создание/обнуление при закрытии окна) —
// тот же приём, что setTabManager у AiPanelManager.ts/FindBarManager.ts.
export function setChromeView(view: WebContentsView | null): void {
  chromeViewRef = view;
}

// Заход G, блок 5: бэкфиллу нужно самому решить остановиться, если окно закрывается —
// иначе он молотил бы requestEmbedding() по всем оставшимся строкам подряд, каждая мгновенно
// падала бы с одной и той же «chromeView недоступен» вместо одной явной остановки.
export function isAvailable(): boolean {
  return !!chromeViewRef && !chromeViewRef.webContents.isDestroyed();
}

function ensureIpcRegistered(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.on(IPC.EMBED_RESPONSE, (_e, res: EmbedResponsePayload) => {
    const p = pending.get(res.requestId);
    if (!p) return; // таймаут уже отработал, или окно переоткрылось — тихо игнорируем
    clearTimeout(p.timer);
    pending.delete(res.requestId);
    if (!res.ok) { p.reject(new Error(res.error)); return; }
    // Суффикс здесь, не в EmbeddingService.ts/EmbedRequestBridge.ts (renderer) — тот канал не
    // знает о префиксах вообще, эмбеддит любой текст, что ему прислали. Единая точка применяется
    // к обоим потребителям pending (requestEmbedding И requestEmbeddingModelVersion ниже) —
    // иначе activeModelVersion в HistoryBackfill.ts разошлась бы с реальной версией эмбеддингов.
    p.resolve({ vector: res.vector, dims: res.dims, modelVersion: res.modelVersion + MODEL_VERSION_SUFFIX });
  });
}

// Одна фраза → один вектор. Реджектит по таймауту или если chromeView недоступен (окно
// закрыто/уничтожается) — вызывающая сторона (HistoryIndexer и т.п.) сама решает, что делать
// с ошибкой (обычно: залогировать и оставить запись неиндексированной до следующей попытки).
// kind — ОБЯЗАТЕЛЬНЫЙ, без значения по умолчанию: пропуск должен ловиться на компиляции, а не
// молча эмбеддить без префикса. 'query' — поисковый запрос пользователя (searchHistorySemantic/
// searchHistorySmart), 'document' — всё остальное (заголовок+hostname, текст страницы, чанк) —
// см. QUERY_PREFIX/DOCUMENT_PREFIX выше.
export function requestEmbedding(text: string, kind: 'query' | 'document'): Promise<EmbedResult> {
  ensureIpcRegistered();
  return new Promise((resolve, reject) => {
    if (!chromeViewRef || chromeViewRef.webContents.isDestroyed()) {
      reject(new Error('EmbedClient: chromeView недоступен'));
      return;
    }
    const requestId = nextRequestId++;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`EmbedClient: таймаут ${REQUEST_TIMEOUT_MS}ms (requestId=${requestId})`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
    chromeViewRef.webContents.send(IPC.EMBED_REQUEST, { requestId, text: applyTaskPrefix(text, kind) });
  });
}

export function requestEmbeddingModelVersion(): Promise<string> {
  ensureIpcRegistered();
  return new Promise((resolve, reject) => {
    if (!chromeViewRef || chromeViewRef.webContents.isDestroyed()) {
      reject(new Error('EmbedClient: chromeView недоступен'));
      return;
    }
    const requestId = nextRequestId++;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`EmbedClient: таймаут ${REQUEST_TIMEOUT_MS}ms (requestId=${requestId})`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, {
      resolve: (r) => resolve(r.modelVersion),
      reject,
      timer,
    });
    chromeViewRef.webContents.send(IPC.EMBED_REQUEST, { requestId, text: '', modelVersionOnly: true });
  });
}
