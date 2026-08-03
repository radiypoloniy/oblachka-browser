import type { Session, DownloadItem } from 'electron';
import { app, dialog, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DownloadEntry } from '../shared/ipc';
import { isBackgroundWebContents } from './BackgroundWebContents';
import { markDownloadedFile, isRiskyDownload } from './DownloadSafety';

// Минимальный интервал отправки обновлений прогресса в renderer.
// Каждый байт не шлём — слишком шумно.
const THROTTLE_MS = 200;

// Потолок хранимого списка. Загрузки — не история посещений: держать их тысячами незачем,
// а файл читается синхронно при старте, и распухать ему нельзя.
const MAX_STORED = 300;

// Запись на диске. Отдельная от DownloadEntry форма: бегущие поля (скорость, пауза) —
// свойство МОМЕНТА, а не загрузки, и после перезапуска не значат ничего.
interface StoredDownload {
  id: string;
  filename: string;
  url: string;
  savePath: string;
  mime: string;
  totalBytes: number;
  receivedBytes: number;
  state: DownloadEntry['state'];
  startedAt: number;
}

// Свободное имя в папке загрузок: «отчёт.pdf» → «отчёт (1).pdf». ⚠️ Без этого второй файл с тем
// же именем молча затирал бы первый — Electron перезаписывает по заданному savePath без вопросов.
// Экспортируется ради снимков вкладки (ScreenshotManager.ts): они ложатся в ту же папку тем же
// правилом — два снимка в одну секунду не должны затирать друг друга.
export function uniquePath(dir: string, filename: string): string {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  for (let i = 1; fs.existsSync(candidate) && i < 1000; i++) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
  }
  return candidate;
}

export class DownloadManager {
  #entries = new Map<string, DownloadEntry>();
  #items   = new Map<string, DownloadItem>(); // только активные (not 'done')
  // Загрузки из инкогнито: живут в списке до конца сеанса, но на диск не попадают. Файл человек
  // сохранил сам и он никуда не денется, а вот ССЫЛКА в постоянном файле — уже след приватной
  // вкладки, ради отсутствия которого её и открывают (так же поступает Chrome).
  #incognitoIds = new Set<string>();
  #loaded = false;
  #session: Session | null = null;
  #onChange: ((entries: DownloadEntry[]) => void) | null = null;
  // Спрашивать ли, куда сохранять. По умолчанию НЕТ: системный диалог на каждую картинку с
  // фотостока — самое частое раздражение в браузере, и ни один массовый браузер так не делает.
  // Настройка остаётся для тех, кто раскладывает файлы по папкам вручную.
  #askLocation = false;
  #throttleTimer: ReturnType<typeof setTimeout> | null = null;

  setAskLocation(value: boolean): void {
    this.#askLocation = value;
  }

  attach(sess: Session, onChange: (entries: DownloadEntry[]) => void): void {
    this.#session = sess;
    this.#onChange = onChange;
    this.#ensureLoaded();
    this.#wireWillDownload(sess, false);
  }

  // Наблюдать загрузки ещё одной сессии (инкогнито), не делая её основной: перехват will-download
  // тот же, но #session (для retry/downloadURL) остаётся дефолтной. Загрузки из инкогнито попадают
  // в тот же список на время сеанса, но не в файл на диске — см. #incognitoIds.
  observeSession(sess: Session): void {
    this.#wireWillDownload(sess, true);
  }

  #wireWillDownload(sess: Session, incognito: boolean): void {
    sess.on('will-download', (_event, item, wc) => {
      // Фоновая (не пользователем открытая) вкладка — см. BackgroundWebContents.ts. Отменяем
      // молча: прямая ссылка на файл на переоткрытой в фоне странице не должна класть файл
      // пользователю в Загрузки без его ведома.
      if (isBackgroundWebContents(wc.id)) { item.cancel(); return; }

      // ⚠️ Путь задаём САМИ — иначе Electron показывает системный диалог «Сохранить как» на
      // каждый файл (именно так и было). setSavePath отменяет диалог целиком.
      const dir = app.getPath('downloads');
      const filename = item.getFilename();
      const risky = isRiskyDownload(filename);
      if (!this.#askLocation && !risky) {
        try { item.setSavePath(uniquePath(dir, filename)); }
        catch { /* путь недоступен — пусть Electron спросит сам, это лучше отмены */ }
      } else if (risky) {
        // Программы и скрипты — единственный случай, где вопрос уместен: цена ошибки не
        // «лишний файл в Загрузках», а запущенный чужой код. Так же поступает Chrome.
        const choice = dialog.showMessageBoxSync({
          type: 'warning',
          buttons: ['Отмена', 'Сохранить'],
          defaultId: 0,
          cancelId: 0,
          title: 'Подозрительный файл',
          message: `«${filename}» — программа или скрипт`,
          detail: 'Такие файлы могут навредить компьютеру. Сохраняйте их, только если доверяете источнику.',
        });
        if (choice !== 1) { item.cancel(); return; }
        try { item.setSavePath(uniquePath(dir, filename)); } catch { /* см. выше */ }
      }

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
      if (incognito) this.#incognitoIds.add(id);
      // Пишем уже на СТАРТЕ, а не только по завершении: иначе падение или закрытие браузера
      // посреди скачивания стирало бы саму память о нём, хотя недокачанный файл на диске остался.
      // При чтении такая запись превращается в «Прервано» — см. #load.
      this.#persist();
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
        // Метка «файл из интернета» — сразу после успешного завершения, см. DownloadSafety.ts.
        if (e.state === 'completed' && e.savePath) markDownloadedFile(e.savePath, e.url);
        this.#persist();
        this.#notify();
      });
    });
  }

  getAll(): DownloadEntry[] {
    this.#ensureLoaded();
    return [...this.#entries.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  pause(id: string):  void { this.#items.get(id)?.pause(); }
  resume(id: string): void { this.#items.get(id)?.resume(); }
  cancel(id: string): void { this.#items.get(id)?.cancel(); }

  clear(id: string): void {
    this.#entries.delete(id);
    this.#items.delete(id);
    this.#incognitoIds.delete(id);
    this.#persist();
    this.#notify();
  }

  openFile(id: string): void {
    if (!this.#stillOnDisk(id)) return;
    const e = this.#entries.get(id);
    if (e?.savePath) void shell.openPath(e.savePath);
  }

  showFolder(id: string): void {
    if (!this.#stillOnDisk(id)) return;
    const e = this.#entries.get(id);
    if (e?.savePath) shell.showItemInFolder(e.savePath);
  }

  // Файл могли удалить уже ПОСЛЕ чтения списка, поэтому проверка повторяется в момент клика:
  // отметку в строке надо поправить сразу, а не молча ничего не открыть.
  #stillOnDisk(id: string): boolean {
    const e = this.#entries.get(id);
    if (!e?.savePath) return false;
    const exists = fs.existsSync(e.savePath);
    if (e.fileMissing !== !exists) {
      e.fileMissing = !exists;
      this.#notify();
    }
    return exists;
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

  // ── Хранение списка между запусками ────────────────────────────────────────
  //
  // Своего файла-хранилища класса тут нет намеренно: писать нечего, кроме одного плоского
  // массива, а SQLite (как у истории и закладок) — несоразмерная машинерия ради трёх сотен строк.
  //
  // ⚠️ Читается ЛЕНИВО, а не в конструкторе: менеджер создаётся на уровне модуля в main.ts,
  // то есть до app.whenReady(), и лезть за userData оттуда — просить гонку на ровном месте.

  #storePath(): string {
    return path.join(app.getPath('userData'), 'downloads.json');
  }

  #ensureLoaded(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    let arr: unknown;
    try { arr = JSON.parse(fs.readFileSync(this.#storePath(), 'utf8')); }
    catch { return; /* файла ещё нет или он битый — начинаем с пустого списка */ }
    if (!Array.isArray(arr)) return;

    for (const raw of arr as StoredDownload[]) {
      if (!raw || typeof raw.id !== 'string' || typeof raw.filename !== 'string') continue;
      this.#entries.set(raw.id, {
        id: raw.id,
        filename: raw.filename,
        url: typeof raw.url === 'string' ? raw.url : '',
        savePath: typeof raw.savePath === 'string' ? raw.savePath : '',
        mime: typeof raw.mime === 'string' ? raw.mime : '',
        totalBytes: Number(raw.totalBytes) || 0,
        receivedBytes: Number(raw.receivedBytes) || 0,
        // Незавершённая с прошлого запуска — именно «прервано», а не «идёт»: DownloadItem
        // мёртв вместе с процессом, докачивать нечем, и висящий вечный прогресс был бы враньём.
        state: raw.state === 'completed' || raw.state === 'cancelled' ? raw.state : 'interrupted',
        startedAt: Number(raw.startedAt) || 0,
        isPaused: false,
        bytesPerSec: 0,
        fileMissing: raw.state === 'completed' && !!raw.savePath && !fs.existsSync(raw.savePath),
      });
    }
  }

  #persist(): void {
    const data: StoredDownload[] = this.getAll()
      .filter((e) => !this.#incognitoIds.has(e.id))
      .slice(0, MAX_STORED)
      .map((e) => ({
        id: e.id,
        filename: e.filename,
        url: e.url,
        savePath: e.savePath,
        mime: e.mime,
        totalBytes: e.totalBytes,
        receivedBytes: e.receivedBytes,
        state: e.state,
        startedAt: e.startedAt,
      }));
    // tmp + rename — тот же приём атомарной записи, что в BangStore/SettingsManager.
    const target = this.#storePath();
    try {
      fs.writeFileSync(target + '.tmp', JSON.stringify(data), 'utf8');
      fs.renameSync(target + '.tmp', target);
    } catch (e) {
      console.error('[downloads] не удалось сохранить список:', (e as Error).message);
    }
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
