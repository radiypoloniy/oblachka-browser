import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { decodeAppSession } from '../shared/appSession';
import type { AppSessionSnapshot, SessionSnapshot } from '../shared/session';

type LegacyDecoder = (data: Record<string, unknown>) => SessionSnapshot | null;

// Старые exe продолжают писать session.json, поэтому новый формат живёт отдельно.
// Сначала сохраняем исходник/последний хороший файл,
// затем заменяем основной через rename; ошибка диска не превращается в пустую сессию.
export class AppSessionStore {
  readonly filePath: string;
  #sourcePath: string;
  #lastGood: string | null = null;
  #blocked = false;
  #preserveOriginal: string | null = null;
  lastError: string | null = null;

  constructor(dir: string, private readonly appVersion: string, private readonly decodeLegacy: LegacyDecoder, private readonly onIssue?: (message: string) => void) {
    this.filePath = path.join(dir, 'session-v6.json');
    this.#sourcePath = this.filePath;
  }

  #decode(raw: string): AppSessionSnapshot | null {
    const d: unknown = JSON.parse(raw);
    if (typeof d !== 'object' || d === null || Array.isArray(d)) return null;
    const data = d as Record<string, unknown>;
    if (data.version === 6) return decodeAppSession(data);
    if (typeof data.version !== 'number' || data.version < 1 || data.version > 5) return null;
    const snapshot = this.decodeLegacy(data);
    return snapshot ? { windows: [{ id: randomUUID(), snapshot }], closedWindows: [] } : null;
  }

  load(): AppSessionSnapshot | null {
    // Прежний файл импортируется один раз. После первой записи старый браузер
    // не может подменить многооконную сессию своим пустым снимком v5.
    this.#sourcePath = fs.existsSync(this.filePath) ? this.filePath : path.join(path.dirname(this.filePath), 'session.json');
    let raw: string | null = null;
    try {
      raw = fs.readFileSync(this.#sourcePath, 'utf8');
      const version = (JSON.parse(raw) as { version?: unknown } | null)?.version;
      if (typeof version === 'number' && version > 6) {
        this.#blocked = true;
        fs.copyFileSync(this.#sourcePath, `${this.#sourcePath}.from-v${version}.${Date.now()}`);
        this.#report('Неизвестная версия сессии: исходный файл защищён от перезаписи.');
        return null;
      }
      const decoded = this.#decode(raw);
      if (decoded) {
        this.#lastGood = raw;
        if (version !== 6) this.#preserveOriginal = `${this.#sourcePath}.pre-v6.${Date.now()}`;
        return decoded;
      }
      this.#report('Некорректная сессия: пробую резервную копию, исходник будет сохранён отдельно.');
    } catch (error) {
      if (this.#blocked) { this.#report(error); return null; }
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Если исходник нельзя даже прочесть, нельзя безопасно заменить его резервной копией.
        if (raw === null) this.#blocked = true;
        this.#report(error);
      }
    }
    if (raw !== null) this.#preserveOriginal = `${this.#sourcePath}.corrupt.${Date.now()}`;
    try {
      const backup = fs.readFileSync(`${this.#sourcePath}.bak`, 'utf8');
      const decoded = this.#decode(backup);
      if (decoded) { this.#lastGood = backup; this.#report('Сессия восстановлена из резервной копии.'); return decoded; }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.#report(error);
    }
    return null;
  }

  save(snapshot: AppSessionSnapshot): boolean {
    if (this.#blocked) return false;
    let raw: string;
    try {
      raw = JSON.stringify({ version: 6, app: this.appVersion, savedAt: new Date().toISOString(), ...snapshot }, null, 2);
      if (!decodeAppSession(JSON.parse(raw))) { this.#report('Некорректный снимок: сохранение пропущено.'); return false; }
    } catch (error) { this.#report(error); return false; }
    const tmp = `${this.filePath}.tmp`;
    try {
      if (this.#preserveOriginal) {
        fs.copyFileSync(this.#sourcePath, this.#preserveOriginal, fs.constants.COPYFILE_EXCL);
        this.#preserveOriginal = null;
      }
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeFileSync(fd, raw, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (this.#lastGood !== null) {
        const backupTmp = `${this.filePath}.bak.tmp`;
        fs.writeFileSync(backupTmp, this.#lastGood, 'utf8');
        fs.renameSync(backupTmp, `${this.filePath}.bak`);
      }
      fs.renameSync(tmp, this.filePath);
      this.#lastGood = raw;
      this.lastError = null;
      return true;
    } catch (error) { this.#report(error); return false; }
  }

  #report(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    console.warn('[session]', this.lastError);
    this.onIssue?.(this.lastError);
  }
}
