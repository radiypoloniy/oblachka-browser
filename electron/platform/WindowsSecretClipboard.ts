import { spawn } from 'node:child_process';
import { clipboard } from 'electron';
import type { SecretClipboard } from './SecretClipboard';
import { encodedPowerShellCommand, nativeWindowHandleDecimal } from './windowsSecretClipboardScript';

const HELPER_TIMEOUT_MS = 5_000;
const ENCODED_HELPER = encodedPowerShellCommand();

export class WindowsSecretClipboard implements SecretClipboard {
  async writeSecret(text: string, ownerHandle?: Buffer): Promise<{ ok: boolean; protected: boolean }> {
    const owner = ownerHandle ? nativeWindowHandleDecimal(ownerHandle) : null;
    if (!owner) return { ok: false, protected: false };

    const protectedWrite = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      try {
        const child = spawn('powershell.exe', [
          '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-EncodedCommand', ENCODED_HELPER,
        ], {
          windowsHide: true,
          stdio: ['pipe', 'ignore', 'ignore'],
          env: { ...process.env, OBLAKO_CLIPBOARD_OWNER: owner },
        });
        const payload = Buffer.from(text, 'utf8');
        child.stdin.on('error', () => finish(false));
        child.stdin.end(payload, () => payload.fill(0));
        child.once('error', () => finish(false));
        child.once('exit', (code) => finish(code === 0));
        const timeout = setTimeout(() => {
          child.kill();
          finish(false);
        }, HELPER_TIMEOUT_MS);
        child.once('close', () => clearTimeout(timeout));
      } catch {
        finish(false);
      }
    });

    if (protectedWrite) return { ok: true, protected: true };
    // Fail closed: обычный clipboard.writeText сделал бы пароль доступным истории и облачной
    // синхронизации Windows. Лучше не скопировать и оставить reveal, чем тихо ослабить защиту.
    console.warn('[Passwords] Windows clipboard privacy markers unavailable; password was not copied');
    return { ok: false, protected: false };
  }

  readText(): string {
    try { return clipboard.readText(); } catch { return ''; }
  }

  clear(): void {
    try { clipboard.clear(); } catch { /* clipboard может быть временно занят */ }
  }
}
