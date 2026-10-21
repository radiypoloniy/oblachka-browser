export interface SecretClipboard {
  /** true = текст записан; protected сообщает, применены ли OS-маркеры истории/облака. */
  writeSecret(text: string, ownerHandle?: Buffer): Promise<{ ok: boolean; protected: boolean }>;
  readText(): Promise<string>;
  clear(): void;
}
