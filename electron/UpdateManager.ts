import { app } from 'electron';
import type { UpdateStatus, UpdateStatusKind } from '../shared/ipc';

// Автообновление через electron-updater. Адрес фида не задаётся здесь: electron-builder кладёт
// рядом с app.asar файл app-update.yml (см. блок publish в electron-builder.yml), апдейтер читает
// его сам. Поэтому в коде нет ни owner/repo, ни URL — сменить канал распространения можно
// пересборкой, не правкой исходников.
//
// Политика намеренно консервативная (осознанный выбор, а не упущение):
//   • autoDownload = false — трафик не тратится без ведома пользователя;
//   • autoInstallOnAppQuit = false — приложение не подменяет себя при выходе втихую;
//   • проверка при старте отложена и не блокирует запуск.
// Для приватного браузера «скачали и подменили молча» — неприемлемое поведение, даже если так
// делает Chrome.
//
// ⚠️ Границы применимости, которые UI обязан честно показывать:
//   1. В dev-режиме (npm run dev / npm start) апдейтер неприменим в принципе — electron-updater
//      требует установленного приложения. Отсюда состояние 'disabled', см. UpdateStatusKind.
//   2. Пока GitHub-репозиторий закрыт, релизы недоступны без токена — проверка вернёт 404.
//      Это ОЖИДАЕМО и трактуется как «обновления недоступны», а не как поломка.
//   3. Сборка не подписана. На Windows 11 со Smart App Control установка скачанного обновления
//      будет заблокирована системой уже после успешной загрузки — лечится только подписью кода.

// Тип модуля берём через import type (стирается при компиляции), сам модуль подгружаем лениво:
// в dev-режиме он не нужен вообще, и грузить его в память при каждом npm run dev незачем.
type UpdaterModule = typeof import('electron-updater');

let updaterModule: UpdaterModule | null = null;
function loadUpdaterModule(): UpdaterModule {
  if (updaterModule === null) updaterModule = require('electron-updater') as UpdaterModule;
  return updaterModule;
}

// Технические сообщения electron-updater («HttpError: 404 Not Found» и т.п.) пользователю
// показывать нельзя — переводим в человеческие формулировки. Неизвестное отдаём как есть:
// лучше непонятный текст, чем проглоченная ошибка.
function humanizeError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('404') || s.includes('no published versions') || s.includes('cannot find channel'))
    return 'Обновления пока недоступны — опубликованных релизов нет.';
  if (s.includes('enotfound') || s.includes('econnrefused') || s.includes('econnreset') ||
      s.includes('etimedout') || s.includes('network') || s.includes('getaddrinfo'))
    return 'Не удалось связаться с сервером обновлений. Проверьте соединение.';
  if (s.includes('403') || s.includes('401'))
    return 'Нет доступа к серверу обновлений.';
  if (s.includes('sha512') || s.includes('checksum') || s.includes('integrity'))
    return 'Файл обновления повреждён — установка отменена.';
  return raw;
}

export class UpdateManager {
  #status: UpdateStatus;
  #onChange: ((s: UpdateStatus) => void) | null = null;
  #wired = false;

  constructor() {
    this.#status = {
      // Пока не вызвали initialize(), считаем состояние 'disabled' — оно безопасно по умолчанию:
      // UI не покажет кнопку обновления там, где обновляться нечем.
      kind: app.isPackaged ? 'idle' : 'disabled',
      currentVersion: app.getVersion(),
      newVersion: null,
      percent: 0,
      error: null,
      lastCheckedAt: null,
    };
  }

  getStatus(): UpdateStatus {
    return { ...this.#status };
  }

  // Подписка на события апдейтера + отложенная стартовая проверка. В dev-режиме не делает
  // ничего: ни импорта модуля, ни сетевых запросов.
  initialize(onChange: (s: UpdateStatus) => void, startupCheckDelayMs = 20_000): void {
    this.#onChange = onChange;
    if (!app.isPackaged) return;

    try {
      this.#wire();
    } catch (e) {
      // Апдейтер не должен уметь ронять запуск браузера — что бы ни случилось.
      this.#fail(e);
      return;
    }

    // Отложенно и unref: проверка обновлений не имеет права ни задерживать показ окна, ни
    // удерживать процесс живым при выходе (иначе закрытие браузера ждало бы таймер).
    const timer = setTimeout(() => { this.check(); }, startupCheckDelayMs);
    timer.unref?.();
  }

  check(): void {
    if (!this.#ensureReady()) return;
    // Повторный вызов во время активной работы игнорируем: electron-updater на параллельные
    // checkForUpdates отвечает невнятно, а пользователь может нажать кнопку дважды.
    if (this.#status.kind === 'checking' || this.#status.kind === 'downloading') return;
    this.#set({ kind: 'checking', error: null });
    try {
      // catch на промисе обязателен: у electron-updater ошибка приходит И событием 'error',
      // И отклонённым промисом — без обработчика получим unhandled rejection в main.
      void loadUpdaterModule().autoUpdater.checkForUpdates()?.catch((e) => this.#fail(e));
    } catch (e) {
      this.#fail(e);
    }
  }

  download(): void {
    if (!this.#ensureReady()) return;
    // Качать можно только то, что уже найдено проверкой.
    if (this.#status.kind !== 'available') return;
    this.#set({ kind: 'downloading', percent: 0, error: null });
    try {
      void loadUpdaterModule().autoUpdater.downloadUpdate()?.catch((e) => this.#fail(e));
    } catch (e) {
      this.#fail(e);
    }
  }

  // Закрывает приложение и запускает установщик. Вызывать только из явного действия пользователя:
  // несохранённого состояния у вкладок нет (SessionManager пишет session.json на close), но
  // внезапный выход по инициативе программы — всё равно плохое поведение.
  install(): void {
    if (!this.#ensureReady()) return;
    if (this.#status.kind !== 'downloaded') return;
    try {
      // isSilent=false — установщик покажет прогресс; isForceRunAfter=true — вернуть браузер
      // пользователю после установки, иначе он просто исчезнет с экрана.
      loadUpdaterModule().autoUpdater.quitAndInstall(false, true);
    } catch (e) {
      this.#fail(e);
    }
  }

  // ── Приватное ──────────────────────────────────────────────────────────────

  #ensureReady(): boolean {
    return app.isPackaged && this.#wired;
  }

  #wire(): void {
    if (this.#wired) return;
    const { autoUpdater } = loadUpdaterModule();

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    // Без electron-log в зависимостях апдейтер всё равно пишет в консоль через свой дефолт;
    // явный null убирает шум из stdout прод-сборки (см. CLAUDE.md — «в prod без URL/текстов»).
    autoUpdater.logger = null;

    autoUpdater.on('update-available', (info: { version: string }) => {
      this.#set({ kind: 'available', newVersion: info?.version ?? null, lastCheckedAt: Date.now(), error: null });
    });
    autoUpdater.on('update-not-available', () => {
      this.#set({ kind: 'not-available', newVersion: null, lastCheckedAt: Date.now(), error: null });
    });
    autoUpdater.on('download-progress', (p: { percent?: number }) => {
      this.#set({ kind: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p?.percent ?? 0))) });
    });
    autoUpdater.on('update-downloaded', (info: { version: string }) => {
      this.#set({ kind: 'downloaded', newVersion: info?.version ?? this.#status.newVersion, percent: 100, error: null });
    });
    autoUpdater.on('error', (e: Error) => this.#fail(e));

    this.#wired = true;
  }

  #fail(e: unknown): void {
    const raw = e instanceof Error ? e.message : String(e);
    this.#set({ kind: 'error', error: humanizeError(raw), percent: 0 });
  }

  #set(patch: Partial<UpdateStatus> & { kind: UpdateStatusKind }): void {
    this.#status = { ...this.#status, ...patch };
    this.#onChange?.(this.getStatus());
  }
}
