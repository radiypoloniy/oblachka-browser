// Менеджер паролей, шаг 2 — оркестрация между TabManager (сигналы с гостевых страниц),
// PasswordManager (сейф) и chrome UI (индикатор-«ключ» + поповер). Тот же приём, что
// AiPanelManager.ts/TranslatePopoverManager.ts: модуль с экспортированными функциями +
// setTabManager(), не класс — сама «бизнес-логика вкладок» остаётся в TabManager.ts, этот модуль
// только реагирует на её колбэки.
import type { BrowserWindow } from 'electron';
import type { TabManager } from './TabManager';
import type { PasswordManager } from './PasswordManager';
import { originOf } from './PasswordManager';
import type { PasswordIndicatorState } from '../shared/ipc';
import { contextForWindow } from './WindowRegistry';

// ⚠️ Менеджер вкладок здесь НЕ хранится: каждая точка входа получает окно, а вкладки берутся из
// реестра по нему. Прежняя единственная ссылка означала бы, что форма входа в одном окне ищет
// активную вкладку в другом — и пароль ушёл бы на чужую страницу. Состояние по вкладкам (ниже)
// общее на все окна намеренно: ключ — id вкладки, а он уникален в приложении.
let passwordManagerRef: PasswordManager | null = null;
let onIndicatorChangedCb: ((win: BrowserWindow, state: PasswordIndicatorState | null) => void) | null = null;
let onListChangedCb: (() => void) | null = null;

function tabsOf(win: BrowserWindow): TabManager | null {
  return contextForWindow(win)?.tabs ?? null;
}

// Текущее состояние индикатора по вкладке — chrome видит только состояние АКТИВНОЙ (см.
// pushIfActive). Ожидающий подтверждения секрет — ОТДЕЛЬНАЯ карта, никогда не пересекает
// границу IPC как есть (только через handleSave/handleUpdate, которые сами зовут PasswordManager).
const tabStates = new Map<string, PasswordIndicatorState | null>();
const pendingSecrets = new Map<string, { username: string; password: string; matchId?: number }>();
// Сгенерированный из поля пароль СРАЗУ сохранён в сейф (см. handleGenerateAndFill — фикс дыры
// «сгенерировали и потеряли»); здесь помним id записи, чтобы первый submit с этим паролем и
// непустым логином молча дописал логин в ту же запись, а не предлагал сохранить дубликат.
const pendingGenerated = new Map<string, { origin: string; password: string; id: number }>();
// Автозаполнение без кликов: origin, уже заполненный в этой вкладке, — чтобы не перезаполнять
// на каждый пересчёт формы (SPA держит форму в DOM постоянно). Сбрасывается, когда форма ушла.
const autofilledTabs = new Map<string, string>();

export function init(
  pm: PasswordManager,
  onIndicatorChanged: (win: BrowserWindow, state: PasswordIndicatorState | null) => void,
  onListChanged: () => void,
): void {
  passwordManagerRef = pm;
  onIndicatorChangedCb = onIndicatorChanged;
  onListChangedCb = onListChanged;
}

// Индикатор-«ключ» показывает состояние АКТИВНОЙ вкладки — и активной именно в том окне, откуда
// пришёл сигнал: в соседнем окне активна своя вкладка, и подсветить там чужой ключ было бы враньём.
function pushIfActive(win: BrowserWindow, tabId: string, state: PasswordIndicatorState | null): void {
  if (tabsOf(win)?.getActiveId() !== tabId) return;
  onIndicatorChangedCb?.(win, state);
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
export function handleFieldIconClick(_win: BrowserWindow, tabId: string, url: string): PasswordIndicatorState | null {
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

export async function handleGenerateAndFill(win: BrowserWindow): Promise<boolean> {
  try {
    const pm = passwordManagerRef;
    const tm = tabsOf(win);
    const tabId = tm?.getActiveId();
    if (!pm || !tm || !tabId) return false;

    const state = tabStates.get(tabId);
    if (!state || state.kind !== 'offer-generate') return false;

    const activeUrl = tm.getActiveWebContents()?.getURL() ?? '';
    if (originOf(activeUrl) !== state.origin) return false;

    const password = pm.generate(INLINE_GENERATE_OPTS);
    // Только пароль (username отсутствует в payload) — не трогаем поле логина, пользователь
    // мог его уже начать заполнять.
    const filled = tm.sendPasswordFill(tabId, { password });
    if (!filled) return false;

    // Фикс дыры «сгенерировали и потеряли»: пароль сохраняется в сейф НЕМЕДЛЕННО (с пустым
    // username — логина мы ещё не знаем), а не «когда-нибудь на submit» — раньше при пропуске
    // submit-детектора (не всякая SPA ловится) свежесозданный аккаунт оставался без пароля.
    // Первый submit с этим же паролем и непустым логином молча допишет логин в эту же запись
    // (см. handleCredentialSubmitted), а не создаст дубликат.
    const title = hostnameOf(state.origin);
    if (pm.add({ url: state.origin, username: '', password, title })) {
      // add() возвращает только boolean — id свежей записи достаём из list() (самая новая
      // запись этого origin с пустым username); API сейфа ради этого не расширяем.
      const entry = pm.list()
        .filter((e) => e.origin === state.origin && e.username === '')
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (entry) pendingGenerated.set(tabId, { origin: state.origin, password, id: entry.id });
      onListChangedCb?.();
    }
    return true;
  } catch (e) {
    console.warn('[PasswordAutofill] handleGenerateAndFill error:', (e as Error).message);
    return false;
  }
}

export function handleFormDetected(win: BrowserWindow, tabId: string, hasLoginForm: boolean, hasUsernameField: boolean, url: string): void {
  try {
    const pm = passwordManagerRef;
    if (!pm) return;
    if (!hasLoginForm) {
      // Форма ушла (логин успешен / страница сменилась) — следующее её появление на этом
      // origin (например, после logout) снова получит автозаполнение.
      autofilledTabs.delete(tabId);
      tabStates.delete(tabId);
      pushIfActive(win, tabId, null);
      return;
    }
    const origin = originOf(url);
    const state = computeHasSavedState(pm, origin);
    tabStates.set(tabId, state);
    pushIfActive(win, tabId, state);

    // Автозаполнение без кликов (как у Яндекса): для origin сохранён РОВНО один логин —
    // подставляем сразу при обнаружении формы. Несколько сохранённых — неоднозначно, ждём
    // выбора через иконку в поле/поповер. onlyIfEmpty — не затирать уже введённое руками
    // (preload-content пропустит непустые поля). Повторно не заполняем, пока форма не
    // исчезала (см. autofilledTabs) — иначе на SPA, где форма живёт в DOM постоянно,
    // перезаполняли бы на каждый пересчёт.
    if (state !== null && state.kind === 'has-saved' && state.matches.length === 1
      && autofilledTabs.get(tabId) !== origin) {
      const match = state.matches[0]!;
      const password = pm.reveal(match.id);
      if (password !== null
        && tabsOf(win)?.sendPasswordFill(tabId, { username: match.username, password, onlyIfEmpty: true })) {
        autofilledTabs.set(tabId, origin);
      }
    }
  } catch (e) {
    console.warn('[PasswordAutofill] handleFormDetected error:', (e as Error).message);
  }
}

export function handleCredentialSubmitted(win: BrowserWindow, tabId: string, username: string, password: string, url: string): void {
  try {
    const pm = passwordManagerRef;
    if (!pm) return;
    const origin = originOf(url);

    // Сгенерированный из поля пароль уже лежит в сейфе с пустым username (handleGenerateAndFill):
    // первый submit тем же паролем дописывает логин в ТУ ЖЕ запись молча — без offer-save,
    // который создал бы дубликат. Если пароль успели сменить руками — обычный путь ниже.
    const generated = pendingGenerated.get(tabId);
    if (generated !== undefined && generated.origin === origin && generated.password === password) {
      if (username !== '' && pm.update({ id: generated.id, username })) {
        onListChangedCb?.();
      }
      pendingGenerated.delete(tabId);
      tabStates.delete(tabId);
      pushIfActive(win, tabId, null);
      return;
    }

    const result = pm.checkCredential(origin, username, password);

    if (result.status === 'match') {
      // Уже сохранено ровно так же — ничего не предлагаем (никогда не спамим уже известным).
      pendingSecrets.delete(tabId);
      tabStates.delete(tabId);
      pushIfActive(win, tabId, null);
      return;
    }

    const state: PasswordIndicatorState = result.status === 'new'
      ? { kind: 'offer-save', origin, username }
      : { kind: 'offer-update', origin, username, matchId: result.matchId! };
    pendingSecrets.set(tabId, { username, password, matchId: result.status === 'differs' ? result.matchId : undefined });
    tabStates.set(tabId, state);
    pushIfActive(win, tabId, state);
  } catch (e) {
    console.warn('[PasswordAutofill] handleCredentialSubmitted error:', (e as Error).message);
  }
}

// ── Реакция на смену активной вкладки / закрытие (main.ts подключает к уже существующим
// колбэкам TabManager — onActiveTabChangedCb/onTabClosedCb, без новых параметров конструктора) ──

export function onActiveTabChanged(win: BrowserWindow): void {
  try {
    const tabId = tabsOf(win)?.getActiveId();
    if (!tabId) return;
    onIndicatorChangedCb?.(win, tabStates.get(tabId) ?? null);
  } catch (e) {
    console.warn('[PasswordAutofill] onActiveTabChanged error:', (e as Error).message);
  }
}

export function onTabClosed(tabId: string): void {
  tabStates.delete(tabId);
  pendingSecrets.delete(tabId);
  pendingGenerated.delete(tabId);
  autofilledTabs.delete(tabId);
}

// ── Действия из поповера (см. main.ts::registerIpc, PASSWORDS_INDICATOR_*) — всегда про
// ТЕКУЩУЮ активную вкладку (поповер анкерится к omnibox, не к конкретной вкладке в стороне) ──

export function handleSave(win: BrowserWindow): boolean {
  try {
    const pm = passwordManagerRef;
    const tabId = tabsOf(win)?.getActiveId();
    if (!pm || !tabId) return false;
    const pending = pendingSecrets.get(tabId);
    const state = tabStates.get(tabId);
    if (!pending || !state || state.kind !== 'offer-save') return false;

    const title = hostnameOf(state.origin);
    const ok = pm.add({ url: state.origin, username: pending.username, password: pending.password, title });
    if (ok) {
      pendingSecrets.delete(tabId);
      tabStates.delete(tabId);
      pushIfActive(win, tabId, null);
      onListChangedCb?.();
    }
    return ok;
  } catch (e) {
    console.warn('[PasswordAutofill] handleSave error:', (e as Error).message);
    return false;
  }
}

export function handleUpdate(win: BrowserWindow): boolean {
  try {
    const pm = passwordManagerRef;
    const tabId = tabsOf(win)?.getActiveId();
    if (!pm || !tabId) return false;
    const pending = pendingSecrets.get(tabId);
    const state = tabStates.get(tabId);
    if (!pending || !state || state.kind !== 'offer-update' || pending.matchId === undefined) return false;

    const ok = pm.update({ id: pending.matchId, password: pending.password });
    if (ok) {
      pendingSecrets.delete(tabId);
      tabStates.delete(tabId);
      pushIfActive(win, tabId, null);
      onListChangedCb?.();
    }
    return ok;
  } catch (e) {
    console.warn('[PasswordAutofill] handleUpdate error:', (e as Error).message);
    return false;
  }
}

export function handleFill(win: BrowserWindow, id: number): boolean {
  try {
    const pm = passwordManagerRef;
    const tm = tabsOf(win);
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

export function handleDismiss(win: BrowserWindow): void {
  try {
    const tabId = tabsOf(win)?.getActiveId();
    if (!tabId) return;
    pendingSecrets.delete(tabId);
    tabStates.delete(tabId);
    pushIfActive(win, tabId, null);
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
