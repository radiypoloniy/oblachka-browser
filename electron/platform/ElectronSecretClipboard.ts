import { clipboard } from 'electron';
import type { SecretClipboard } from './SecretClipboard';

// Кроссплатформенный fallback. История ОС может сохранить значение, но текущий clipboard
// очищается по таймеру. Платформы с нативными privacy-маркерами переопределяют writeSecret.
export class ElectronSecretClipboard implements SecretClipboard {
  async writeSecret(text: string): Promise<{ ok: boolean; protected: boolean }> {
    try {
      await clipboard.writeText(text);
      return { ok: true, protected: false };
    } catch {
      return { ok: false, protected: false };
    }
  }

  // ⚠️ await обязателен: с Electron 44 readText асинхронный, и без него отказ буфера (занят
  // другим процессом) проскочил бы мимо catch отклонённым промисом.
  async readText(): Promise<string> {
    try { return await clipboard.readText(); } catch { return ''; }
  }

  clear(): void {
    try { clipboard.clear(); } catch { /* clipboard может быть временно занят другим процессом */ }
  }
}
