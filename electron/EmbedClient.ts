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
    p.resolve({ vector: res.vector, dims: res.dims, modelVersion: res.modelVersion });
  });
}

// Одна фраза → один вектор. Реджектит по таймауту или если chromeView недоступен (окно
// закрыто/уничтожается) — вызывающая сторона (HistoryIndexer и т.п.) сама решает, что делать
// с ошибкой (обычно: залогировать и оставить запись неиндексированной до следующей попытки).
export function requestEmbedding(text: string): Promise<EmbedResult> {
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
    chromeViewRef.webContents.send(IPC.EMBED_REQUEST, { requestId, text });
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
