// Ключ Gemini — ФАСАД над общим хранилищем ключей (electron/ai/KeyStore.ts).
//
// ⚠️ Файл сохранён целиком ради его пяти вызывающих (main, AiPanelManager, ipc/aiHub,
// GeminiFactCheck): публичный API не изменился ни на букву, менять их не пришлось. Переписывать
// пять мест ради переезда хранилища значило бы смешать в одном заходе перенос данных и правку
// проводки — а разбираться потом, что именно сломалось, пришлось бы в обоих сразу.
//
// ⚠️ Что реально изменилось под фасадом: ключ переехал из отдельного файла `gemini-key.enc` в
// общий `ai-keys.enc`, где лежит карта «подключение → ключ». Миграция ОДНОКРАТНАЯ и добавляющая,
// разбор — в шапке ai/KeyStore.ts.
//
// ⚠️ Почему фасад остаётся, а не исчезает: «ключ Gemini» — это не подключение к модели, а ключ к
// ФАКТЧЕКУ, у которого своя форма запроса (google_search tool) и своё архитектурное требование
// (ссылки только из groundingMetadata реального ответа, см. GeminiFactCheck.ts). На общий адаптер
// он не переезжает и не должен: общий контракт провайдера про grounding ничего не знает.
import * as KeyStore from './ai/KeyStore';

/** Под каким id ключ фактчека живёт в общем хранилище. */
const GEMINI_ID = 'gemini';

type Listener = (connected: boolean) => void;

/**
 * Вызывается один раз при старте, ПОСЛЕ app.whenReady() — safeStorage требует готовое приложение
 * (см. main.ts::app.whenReady). Не в конструкторе и не на верхнем уровне модуля.
 *
 * ⚠️ Поднимает ВСЕ ключи разом, не только Gemini: хранилище теперь общее. Второй вызов из другого
 * места ничего не испортит — загрузка идемпотентна.
 */
export function loadFromDisk(): void {
  KeyStore.loadFromDisk();
}

export function getKeyStatus(): boolean {
  return KeyStore.hasKey(GEMINI_ID);
}

/** Ключ для реального вызова Gemini — используется только в main, никогда не пересекает IPC. */
export function getKey(): string | null {
  return KeyStore.getKey(GEMINI_ID);
}

export function saveKey(key: string): boolean {
  return KeyStore.saveKey(GEMINI_ID, key);
}

export function deleteKey(): void {
  KeyStore.deleteKey(GEMINI_ID);
}

/**
 * ⚠️ Общее хранилище сообщает СПИСОК готовых подключений, а этому фасаду нужен булев ответ про
 * одно. Пересчитываем на месте, а не пробрасываем список: иначе подписчик (панель, настройки)
 * получал бы уведомление о чужих ключах и перерисовывался бы без причины.
 */
export function onKeyStatusChanged(cb: Listener): () => void {
  let last = getKeyStatus();
  return KeyStore.onChanged(() => {
    const now = getKeyStatus();
    if (now === last) return;
    last = now;
    cb(now);
  });
}
