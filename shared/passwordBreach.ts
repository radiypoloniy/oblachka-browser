import crypto from 'node:crypto';

export function passwordRangeHash(password: string): { prefix: string; suffix: string } {
  // SHA-1 здесь не служит защитой пароля: это формат протокола Pwned Passwords. Наружу уйдут
  // только первые 5 hex-символов; полный хеш остаётся в main и после проверки не сохраняется.
  const hash = crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  return { prefix: hash.slice(0, 5), suffix: hash.slice(5) };
}

export function parsePasswordRange(body: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of body.split(/\r?\n/)) {
    const [rawSuffix, rawCount] = line.trim().split(':', 2);
    const suffix = rawSuffix?.toUpperCase() ?? '';
    const count = Number(rawCount);
    // Add-Padding добавляет синтетические строки с count=0 — они намеренно отбрасываются.
    if (/^[A-F0-9]{35}$/.test(suffix) && Number.isSafeInteger(count) && count > 0) counts.set(suffix, count);
  }
  return counts;
}
