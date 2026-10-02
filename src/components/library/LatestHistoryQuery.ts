import type { HistoryEntry } from '../../../shared/ipc';

interface QueryJob {
  query: string;
  isCurrent: () => boolean;
  resolve: (entries: HistoryEntry[] | undefined) => void;
  reject: (error: unknown) => void;
}

// Очередь принадлежит одному разделу истории: чужой поиск и AI не отменяются.
// undefined означает устаревший запрос, а [] остаётся настоящим пустым результатом.
export class LatestHistoryQuery {
  #running = false;
  #waiting: QueryJob | null = null;

  constructor(private readonly read: (query: string) => Promise<HistoryEntry[]>) {}

  run(query: string, isCurrent: () => boolean): Promise<HistoryEntry[] | undefined> {
    return new Promise((resolve, reject) => {
      const job = { query, isCurrent, resolve, reject };
      if (this.#running) {
        this.#waiting?.resolve(undefined);
        this.#waiting = job;
      } else {
        void this.#dispatch(job);
      }
    });
  }

  async #dispatch(job: QueryJob): Promise<void> {
    this.#running = true;
    try {
      // Размонтирование, смена профиля или запуск AI инвалидируют поколение даже без
      // следующего обычного поиска. Такой запрос не должен доходить до IPC/SQLite.
      if (!job.isCurrent()) { job.resolve(undefined); return; }
      const entries = await this.read(job.query);
      job.resolve(job.isCurrent() ? entries : undefined);
    } catch (error) {
      if (job.isCurrent()) job.reject(error); else job.resolve(undefined);
    } finally {
      this.#running = false;
      const next = this.#waiting;
      this.#waiting = null;
      if (next) void this.#dispatch(next);
    }
  }
}
