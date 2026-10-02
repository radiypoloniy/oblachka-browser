import type { PermKey } from './ipc';

export type BasePermKey = Exclude<PermKey, `external-app:${string}`>;

export function basePermission(key: PermKey): BasePermKey {
  return key.startsWith('external-app:') ? 'external-app' : key as BasePermKey;
}

export function externalScheme(key: PermKey): string | null {
  return key.startsWith('external-app:') ? key.slice('external-app:'.length) : null;
}
