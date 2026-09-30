import { clipboard } from 'electron';
import type { SecretClipboard } from './SecretClipboard';

// Кроссплатформенный fallback. История ОС может сохранить значение, но текущий clipboard
// очищается по таймеру. Платформы с нативными privacy-маркерами переопределяют writeSecret.
export class ElectronSecretClipboard implements SecretClipboard {
  async writeSecret(text: string): Promise<{ ok: boolean; protected: boolean }> {
    try {
      clipboard.writeText(text);
      return { ok: true, protected: false };
    } catch {
      return { ok: false, protected: false };
    }
  }

  readText(): string {
    try { return clipboard.readText(); } catch { return ''; }
  }

  clear(): void {
    try { clipboard.clear(); } catch { /* clipboard может быть временно занят другим процессом */ }
  }
}
