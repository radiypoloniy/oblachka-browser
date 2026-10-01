import { NsisUpdater, NoOpLogger } from 'electron-updater';
import type { UpdateDownloadedEvent } from 'electron-updater';
import { DownloadedUpdateHelper } from 'electron-updater/out/DownloadedUpdateHelper.js';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

// Windows NSIS хранит файл между запусками, но не восстанавливает готовность установщика.
// Используем его штатный helper: проверка SHA-512 остаётся той же, что при скачивании.
export class WindowsUpdater extends NsisUpdater {
  private get receiptPath(): string { return path.join(this.app.userDataPath, 'pending-update.json'); }

  protected override dispatchUpdateDownloaded(info: UpdateDownloadedEvent): void {
    try {
      const temp = `${this.receiptPath}.tmp`;
      writeFileSync(temp, JSON.stringify({ fromVersion: this.app.version, info }), 'utf8');
      renameSync(temp, this.receiptPath);
    } catch { /* Сбой вспомогательного файла не отменяет уже скачанное обновление. */ }
    super.dispatchUpdateDownloaded(info);
  }

  async restorePendingUpdate(): Promise<boolean> {
    try {
      const receipt = JSON.parse(readFileSync(this.receiptPath, 'utf8')) as {
        fromVersion?: unknown; info?: UpdateDownloadedEvent;
      };
      const info = receipt.info;
      if (receipt.fromVersion !== this.app.version || !info || typeof info.version !== 'string'
        || info.version === this.app.version || typeof info.downloadedFile !== 'string'
        || !Array.isArray(info.files)) return false;
      // Путь берём из конфигурации сборки: запись профиля не выбирает произвольный установщик.
      const config = readFileSync(this.app.appUpdateConfigPath, 'utf8');
      const cacheName = /^updaterCacheDirName:\s*['"]?([\w.-]+)['"]?\s*$/m.exec(config)?.[1] ?? this.app.name;
      if (cacheName === '.' || cacheName === '..') return false;
      const cacheDir = path.join(this.app.baseCachePath, cacheName);
      const pending = path.join(cacheDir, 'pending');
      const fileName = path.basename(info.downloadedFile);
      const installer = path.join(pending, fileName);
      if (path.resolve(info.downloadedFile).toLowerCase() !== path.resolve(installer).toLowerCase()
        || !fileName.toLowerCase().endsWith('.exe')) return false;
      const file = info.files.find(f => typeof f?.url === 'string'
        && path.basename(new URL(f.url, 'https://update.invalid/').pathname) === fileName
        && typeof f.sha512 === 'string');
      if (!file) return false;
      const helper = new DownloadedUpdateHelper(cacheDir);
      const resolved = { url: new URL(file.url, 'https://update.invalid/'), info: file };
      if (!(await helper.validateDownloadedPath(installer, info, resolved, new NoOpLogger()))) return false;
      await helper.setDownloadedFile(installer, null, info, resolved, fileName, false);
      this.downloadedUpdateHelper = helper;
      super.dispatchUpdateDownloaded(info);
      return true;
    } catch { return false; }
  }
}
