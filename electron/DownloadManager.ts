import type { Session, DownloadItem, WebContents } from 'electron';
import { app, dialog, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DownloadEntry, DuplicateDownloadPrompt } from '../shared/ipc';
import { isBackgroundWebContents } from './BackgroundWebContents';
import { markDownloadedFile, isRiskyDownload } from './DownloadSafety';
import { profileDataPath } from './ProfilePaths';
import { getActiveProfile } from './ProfileStore';

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
/**
 * Адрес без запроса и якоря — «тот же файл» для подписанных ссылок (см. #findDownloaded).
 *
 * ⚠️ Пустую строку возвращаем для всего, что не http(s): у `blob:` и `data:` идентификатор
 * уникален для каждого создания, и совпадение по «пути» означало бы там ровно ничего.
 */
function stripQuery(u: string): string {
  try {
    const p = new URL(u);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return '';
    return p.origin + p.pathname;
  } catch { return ''; }
}

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
  // Отменённые до ответа повторные загрузки: ждём решения человека. Ключ — id вопроса.
  #pendingDuplicates = new Map<string, { url: string; wc: WebContents; already: DownloadEntry }>();
  // Адреса, для которых человек уже сказал «всё равно загрузить»: ровно один пропуск вопроса,
  // иначе повторный запуск загрузки спросил бы снова и так по кругу.
  #approvedOnce = new Set<string>();
  // Кто задаёт вопрос. ⚠️ Менеджер про поповеры не знает — main отдаёт ему готовый колбэк (тот же
  // приём, что с меню графа у TabManager). wc нужен, чтобы вопрос всплыл в ТОМ окне, где качают.
  #onDuplicate: ((wc: WebContents, prompt: DuplicateDownloadPrompt) => void) | null = null;

  /** Подключает показ вопроса о повторной загрузке (см. main.ts). */
  setDuplicatePrompt(fn: (wc: WebContents, prompt: DuplicateDownloadPrompt) => void): void {
    this.#onDuplicate = fn;
  }
  #items   = new Map<string, DownloadItem>(); // только активные (not 'done')
  // Загрузки из инкогнито: живут в списке до конца сеанса, но на диск не попадают. Файл человек
  // сохранил сам и он никуда не денется, а вот ССЫЛКА в постоянном файле — уже след приватной
  // вкладки, ради отсутствия которого её и открывают (так же поступает Chrome).
  #incognitoIds = new Set<string>();
  // Чья это загрузка. ⚠️ Список загрузок — НА ПРОФИЛЬ (см. #storePath): запись это адрес, имя
  // файла и время, то есть та же строка истории, только говорящая громче («договор_ООО.pdf»).
  // Разделив историю и оставив загрузки общими, мы бы оставили дыру ровно там, где человек
  // проверит обещание первым делом.
  // ⚠️ Изоляция здесь про СЛЕДЫ И ПОРЯДОК, а не про защиту: сами файлы лежат в общей системной
  // папке «Загрузки», и профиль их не прячет. Обещать иное нельзя.
  #profileOf = new Map<string, string>();
  // Файлы каких профилей уже прочитаны с диска. Читаем лениво и по одному: качать в чужом
  // профиле человек может годами не начать, а список грузится синхронно.
  #loadedProfiles = new Set<string>();
  // ⚠️ Сессии, на которые слушатель уже навешен. Без этого множества сессия основного профиля
  // получала ДВА `will-download` — один от attach (активный профиль), другой от observeSession
  // (обвязка того же профиля в wireProfileSession), — и каждая загрузка попадала в список
  // дважды. WeakSet, а не Set: сессия профиля живёт своей жизнью, держать её здесь незачем.
  #wiredSessions = new WeakSet<Session>();
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

  /**
   * Спросить место ОДИН РАЗ, для следующей загрузки этого адреса — пункт ПКМ «Сохранить как…».
   *
   * ⚠️ Нужен обход общего тумблера, а не его включение: тумблер выключен по умолчанию (диалог на
   * каждую картинку с фотостока и был тем раздражением, ради которого его выключили), но пункт со
   * словом «как» обязан спрашивать всегда — иначе слово в названии обманывает, и выбрать место
   * стало нельзя вообще ничем. Рядом появился пункт «Сохранить картинку» без диалога.
   *
   * ⚠️ Разрешение ОДНОРАЗОВОЕ и снимается при срабатывании: адрес мог не дойти до загрузки вовсе
   * (сеть, отмена), и вечная пометка означала бы диалог когда-нибудь потом, без всякой связи с
   * действием человека.
   */
  askLocationOnce(url: string): void {
    if (url) this.#askOnceUrls.add(url);
  }

  #askOnceUrls = new Set<string>();

  attach(sess: Session, profileId: string, onChange: (entries: DownloadEntry[]) => void): void {
    this.#session = sess;
    this.#onChange = onChange;
    this.#ensureLoaded(profileId);
    this.#wireWillDownload(sess, profileId);
  }

  // Наблюдать загрузки ещё одной сессии (другой профиль, инкогнито), не делая её основной:
  // перехват will-download тот же, но #session (для retry/downloadURL) остаётся дефолтной.
  // profileId === null — приватная сессия: такие загрузки живут в списке до конца сеанса и на
  // диск не попадают (см. #incognitoIds), а показываются в том профиле, где их начали.
  observeSession(sess: Session, profileId: string | null): void {
    this.#wireWillDownload(sess, profileId);
  }

  /**
   * Человек переключил профиль — показать ЕГО список.
   *
   * ⚠️ Файл нового профиля читается здесь, а не при первом взгляде на поповер: рассылка уходит
   * тут же, и без чтения человек увидел бы пустой список там, где загрузки есть.
   */
  onProfileSwitched(profileId: string): void {
    this.#ensureLoaded(profileId);
    this.#notify();
  }

  /**
   * Уже скачанный тот же файл — или null.
   *
   * ⚠️ Совпадением считаем ЛИБО тот же адрес, ЛИБО то же имя с тем же размером: по одной ссылке
   * человек качает повторно чаще всего, но тот же файл он мог взять и с зеркала. Размер обязателен
   * во втором случае — «договор.pdf» бывает разным у разных отправителей.
   * ⚠️ Файл обязан лежать на диске: если человек его удалил или перенёс, повторная загрузка —
   * ровно то, чего он хочет, и спрашивать не о чем.
   * ⚠️ Приватные загрузки в поиске НЕ участвуют: они и в файл не пишутся (см. #incognitoIds), и
   * знать о них следующей сессии неоткуда — предупреждение из них сделало бы приватную вкладку
   * заметной снаружи.
   */
  #findDownloaded(url: string, filename: string, totalBytes: number, profileId: string): DownloadEntry | null {
    const wantedPath = stripQuery(url);
    for (const e of this.#entries.values()) {
      if (this.#incognitoIds.has(e.id)) continue;
      // ⚠️ Только СВОЙ профиль. Предупреждение «ты это уже качал» о файле из другого профиля
      // рассказало бы про чужую загрузку ровно то, что мы только что перестали показывать.
      if (this.#profileOf.get(e.id) !== profileId) continue;
      if (e.state !== 'completed' || !e.savePath) continue;
      // ⚠️ Адрес сравниваем И БЕЗ ЗАПРОСА тоже. Ссылки на файлы у крупных сервисов ПОДПИСАНЫ:
      // хост и путь постоянны (в пути лежит идентификатор файла), а подпись и срок годности живут
      // в query и меняются при каждом нажатии. Из-за точного сравнения такая повторная загрузка
      // выглядела совершенно новой, и предупреждение молчало — живой случай с картинками ChatGPT,
      // где на других сайтах всё отрабатывало штатно.
      const sameUrl = !!url && (e.url === url || (!!wantedPath && stripQuery(e.url) === wantedPath));
      const sameFile = e.filename === filename && totalBytes > 0 && e.totalBytes === totalBytes;
      if (!sameUrl && !sameFile) continue;
      try { if (!fs.existsSync(e.savePath)) continue; } catch { continue; }
      return e;
    }
    return null;
  }

  #wireWillDownload(sess: Session, profileId: string | null): void {
    if (this.#wiredSessions.has(sess)) return;
    this.#wiredSessions.add(sess);
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
      // «Сохранить как…» из ПКМ — путь не задаём вовсе, и Electron показывает системный диалог.
      const askOnce = this.#askOnceUrls.delete(item.getURL());
      if (!this.#askLocation && !askOnce && !risky) {
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
        // При «Сохранить как…» путь по-прежнему выбирает человек — предупреждение о риске его
        // выбора не отменяет, оно про другое.
        if (!askOnce) { try { item.setSavePath(uniquePath(dir, filename)); } catch { /* см. выше */ } }
      }

      // ⚠️ Повтор уже скачанного. Браузеры об этом молчат, и папка «Загрузки» обрастает
      // «отчёт.pdf», «отчёт (1).pdf», «отчёт (2).pdf» — человек качает второй раз просто потому,
      // что не помнит, качал ли.
      //
      // ⚠️ Спрашиваем СВОИМ поповером у значка загрузок, а не системным окном. Системный диалог
      // здесь был чужеродным и, главное, синхронным — он замораживал главный процесс вместе со
      // всеми вкладками. Поэтому загрузка ставится на паузу, а вопрос уходит наверх; пока ответа
      // нет, записи в списке не появляется вовсе — иначе отказ оставлял бы след «Отменено» о
      // файле, которого человек и не собирался качать второй раз.
      const url = item.getURL();
      const already = this.#approvedOnce.has(url)
        ? null
        : this.#findDownloaded(url, filename, item.getTotalBytes(), profileId ?? getActiveProfile().id);
      this.#approvedOnce.delete(url);
      if (already && this.#onDuplicate) {
        // ⚠️ Загрузку ОТМЕНЯЕМ, а не ставим на паузу. Пауза не спасает: маленький файл успевает
        // дойти до диска раньше, чем пауза применится, — замерено, второй файл появлялся, хотя
        // вопрос ещё висел на экране. Поэтому до ответа на диск не попадает ничего, а «всё равно
        // загрузить» запускает НОВУЮ загрузку того же адреса (одноразовое разрешение в
        // #approvedOnce не даёт спросить второй раз и уйти в цикл).
        try { item.cancel(); } catch { /* мог успеть завершиться */ }
        const askId = randomUUID();
        this.#pendingDuplicates.set(askId, { url, wc, already });
        this.#onDuplicate(wc, {
          askId,
          filename: already.filename,
          savePath: already.savePath,
          downloadedAt: already.startedAt,
        });
        return;
      }

      this.#registerItem(item, profileId);
    });
  }

  /**
   * Ответ на вопрос о повторной загрузке. ⚠️ Закрытие поповера мимо кнопок — это 'cancel':
   * человек ничего не выбрал, и качать второй раз «на всякий случай» нельзя.
   */
  resolveDuplicate(askId: string, decision: 'download' | 'open' | 'cancel'): void {
    const pending = this.#pendingDuplicates.get(askId);
    if (!pending) return;
    this.#pendingDuplicates.delete(askId);
    const { url, wc, already } = pending;
    if (decision === 'download') {
      // Одноразовое разрешение: следующий will-download по этому адресу пройдёт мимо вопроса.
      this.#approvedOnce.add(url);
      if (!wc.isDestroyed()) wc.downloadURL(url);
      else this.#approvedOnce.delete(url);
      return;
    }
    if (decision === 'open') void shell.openPath(already.savePath);
    // 'cancel' — делать нечего: сама загрузка уже отменена в момент вопроса.
  }

  // Всё, что происходит с принятой загрузкой: запись в список, подписки на прогресс и финал.
  // Вынесено из обработчика will-download, потому что теперь сюда есть два входа — обычный и
  // отложенный (после ответа на вопрос о дубле).
  #registerItem(item: Electron.DownloadItem, profileId: string | null): void {
    {
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
      // ⚠️ Приватная загрузка тоже получает профиль — тот, в котором её начали. Иначе она не
      // показалась бы НИГДЕ: на диск она не пишется, а список фильтруется по профилю.
      const owner = profileId ?? getActiveProfile().id;
      this.#profileOf.set(id, owner);
      if (profileId === null) this.#incognitoIds.add(id);
      // Пишем уже на СТАРТЕ, а не только по завершении: иначе падение или закрытие браузера
      // посреди скачивания стирало бы саму память о нём, хотя недокачанный файл на диске остался.
      // При чтении такая запись превращается в «Прервано» — см. #load.
      this.#persist(owner);
      // Старая запись уходит только сейчас, когда её замена уже в списке (см. retry).
      this.#adoptRetry(entry.url);
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
        this.#persist(owner);
        this.#notify();
      });
    }
  }

  /**
   * Список для интерфейса — загрузки АКТИВНОГО профиля.
   *
   * ⚠️ Записи всех профилей живут в одной памяти (фоновая загрузка соседнего профиля обязана
   * дойти до конца и попасть в свой файл), поэтому фильтр здесь, а не два разных хранилища.
   */
  getAll(): DownloadEntry[] {
    const active = getActiveProfile().id;
    this.#ensureLoaded(active);
    return [...this.#entries.values()]
      .filter((e) => this.#profileOf.get(e.id) === active)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  pause(id: string):  void { this.#items.get(id)?.pause(); }
  resume(id: string): void { this.#items.get(id)?.resume(); }
  cancel(id: string): void { this.#items.get(id)?.cancel(); }

  clear(id: string): void {
    const owner = this.#profileOf.get(id);
    this.#entries.delete(id);
    this.#items.delete(id);
    this.#incognitoIds.delete(id);
    this.#profileOf.delete(id);
    if (owner) this.#persist(owner);
    this.#notify();
  }

  openFile(id: string): void {
    if (!this.#stillOnDisk(id)) return;
    const e = this.#entries.get(id);
    if (e?.savePath) void shell.openPath(e.savePath);
  }

  /**
   * Путь завершённого файла, лежащего на диске, — для чтения содержимого (см. DownloadNamer.ts).
   * Незавершённую и пропавшую загрузку не отдаём: читать там нечего.
   */
  pathForRead(id: string): string | null {
    const e = this.#entries.get(id);
    if (!e || e.state !== 'completed' || !e.savePath) return null;
    return this.#stillOnDisk(id) ? e.savePath : null;
  }

  /**
   * Файл на диске уже переименован (DownloadNamer.renameDownloadedFile) — подтягиваем запись.
   * ⚠️ Список хранится на диске, и без #persist() имя разъехалось бы с файлом при перезапуске.
   */
  applyRename(id: string, filename: string, savePath: string): void {
    const e = this.#entries.get(id);
    if (!e) return;
    e.filename = filename;
    e.savePath = savePath;
    e.fileMissing = false;
    const owner = this.#profileOf.get(id);
    if (owner) this.#persist(owner);
    this.#notify();
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

  // Повторная загрузка: инициируем новую через сессию, и ею же заменяем старую запись.
  // Resume докачивает только при поддержке range-запросов сервером — здесь всегда fresh start.
  //
  // ⚠️ Старую запись убираем ПОСЛЕ того, как новая встала в список, а не до запуска. Между
  // downloadURL и will-download помещается целая жизнь: предупреждение о рискованном файле,
  // системный «Сохранить как», вопрос о повторе, отказ сети. Любой отказ на этом отрезке при
  // раннем clear оставлял человека ни с чем — старой записи уже нет, новой ещё нет, и по списку
  // нельзя понять, идёт ли загрузка вообще (живой случай на повторе отменённого файла).
  //
  // ⚠️ И НЕ СПРАШИВАЕМ «вы уже качали это»: повтор — ровно то, о чём человек только что попросил
  // кнопкой. Без этого старая запись, которая теперь доживает до will-download, сама бы и вызвала
  // вопрос о дубле (её файл может лежать на диске), то есть починка принесла бы лишний вопрос.
  retry(id: string): void {
    const e = this.#entries.get(id);
    if (!e || !this.#session) return;
    const url = e.url;
    this.#approvedOnce.add(url);
    this.#retrying.set(url, { oldId: id, at: Date.now() });
    void this.#session.downloadURL(url);
  }

  // Кого заменяет следующая загрузка этого адреса. Пометка СТАРЕЕТ по времени, а не ждёт вечно:
  // если повтор так и не состоялся, случайная загрузка того же адреса через час не должна
  // стирать чужую строку из списка. Пять минут — с запасом на системный диалог, который ждёт
  // человека.
  #retrying = new Map<string, { oldId: string; at: number }>();
  static #RETRY_ADOPT_MS = 5 * 60 * 1000;

  // Новая загрузка встала в список — убрать ту, которую она собой заменяет.
  #adoptRetry(url: string): void {
    const pending = this.#retrying.get(url);
    if (!pending) return;
    this.#retrying.delete(url);
    if (Date.now() - pending.at > DownloadManager.#RETRY_ADOPT_MS) return;
    this.clear(pending.oldId);
  }

  // ── Хранение списка между запусками ────────────────────────────────────────
  //
  // Своего файла-хранилища класса тут нет намеренно: писать нечего, кроме одного плоского
  // массива, а SQLite (как у истории и закладок) — несоразмерная машинерия ради трёх сотен строк.
  //
  // ⚠️ Читается ЛЕНИВО, а не в конструкторе: менеджер создаётся на уровне модуля в main.ts,
  // то есть до app.whenReady(), и лезть за userData оттуда — просить гонку на ровном месте.

  // ⚠️ Путь — через ProfilePaths, единственное место путей к данным профиля. У основного
  // профиля файл остаётся ТАМ ЖЕ и под тем же именем (`userData/downloads.json`): это боевой
  // список человека, и переезд ради единообразия — лишний шанс его потерять.
  #storePath(profileId: string): string {
    return profileDataPath(profileId, 'downloads.json');
  }

  #ensureLoaded(profileId: string): void {
    if (this.#loadedProfiles.has(profileId)) return;
    this.#loadedProfiles.add(profileId);
    let arr: unknown;
    try { arr = JSON.parse(fs.readFileSync(this.#storePath(profileId), 'utf8')); }
    catch { return; /* файла ещё нет или он битый — начинаем с пустого списка */ }
    if (!Array.isArray(arr)) return;

    for (const raw of arr as StoredDownload[]) {
      if (!raw || typeof raw.id !== 'string' || typeof raw.filename !== 'string') continue;
      this.#profileOf.set(raw.id, profileId);
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

  // ⚠️ Пишем файл КОНКРЕТНОГО профиля, а не активного: загрузка соседнего профиля продолжает
  // качаться, пока человек смотрит другой, и завершиться она обязана в своём файле.
  #persist(profileId: string): void {
    const data: StoredDownload[] = [...this.#entries.values()]
      .filter((e) => this.#profileOf.get(e.id) === profileId && !this.#incognitoIds.has(e.id))
      .sort((a, b) => b.startedAt - a.startedAt)
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
    const target = this.#storePath(profileId);
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
