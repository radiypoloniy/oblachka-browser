import type { SecretClipboard } from './SecretClipboard';
import { ElectronSecretClipboard } from './ElectronSecretClipboard';
import { WindowsSecretClipboard } from './WindowsSecretClipboard';

export function createSecretClipboard(): SecretClipboard {
  return process.platform === 'win32' ? new WindowsSecretClipboard() : new ElectronSecretClipboard();
}
