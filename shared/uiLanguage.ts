// Язык хрома браузера, не Accept-Language гостевых сайтов и не язык ответа модели.
export type UiLanguage = 'en' | 'ru';

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === 'en' || value === 'ru';
}

// У старого профиля поля не было: сохранить русский. Только действительно новый профиль
// получает английский по умолчанию; обновление не должно молча менять привычный интерфейс.
export function initialUiLanguage(saved: unknown, hasExistingProfile: boolean): UiLanguage {
  if (isUiLanguage(saved)) return saved;
  return hasExistingProfile ? 'ru' : 'en';
}
