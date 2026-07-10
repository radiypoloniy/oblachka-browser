// Менеджер паролей, шаг 2 — оркестрация между TabManager (сигналы с гостевых страниц),
// PasswordManager (сейф) и chrome UI (индикатор-«ключ» + поповер). Тот же приём, что
// AiPanelManager.ts/TranslatePopoverManager.ts: модуль с экспортированными функциями +
// setTabManager(), не класс — сама «бизнес-логика вкладок» остаётся в TabManager.ts, этот модуль
// только реагирует на её колбэки.
import type { TabManager } from './TabManager';
import type { PasswordManager } from './PasswordManager';
import { originOf } from './PasswordManager';
import type { PasswordIndicatorState } from '../shared/ipc';

let tabManagerRef: TabManager | null = null;
let passwordManagerRef: PasswordManager | null = null;
let onIndicatorChangedCb: ((state: PasswordIndicatorState | null) => void) | null = null;
let onListChangedCb: (() => void) | null = null;

// Текущее состояние индикатора по вкладке — chrome видит только состояние АКТИВНОЙ (см.
// pushIfActive). Ожидающий подтверждения секрет — ОТДЕЛЬНАЯ карта, никогда не пересекает
// границу IPC как есть (только через handleSave/handleUpdate, которые сами зовут PasswordManager).
const tabStates = new Map<string, PasswordIndicatorState | null>();
const pendingSecrets = new Map<string, { username: string; password: string; matchId?: number }>();

export function init(
  tm: TabManager,
  pm: PasswordManager,
  onIndicatorChanged: (state: PasswordIndicatorState | null) => void,
  onListChanged: () => void,
): void {
  tabManagerRef = tm;
  passwordManagerRef = pm;
  onIndicatorChangedCb = onIndicatorChanged;
  onListChangedCb = onListChanged;
}

function pushIfActive(tabId: string, state: PasswordIndicatorState | null): void {
  if (tabManagerRef?.getActiveId() !== tabId) return;
  onIndicatorChangedCb?.(state);
}

function computeHasSavedState(pm: PasswordManager, origin: string): PasswordIndicatorState | null {
  const matches = pm.list()
    .filter((e) => e.origin === origin)
    .map((e) => ({ id: e.id, username: e.username }));
  return matches.length > 0 ? { kind: 'has-saved', origin, matches } : null;
}

// ── Сигналы с гостевой страницы (см. TabManager.ts::onPasswordFormCb/onPasswordSubmitCb) ──────

// Клик по иконке в поле пароля (не в тулбаре) — см. TabManager.ts::onPasswordFieldIconClickCb,
// electron/preload-content.ts. Решает, что показать в поповере: тот же расчёт, что уже даёт
// has-saved (сохранённый логин есть — предложить подставить), либо, если для origin вообще
// ничего не сохранено, offer-generate (похоже на регистрацию — предложить сгенерировать).
// Позиция поповера (заякорен на поле, не на тулбар) считается вызывающей стороной (main.ts) —
// этот модуль ничего не знает про геометрию окна.
export function handleFieldIconClick(tabId: string, url: string): PasswordIndicatorState | null {
  try {
    const pm = passwordManagerRef;
    if (!pm) return null;
    const origin = originOf(url);
    const saved = computeHasSavedState(pm, origin);
    if (saved) {
      tabStates.set(tabId, saved);
      return saved;
    }
    const state: PasswordIndicatorState = { kind: 'offer-generate', origin };
    tabStates.set(tabId, state);
    return state;
  } catch (e) {
    console.warn('[PasswordAutofill] handleFieldIconClick error:', (e as Error).message);
    return null;
  }
}

// Дефолт для инлайн-генерации из поля (не из формы в Settings, там уже есть полный набор
// чекбоксов/длины) — длина и набор символов, которые молча считаются «надёжно достаточно»
// (128 бит энтропии с запасом: log2(26+26+10+22)^20 ≈ 129 бит). Пользователь всегда может
// зайти в Настройки → Пароли за тонкой настройкой длины/набора символов.
const INLINE_GENERATE_OPTS = { length: 20, lower: true, upper: true, digits: true, symbols: true };

export async function handleGenerateAndFill(): Promise<boolean> {
  try {
    const pm = passwordManagerRef;
    const tm = tabManagerRef;
    const tabId = tm?.getActiveId();
    if (!pm || !tm || !tabId) return false;

    const state = tabStates.get(tabId);
    if (!state || state.kind !== 'offer-generate') return false;

    const activeUrl = tm.getActiveWebContents()?.getURL() ?? '';
    if (originOf(activeUrl) !== state.origin) return false;

    const password = pm.generate(INLINE_GENERATE_OPTS);
    // Только пароль (username отсутствует в payload) — не трогаем поле логина, пользователь
    // мог его уже начать заполнять. Реальное сохранение — тем же путём, что и раньше: обычный
    // submit-детектор content-preload сам предложит offer-save/offer-update при отправке формы.
    return tm.sendPasswordFill(tabId, { password });
  } catch (e) {
    console.warn('[PasswordAutofill] handleGenerateAndFill error:', (e as Error).message);
    return false;
  }
}

export function handleFormDetected(tabId: string, hasLoginForm: boolean, hasUsernameField: boolean, url: string): void {
  try {
    const pm = passwordManagerRef;
    if (!pm) return;
    if (!hasLoginForm) {
      tabStates.delete(tabId);
      pushIfActive(tabId, null);
      return;
    }
    const state = computeHasSavedState(pm, originOf(url));
    tabStates.set(tabId, state);
    pushIfActive(tabId, state);
  } catch (e) {
    console.warn('[PasswordAutofill] handleFormDetected error:', (e as Error).message);
  }
}

export function handleCredentialSubmitted(tabId: string, username: string, password: string, url: string): void {
  try {
    const pm = passwordManagerRef;
    if (!pm) return;
    const origin = originOf(url);
    const result = pm.checkCredential(origin, username, password);

    if (result.status === 'match') {
      // Уже сохранено ровно так же — ничего не предлагаем (никогда не спамим уже известным).
      pendingSecrets.delete(tabId);
      tabStates.delete(tabId);
      pushIfActive(tabId, null);
      return;
    }

    const state: PasswordIndicatorState = result.status === 'new'
      ? { kind: 'offer-save', origin, username }
      : { kind: 'offer-update', origin, username, matchId: result.matchId! };
    pendingSecrets.set(tabId, { username, password, matchId: result.status === 'differs' ? result.matchId : undefined });
    tabStates.set(tabId, state);
    pushIfActive(tabId, state);
  } catch (e) {
    console.warn('[PasswordAutofill] handleCredentialSubmitted error:', (e as Error).message);
  }
}

// ── Реакция на смену активной вкладки / закрытие (main.ts подключает к уже существующим
// колбэкам TabManager — onActiveTabChangedCb/onTabClosedCb, без новых параметров конструктора) ──

export function onActiveTabChanged(): void {
  try {
    const tabId = tabManagerRef?.getActiveId();
    if (!tabId) return;
    onIndicatorChangedCb?.(tabStates.get(tabId) ?? null);
  } catch (e) {
    console.warn('[PasswordAutofill] onActiveTabChanged error:', (e as Error).message);
  }
}

export function onTabClosed(tabId: string): void {
  tabStates.delete(tabId);
  pendingSecrets.delete(tabId);
}

// ── Действия из поповера (см. main.ts::registerIpc, PASSWORDS_INDICATOR_*) — всегда про
// ТЕКУЩУЮ активную вкладку (поповер анкерится к omnibox, не к конкретной вкладке в стороне) ──

export function handleSave(): boolean {
  try {
    const pm = passwordManagerRef;
    const tabId = tabManagerRef?.getActiveId();
    if (!pm || !tabId) return false;
    const pending = pendingSecrets.get(tabId);
    const state = tabStates.get(tabId);
    if (!pending || !state || state.kind !== 'offer-save') return false;

    const title = hostnameOf(state.origin);
    const ok = pm.add({ url: state.origin, username: pending.username, password: pending.password, title });
    if (ok) {
      pendingSecrets.delete(tabId);
      tabStates.delete(tabId);
      pushIfActive(tabId, null);
      onListChangedCb?.();
    }
    return ok;
  } catch (e) {
    console.warn('[PasswordAutofill] handleSave error:', (e as Error).message);
    return false;
  }
}

export function handleUpdate(): boolean {
  try {
    const pm = passwordManagerRef;
    const tabId = tabManagerRef?.getActiveId();
    if (!pm || !tabId) return false;
    const pending = pendingSecrets.get(tabId);
    const state = tabStates.get(tabId);
    if (!pending || !state || state.kind !== 'offer-update' || pending.matchId === undefined) return false;

    const ok = pm.update({ id: pending.matchId, password: pending.password });
    if (ok) {
      pendingSecrets.delete(tabId);
      tabStates.delete(tabId);
      pushIfActive(tabId, null);
      onListChangedCb?.();
    }
    return ok;
  } catch (e) {
    console.warn('[PasswordAutofill] handleUpdate error:', (e as Error).message);
    return false;
  }
}

export function handleFill(id: number): boolean {
  try {
    const pm = passwordManagerRef;
    const tm = tabManagerRef;
    const tabId = tm?.getActiveId();
    if (!pm || !tm || !tabId) return false;

    const state = tabStates.get(tabId);
    if (!state || state.kind !== 'has-saved') return false;
    const match = state.matches.find((m) => m.id === id);
    if (!match) return false;

    const activeUrl = tm.getActiveWebContents()?.getURL() ?? '';
    if (originOf(activeUrl) !== state.origin) return false;

    // Перед расшифровкой ещё раз сверяем запись с сейфом: id должен всё ещё принадлежать тому
    // же origin. Только после этого один секрет попадает в гостевой preload конкретной вкладки.
    const meta = pm.list().find((e) => e.id === id && e.origin === state.origin);
    if (!meta) return false;
    const password = pm.reveal(id);
    if (password === null) return false;

    return tm.sendPasswordFill(tabId, { username: match.username, password });
  } catch (e) {
    console.warn('[PasswordAutofill] handleFill error:', (e as Error).message);
    return false;
  }
}

export function handleDismiss(): void {
  try {
    const tabId = tabManagerRef?.getActiveId();
    if (!tabId) return;
    pendingSecrets.delete(tabId);
    tabStates.delete(tabId);
    pushIfActive(tabId, null);
  } catch (e) {
    console.warn('[PasswordAutofill] handleDismiss error:', (e as Error).message);
  }
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}
