import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { executeHistoryRead } from './HistoryReadQueries';
import type { HistoryReadRequest } from './HistoryReadQueries';

// Только чтение. Миграции, запись FTS и управление файлами остаются у HistoryManager в main.
const db = new Database(workerData.dbPath as string, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');
parentPort?.on('message', (message: { id: number; request: HistoryReadRequest }) => {
  try {
    parentPort?.postMessage({ id: message.id, value: executeHistoryRead(db, message.request) });
  } catch (error) {
    parentPort?.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
});
