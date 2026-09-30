import { net } from 'electron';
import type { PasswordManager } from './PasswordManager';
import type { PasswordBreachCheckResult, PasswordBreachItem } from '../shared/ipc';
import { parsePasswordRange, passwordRangeHash } from '../shared/passwordBreach';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const RANGE_CACHE_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_CONCURRENCY = 4;

const rangeCache = new Map<string, { expiresAt: number; counts: Map<string, number> }>();

async function fetchRange(prefix: string): Promise<Map<string, number>> {
  const cached = rangeCache.get(prefix);
  if (cached && cached.expiresAt > Date.now()) return cached.counts;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await net.fetch(`${RANGE_URL}${prefix}`, {
      method: 'GET',
      headers: { 'Add-Padding': 'true', 'User-Agent': 'Oblako-Browser/Password-Check' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    if (body.length > 250_000) throw new Error('range response too large');
    const counts = parsePasswordRange(body);
    rangeCache.set(prefix, { expiresAt: Date.now() + RANGE_CACHE_MS, counts });
    return counts;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkPasswordBreaches(passwords: PasswordManager): Promise<PasswordBreachCheckResult> {
  if (!passwords.available) return { status: 'unavailable', items: [] };

  // В структуре ниже только id и SHA-1. Плейнтекст живёт одну итерацию и никогда не попадает
  // ни в IPC, ни в лог, ни в сетевой клиент.
  const hashed: Array<{ id: number; prefix: string; suffix: string }> = [];
  for (const entry of passwords.list()) {
    const password = passwords.reveal(entry.id);
    if (password === null) continue;
    hashed.push({ id: entry.id, ...passwordRangeHash(password) });
  }
  if (hashed.length === 0) return { status: 'ok', items: [], checkedAt: Date.now() };

  const prefixes = [...new Set(hashed.map((item) => item.prefix))];
  const ranges = new Map<string, Map<string, number>>();
  let cursor = 0;
  try {
    const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, prefixes.length) }, async () => {
      while (cursor < prefixes.length) {
        const prefix = prefixes[cursor++]!;
        ranges.set(prefix, await fetchRange(prefix));
      }
    });
    await Promise.all(workers);
  } catch (error) {
    // Не логируем prefix/хеш: диагностике достаточно класса ошибки.
    console.warn('[Passwords] breach check unavailable:', error instanceof Error ? error.name : 'unknown');
    return { status: 'network-error', items: [] };
  }

  const items: PasswordBreachItem[] = hashed.map(({ id, prefix, suffix }) => ({
    id,
    count: ranges.get(prefix)?.get(suffix) ?? 0,
  }));
  return { status: 'ok', items, checkedAt: Date.now() };
}
