import type { ModelErrorCode } from '../../../shared/ipc';

// Ошибка модели человеческими словами. Живёт рядом с лентой: только она их и показывает.

export // Человекочитаемая карточка вместо сырого String(e) — NO_MODEL_INSTALLED/MODEL_FILE_MISSING
// ведут в Настройки (showModelButton), LOAD_FAILED и всё прочее без errorCode — просто внятная
// подводка над текстом ошибки от бэкенда (он уже человекочитаем, см. TranslationService.ts).
function describeChatError(error: string, code: ModelErrorCode | null): { heading: string; detail: string; showModelButton: boolean } {
  if (code === 'NO_MODEL_INSTALLED') {
    return {
      heading: 'Локальная модель не установлена',
      detail: 'AI считает прямо на этом устройстве, без облака — модель нужно скачать один раз, дальше всё работает офлайн.',
      showModelButton: true,
    }
  }
  if (code === 'MODEL_FILE_MISSING') {
    return {
      heading: 'Файл модели не найден',
      detail: 'Похоже, файл модели переместили или удалили с диска. Выберите модель заново.',
      showModelButton: true,
    }
  }
  return { heading: 'Не удалось получить ответ', detail: error, showModelButton: false }
}
