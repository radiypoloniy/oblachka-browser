// Какие поля пароля заполнять одной строкой (логин / регистрация / смена).
//
// ⚠️ Живёт без импортов — гоняет scripts/password-fill-check.mjs. Та же логика скопирована в
// electron/preload-content.ts: sandboxed preload гостевой страницы не умеет require() shared.

export type PasswordFieldRole = 'current' | 'new' | 'unknown';

export function passwordFieldRole(attrs: {
  autocomplete?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  label?: string;
}): PasswordFieldRole {
  const ac = (attrs.autocomplete ?? '').toLowerCase();
  if (/(?:^|\s)new-password(?:\s|$)/.test(ac)) return 'new';
  if (/(?:^|\s)current-password(?:\s|$)/.test(ac)) return 'current';
  const hay = [attrs.name, attrs.id, attrs.placeholder, attrs.label]
    .filter(Boolean).join(' ').toLowerCase();
  if (/confirm|repeat|re-?type|re-?enter|повтор|подтверд/.test(hay)) return 'new';
  if (/current password|old password|текущий пароль|старый пароль/.test(hay)) return 'current';
  return 'unknown';
}

/**
 * Индексы полей, которые заполняем одним паролем.
 *
 * Регистрация: пароль + «повторить» — оба. Смена: не трогаем текущий. Логин: одно поле.
 */
export function passwordFillTargets(roles: readonly PasswordFieldRole[]): number[] {
  if (roles.length === 0) return [];
  const idx = (role: PasswordFieldRole): number[] =>
    roles.map((r, i) => (r === role ? i : -1)).filter((i) => i >= 0);
  const news = idx('new');
  if (news.length > 0) return news;
  const currents = idx('current');
  const unknowns = idx('unknown');
  // current + пустые без autocomplete — это «новый / повторить», не текущий.
  if (currents.length > 0 && unknowns.length > 0) return unknowns;
  // Три безымянных: current, new, confirm. Первое не затираем — иначе форма смены не примет.
  if (roles.length >= 3 && unknowns.length === roles.length) {
    return roles.map((_, i) => i).slice(1);
  }
  return roles.map((_, i) => i);
}
