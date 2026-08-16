// Индикатор-«ключ» менеджера паролей: чем становится его состояние при пересчёте формы на
// странице. Чистая логика, без Electron и без сейфа.
//
// ⚠️ Вынесено сюда после живой жалобы «пароли не сохраняются». Причина была ровно в этом
// переходе: предложение сохранить стиралось по признаку «формы входа на странице больше нет» —
// а форма исчезает ИМЕННО при удачном входе. То есть предложение гасло почти всегда, меньше чем
// через секунду после submit, вместе с ключом в омнибоксе и поповером. Правило легко «починить
// обратно» одной строкой, поэтому оно живёт отдельно и под тестом.
//
// ⚠️ Значимых импортов тут быть НЕ должно, только типовые — см. ту же причину в shared/sessionTree.ts.
import type { PasswordIndicatorState } from './ipc';

export interface SavedMatch {
  id: number;
  username: string;
}

// keep: true — состояние трогать нельзя (человеку показано предложение, он на него ещё не ответил).
export type IndicatorDecision =
  | { keep: true }
  | { keep: false; state: PasswordIndicatorState | null };

function isPendingOffer(s: PasswordIndicatorState | null): s is PasswordIndicatorState & { origin: string } {
  return s?.kind === 'offer-save' || s?.kind === 'offer-update';
}

/**
 * Каким стать индикатору, когда гостевая страница пересчитала форму входа.
 *
 * @param current   что показано сейчас для этой вкладки
 * @param hasLoginForm  видит ли страница форму входа прямо сейчас
 * @param origin    origin страницы (уже вычисленный main из wc.getURL(), не из payload страницы)
 * @param saved     сохранённые входы для этого origin
 */
export function nextIndicatorState(
  current: PasswordIndicatorState | null,
  hasLoginForm: boolean,
  origin: string,
  saved: SavedMatch[],
): IndicatorDecision {
  // Незакрытое предложение переживает ЛЮБОЙ пересчёт формы на том же сайте — и исчезновение
  // формы (удачный вход), и её появление заново (неудачный вход, перезагрузка страницы входа).
  // Убрать его могут только сам человек, сохранение или закрытие вкладки.
  if (isPendingOffer(current) && current.origin === origin) return { keep: true };

  if (!hasLoginForm) return { keep: false, state: null };

  return {
    keep: false,
    state: saved.length > 0
      ? { kind: 'has-saved', origin, matches: saved.map((m) => ({ id: m.id, username: m.username })) }
      : null,
  };
}

/**
 * Подставлять ли сохранённый вход сразу, без кликов.
 *
 * Только когда сохранён РОВНО один вход: несколько — неоднозначно, ждём выбора человека. И только
 * один раз, пока форма не исчезала: на SPA форма живёт в DOM постоянно, и без этого мы
 * перезаполняли бы её на каждый пересчёт.
 */
export function shouldAutofill(
  state: PasswordIndicatorState | null,
  origin: string,
  alreadyFilledOrigin: string | undefined,
): SavedMatch | null {
  if (state?.kind !== 'has-saved' || state.matches.length !== 1) return null;
  if (alreadyFilledOrigin === origin) return null;
  return state.matches[0] ?? null;
}
