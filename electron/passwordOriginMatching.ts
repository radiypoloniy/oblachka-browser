import { getDomain } from 'tldts-experimental';

export type PasswordOriginMatch = 'exact' | 'same-site';

function parsedHttpOrigin(origin: string): URL | null {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Насколько сохранённый origin подходит текущей странице.
 *
 * same-site используется только для ЯВНОГО выбора человеком. Автоподстановка по-прежнему
 * требует exact: соседний поддомен может принадлежать другому сервису или арендатору.
 */
export function passwordOriginMatch(pageOrigin: string, savedOrigin: string): PasswordOriginMatch | null {
  if (pageOrigin === savedOrigin) return 'exact';
  const page = parsedHttpOrigin(pageOrigin);
  const saved = parsedHttpOrigin(savedOrigin);
  if (!page || !saved) return null;

  // Никогда не отдаём пароль, сохранённый на HTTPS, странице по незащищённому HTTP.
  if (page.protocol === 'http:' && saved.protocol === 'https:') return null;

  // allowPrivateDomains не смешивает разных арендаторов вроде a.github.io и b.github.io.
  const pageDomain = getDomain(page.hostname, { allowPrivateDomains: true });
  const savedDomain = getDomain(saved.hostname, { allowPrivateDomains: true });
  return pageDomain !== null && pageDomain === savedDomain ? 'same-site' : null;
}

export interface PasswordOriginEntry {
  id: number;
  origin: string;
  username: string;
}

export function passwordMatchesForOrigin<T extends PasswordOriginEntry>(entries: readonly T[], pageOrigin: string): T[] {
  const matches = entries
    .map((entry, index) => ({ entry, index, scope: passwordOriginMatch(pageOrigin, entry.origin) }))
    .filter((item): item is typeof item & { scope: PasswordOriginMatch } => item.scope !== null)
    .sort((a, b) => {
      const scopeOrder = (a.scope === 'exact' ? 0 : 1) - (b.scope === 'exact' ? 0 : 1);
      return scopeOrder !== 0 ? scopeOrder : a.index - b.index;
    });

  return matches.map(({ entry }) => entry);
}

/**
 * Убираем только доказанный дубль: безымянная запись хранит ТОТ ЖЕ секрет, что полноценный
 * аккаунт. Другой пароль без username — самостоятельная password-only форма (Caddy, роутеры,
 * локальные панели) и обязан остаться доступным.
 */
export function dedupeAnonymousPasswordMatches<T extends PasswordOriginEntry>(
  entries: readonly T[],
  reveal: (id: number) => string | null,
): T[] {
  const namedSecrets = new Set<string>();
  for (const entry of entries) {
    if (entry.username.trim() === '') continue;
    const secret = reveal(entry.id);
    if (secret !== null) namedSecrets.add(secret);
  }
  if (namedSecrets.size === 0) return [...entries];
  return entries.filter((entry) => {
    if (entry.username.trim() !== '') return true;
    const secret = reveal(entry.id);
    return secret === null || !namedSecrets.has(secret);
  });
}
