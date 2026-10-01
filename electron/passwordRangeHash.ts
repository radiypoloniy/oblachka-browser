import crypto from 'node:crypto';

export function passwordRangeHash(password: string): { prefix: string; suffix: string } {
  // SHA-1 — формат протокола Pwned Passwords, а не способ хранения пароля.
  // В сеть уходит только prefix; полный хеш остаётся в main-процессе.
  const hash = crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  return { prefix: hash.slice(0, 5), suffix: hash.slice(5) };
}
