import type { Session, DownloadItem } from 'electron';
import { shell } from 'electron';
import { randomUUID } from 'node:crypto';
import type { DownloadEntry } from '../shared/ipc';

// Минимальный интервал отправки обновлений прогресса в renderer.
// Каждый байт не шлём — слишком шумно.
const THROTTLE_MS = 200;

export class DownloadManager {
  #entries = new Map<string, DownloadEntry>();
  #items   = new Map<string, DownloadItem>(); // только активные (not 'done')
  #session: Session | null = null;
  #onChange: ((entries: DownloadEntry[]) => void) | null = null;
  #throttleTimer: ReturnType<typeof setTimeout> | null = null;

  attach(sess: Session, onChange: (entries: DownloadEntry[]) => void): void {
    this.#session = sess;
    this.#onChange = onChange;

    sess.on('will-download', (_event, item) => {
      const id = randomUUID();
      const entry: DownloadEntry = {
        id,
        filename: item.getFilename(),
        url: item.getURL(),
        savePath: '',
        mime: item.getMimeType(),
        totalBytes: item.getTotalBytes(),
        receivedBytes: 0,
        state: 'progressing',
        startedAt: Date.now(),
        isPaused: false,
        bytesPerSec: 0,
      };
      this.#entries.set(id, entry);
      this.#items.set(id, item);
      this.#notify();

      let lastReceived = 0;
      let lastTime = Date.now();

      item.on('updated', (_e, state) => {
        const e = this.#entries.get(id);
        if (!e) return;
        const now = Date.now();
        const recv = item.getReceivedBytes();
        const dt = now - lastTime;
        // dt > 50 чтобы не делить на почти-ноль в первом коллбэке
        if (dt > 50) {
          e.bytesPerSec = Math.round((recv - lastReceived) / dt * 1000);
          lastReceived = recv;
          lastTime = now;
        }
        e.state = state === 'progressing' ? 'progressing' : 'interrupted';
        e.receivedBytes = recv;
        e.totalBytes = item.getTotalBytes();
        e.isPaused = item.isPaused();
        this.#notifyThrottled();
      });

      item.once('done', (_e, state) => {
        const e = this.#entries.get(id);
        if (!e) return;
        this.#items.delete(id);
        // DownloadItem не даёт явного error — treat interrupted/cancelled как провал
        e.state = state === 'completed' ? 'completed'
          : state === 'cancelled' ? 'cancelled'
          : 'interrupted';
        e.receivedBytes = item.getReceivedBytes();
        e.totalBytes    = item.getTotalBytes();
        e.savePath      = item.getSavePath();
        e.isPaused      = false;
        e.bytesPerSec   = 0;
        this.#notify();
      });
    });
  }

  getAll(): DownloadEntry[] {
    return [...this.#entries.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  pause(id: string):  void { this.#items.get(id)?.pause(); }
  resume(id: string): void { this.#items.get(id)?.resume(); }
  cancel(id: string): void { this.#items.get(id)?.cancel(); }

  clear(id: string): void {
    this.#entries.delete(id);
    this.#items.delete(id);
    this.#notify();
  }

  openFile(id: string): void {
    const e = this.#entries.get(id);
    if (e?.savePath) void shell.openPath(e.savePath);
  }

  showFolder(id: string): void {
    const e = this.#entries.get(id);
    if (e?.savePath) shell.showItemInFolder(e.savePath);
  }

  // Повторная загрузка: убираем старую запись и инициируем новую через сессию.
  // Resume докачивает только при поддержке range-запросов сервером — здесь всегда fresh start.
  retry(id: string): void {
    const e = this.#entries.get(id);
    if (!e || !this.#session) return;
    const url = e.url;
    this.clear(id);
    void this.#session.downloadURL(url);
  }

  #notify(): void {
    this.#onChange?.(this.getAll());
  }

  #notifyThrottled(): void {
    if (this.#throttleTimer) return;
    this.#throttleTimer = setTimeout(() => {
      this.#throttleTimer = null;
      this.#notify();
    }, THROTTLE_MS);
  }
}
