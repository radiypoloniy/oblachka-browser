import { app } from 'electron';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { HistoryManager } from './HistoryManager';
import type { HistoryReadRequest, HistoryReadResults } from './HistoryReadQueries';
import { historySearchTopic } from './HistorySearchTopic';
import { prepareHistoryCandidateChunks } from './HistorySearchSnippet';

class HistoryReader {
  #worker: Worker | null = null;
  #nextId = 0;
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  #idle: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly dbPath: string) {}

  read(request: HistoryReadRequest): Promise<unknown> {
    if (this.#idle) { clearTimeout(this.#idle); this.#idle = null; }
    const worker = this.#worker ?? this.#start();
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try { worker.postMessage({ id, request }); } catch (error) {
        this.#pending.delete(id); reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  #start(): Worker {
    const worker = new Worker(path.join(__dirname, 'history-read-worker.js'), { workerData: { dbPath: this.dbPath } });
    this.#worker = worker;
    worker.on('message', (reply: { id: number; value?: unknown; error?: string }) => {
      const pending = this.#pending.get(reply.id);
      if (!pending) return;
      this.#pending.delete(reply.id);
      if (reply.error) pending.reject(new Error(reply.error)); else pending.resolve(reply.value);
      if (this.#pending.size === 0) {
        // Незадействованные профили не держат Node-воркер и соединение постоянно.
        this.#idle = setTimeout(() => this.close(), 60_000);
        this.#idle.unref();
      }
    });
    const fail = (error: Error) => {
      if (this.#worker !== worker) return;
      this.#worker = null;
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
    };
    worker.on('error', fail);
    worker.on('exit', code => fail(new Error(`History reader exited (${code})`)));
    return worker;
  }
  close(): void {
    if (this.#idle) clearTimeout(this.#idle);
    this.#idle = null;
    const worker = this.#worker;
    this.#worker = null;
    for (const pending of this.#pending.values()) pending.reject(new Error('History reader closed'));
    this.#pending.clear();
    if (worker) void worker.terminate();
  }
}

const readers = new WeakMap<HistoryManager, HistoryReader>();
const activeReaders = new Set<HistoryReader>();
app.on('before-quit', () => { for (const reader of activeReaders) reader.close(); });

export async function readHistory<R extends HistoryReadRequest>(history: HistoryManager, request: R): Promise<HistoryReadResults[R['kind']]> {
  const dbPath = history.readPath();
  // Без нативного SQLite сохраняем прежние пустые ответы. :memory: используется только
  // проверками: другое соединение не увидит их базу.
  if (dbPath === null || dbPath === ':memory:') {
    return readMemory(history, request) as HistoryReadResults[R['kind']];
  }
  let reader = readers.get(history);
  if (!reader) { reader = new HistoryReader(dbPath); readers.set(history, reader); activeReaders.add(reader); }
  // Тип результата определяется внутренним протоколом; неизвестное остаётся на границе воркера.
  return await reader.read(request) as HistoryReadResults[R['kind']];
}

function readMemory(history: HistoryManager, request: HistoryReadRequest): HistoryReadResults[keyof HistoryReadResults] {
  switch (request.kind) {
    case 'recent': return history.getRecent(request.limit);
    case 'search': return history.search(request.query, request.limit);
    case 'coverage': return history.getContentCoverage();
    case 'candidates': {
      const topic = historySearchTopic(request.query);
      return {
        chunks: prepareHistoryCandidateChunks(history.searchContentChunksFts(topic, request.version, request.ftsLimit), topic),
        lexical: history.search(request.query, request.lexicalLimit),
      };
    }
  }
}

export function closeHistoryReaders(): void {
  for (const reader of activeReaders) reader.close();
}
