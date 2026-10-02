// Менеджер паролей, шаг 2 — оркестрация между TabManager (сигналы с гостевых страниц),
// PasswordManager (сейф) и chrome UI (индикатор-«ключ» + поповер). Тот же приём, что
// AiPanelManager.ts/TranslatePopoverManager.ts: модуль с экспортированными функциями +
// setTabManager(), не класс — сама «бизнес-логика вкладок» остаётся в TabManager.ts, этот модуль
// только реагирует на её колбэки.
import type { BrowserWindow } from 'electron';
import type { TabManager } from './TabManager';
import type { PasswordManager } from './PasswordManager';
import { originOf } from './PasswordManager';
import type { PasswordIndicatorState, PasswordPreferences } from '../shared/ipc';
import type { PasswordFieldContext, PasswordFieldTrigger } from '../shared/ipc';
import { nextIndicatorState, shouldAutofill } from '../shared/passwordIndicator';
import { contextForWindow } from './WindowRegistry';
import {
  dedupeAnonymousPasswordMatches, passwordMatchesForOrigin, passwordOriginMatch,
} from './passwordOriginMatching';

// ⚠️ Менеджер вкладок здесь НЕ хранится: каждая точка входа получает окно, а вкладки берутся из
// реестра по нему. Прежняя единственная ссылка означала бы, что форма входа в одном окне ищет
// активную вкладку в другом — и пароль ушёл бы на чужую страницу. Состояние по вкладкам (ниже)
// общее на все окна намеренно: ключ — id вкладки, а он уникален в приложении.
let passwordManagerRef: PasswordManager | null = null;
let onIndicatorChangedCb: ((win: BrowserWindow, state: PasswordIndicatorState | null) => void) | null = null;
let onListChangedCb: (() => void) | null = null;
let getPreferencesCb: (() => PasswordPreferences) | null = null;
let authorizeFillCb: (() => Promise<boolean>) | null = null;
let blockOriginCb: ((origin: string) => void) | null = null;

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
const usernameCandidates = new Map<string, { origin: string; username: string }>();

export function init(
  pm: PasswordManager,
  onIndicatorChanged: (win: BrowserWindow, state: PasswordIndicatorState | null) => void,
  onListChanged: () => void,
  getPreferences: () => PasswordPreferences,
  authorizeFill: () => Promise<boolean>,
  blockOrigin: (origin: string) => void,
): void {
  passwordManagerRef = pm;
  onIndicatorChangedCb = onIndicatorChanged;
  onListChangedCb = onListChanged;
  getPreferencesCb = getPreferences;
  authorizeFillCb = authorizeFill;
  blockOriginCb = blockOrigin;
}

function preferences(): PasswordPreferences {
  return getPreferencesCb?.() ?? {
    offerToSave: true, autofill: true, suggestStrong: true, fillAuthMode: 'never', blockedOrigins: [],
  };
}

// Индикатор-«ключ» показывает состояние АКТИВНОЙ вкладки — и активной именно в том окне, откуда
// пришёл сигнал: в соседнем окне активна своя вкладка, и подсветить там чужой ключ было бы враньём.
function pushIfActive(win: BrowserWindow, tabId: string, state: PasswordIndicatorState | null): void {
  if (tabsOf(win)?.getActiveId() !== tabId) return;
  onIndicatorChangedCb?.(win, state);
}

function computeHasSavedState(
  pm: PasswordManager,
  origin: string,
): Extract<PasswordIndicatorState, { kind: 'has-saved' }> | null {
  const entries = dedupeAnonymousPasswordMatches(passwordMatchesForOrigin(pm.list(), origin), (id) => pm.reveal(id));
  const matches = entries.map((e) => ({ id: e.id, username: e.username, path: pathOf(e.url) }));
  return matches.length > 0 ? { kind: 'has-saved', origin, matches } : null;
}

// ── Сигналы с гостевой страницы (см. TabManager.ts::onPasswordFormCb/onPasswordSubmitCb) ──────

// Клик по иконке в поле пароля (не в тулбаре) — см. TabManager.ts::onPasswordFieldIconClickCb,
// electron/preload-content.ts. Решает, что показать в поповере: тот же расчёт, что уже даёт
// has-saved (сохранённый логин есть — предложить подставить), либо, если для origin вообще
// ничего не сохранено, offer-generate (похоже на регистрацию — предложить сгенерировать).
// Позиция поповера (заякорен на поле, не на тулбар) считается вызывающей стороной (main.ts) —
// этот модуль ничего не знает про геометрию окна.
export function handleFieldInteraction(
  _win: BrowserWindow,
  tabId: string,
  url: string,
  trigger: PasswordFieldTrigger,
  context: PasswordFieldContext,
): PasswordIndicatorState | null {
  try {
    const pm = passwordManagerRef;
    if (!pm) return null;
    const origin = originOf(url);
    const prefs = preferences();
    const saved = computeHasSavedState(pm, origin);
    if (saved) {
      if (!prefs.autofill && trigger === 'focus') return null;
      const allowGenerate = prefs.suggestStrong
        && (context.role === 'new' || context.formKind === 'signup' || context.formKind === 'change');
      const state: PasswordIndicatorState = { ...saved, allowGenerate };
      tabStates.set(tabId, state);
      return state;
    }
    // Автоматически предлагаем генерацию только там, где страница обозначила новый пароль или
    // форма похожа на регистрацию/смену. Иконка остаётся явным аварийным входом для кривых сайтов.
    const mayGenerate = prefs.suggestStrong && (trigger === 'icon'
      || context.role === 'new'
      || context.formKind === 'signup'
      || context.formKind === 'change');
    if (!mayGenerate) {
      tabStates.delete(tabId);
      return null;
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
    if (!preferences().suggestStrong) return false;
    const tm = tabsOf(win);
    const tabId = tm?.getActiveId();
    if (!pm || !tm || !tabId) return false;

    const state = tabStates.get(tabId);
    // ⚠️ Не только 'offer-generate': на форме СМЕНЫ пароля сохранённый вход для сайта есть, то
    // есть карточка показывает список аккаунтов, — а нужен как раз новый пароль. Оба состояния
    // несут origin, и он ниже сверяется с адресом активной вкладки, так что прав не прибавляется.
    if (!state || (state.kind !== 'offer-generate'
      && !(state.kind === 'has-saved' && state.allowGenerate === true))) return false;

    const activeUrl = tm.getActiveWebContents()?.getURL() ?? '';
    if (originOf(activeUrl) !== state.origin) return false;

    const password = pm.generate(INLINE_GENERATE_OPTS);
    // Фикс дыры «сгенерировали и потеряли»: пароль сохраняется в сейф НЕМЕДЛЕННО (с пустым
    // username — логина мы ещё не знаем), а не «когда-нибудь на submit» — раньше при пропуске
    // submit-детектора (не всякая SPA ловится) свежесозданный аккаунт оставался без пароля.
    // Первый submit с этим же паролем и непустым логином молча допишет логин в эту же запись
    // (см. handleCredentialSubmitted), а не создаст дубликат.
    const title = hostnameOf(state.origin);
    // Не отдаём странице секрет, пока сейф не подтвердил запись: регистрация может пройти
    // даже при ошибке диска, и тогда человек останется без сохранённого пароля.
    if (!pm.add({ url: state.origin, username: '', password, title })) return false;
    // add() возвращает только boolean — id свежей записи достаём из list() (самая новая
    // запись этого origin с пустым username); API сейфа ради этого не расширяем.
    const entry = pm.list()
      .filter((e) => e.origin === state.origin && e.username === '')
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (entry) {
      const candidate = usernameCandidates.get(tabId);
      if (candidate?.origin === state.origin && pm.update({ id: entry.id, username: candidate.username })) {
        entry.username = candidate.username;
      }
      pendingGenerated.set(tabId, { origin: state.origin, password, id: entry.id });
    }
    onListChangedCb?.();
    // При неудачной подстановке запись сохраняем: удалять уже сохранённый секрет опаснее.
    return tm.sendPasswordFill(tabId, { password, mode: 'generated' });
  } catch (e) {
    console.warn('[PasswordAutofill] handleGenerateAndFill error:', (e as Error).message);
    return false;
  }
}

// _hasUsernameField приходит от детектора формы и здесь не нужен: решение принимается по наличию
// формы и по сохранённым для origin входам. Подчёркивание — метка «знаем, что не используем»;
// убрать параметр нельзя, это форма колбэка TabManager (см. onPasswordFormCb).
export function handleFormDetected(win: BrowserWindow, tabId: string, hasLoginForm: boolean, _hasUsernameField: boolean, url: string): void {
  try {
    const pm = passwordManagerRef;
    if (!pm) return;
    const origin = originOf(url);

    // Само правило перехода — в shared/passwordIndicator.ts (чистая логика под тестом): там же
    // разобрано, почему незакрытое предложение обязано пережить пересчёт формы.
    const entries = dedupeAnonymousPasswordMatches(passwordMatchesForOrigin(pm.list(), origin), (id) => pm.reveal(id));
    const saved = entries.map((e) => ({ id: e.id, username: e.username, path: pathOf(e.url) }));
    const decision = nextIndicatorState(tabStates.get(tabId) ?? null, hasLoginForm, origin, saved);
    if (decision.keep) {
      if (!hasLoginForm) autofilledTabs.delete(tabId);
      return;
    }
    if (!hasLoginForm) {
      // Форма ушла — следующее её появление на этом origin (например, после logout) снова
      // получит автозаполнение.
      autofilledTabs.delete(tabId);
    }
    const state = decision.state;
    if (state === null) tabStates.delete(tabId); else tabStates.set(tabId, state);
    pushIfActive(win, tabId, state);

    // Автозаполнение без кликов (как у Яндекса). onlyIfEmpty — не затирать уже введённое руками
    // (preload-content пропустит непустые поля).
    const match = shouldAutofill(state, origin, autofilledTabs.get(tabId));
    if (match && preferences().autofill) void fillMatch(win, tabId, origin, match, true);
  } catch (e) {
    console.warn('[PasswordAutofill] handleFormDetected error:', (e as Error).message);
  }
}

export function handleCredentialSubmitted(win: BrowserWindow, tabId: string, username: string, password: string, url: string): void {
  try {
    const pm = passwordManagerRef;
    if (!pm) return;
    const origin = originOf(url);
    if (username === '') {
      const candidate = usernameCandidates.get(tabId);
      if (candidate?.origin === origin) username = candidate.username;
    }
    const prefs = preferences();
    if (!prefs.offerToSave || prefs.blockedOrigins.includes(origin)) {
      pendingSecrets.delete(tabId);
      tabStates.delete(tabId);
      pushIfActive(win, tabId, null);
      return;
    }

    // Сгенерированный из поля пароль уже лежит в сейфе с пустым username (handleGenerateAndFill):
    // первый submit тем же паролем дописывает логин в ТУ ЖЕ запись молча — без offer-save,
    // который создал бы дубликат. Если пароль успели сменить руками — обычный путь ниже.
    const generated = pendingGenerated.get(tabId);
    if (generated !== undefined && generated.origin === origin && generated.password === password) {
      if (username !== '') {
        if (pm.update({ id: generated.id, username })) {
          onListChangedCb?.();
        } else {
          // Такой origin+username уже есть: это смена пароля существующего аккаунта. Обновляем
          // именно его и удаляем временную безымянную запись — иначе новый пароль остался бы
          // сиротой, а старый продолжил бы автозаполняться.
          const existing = pm.checkCredential(origin, username, password);
          if (existing.status === 'differs' && existing.matchId !== undefined
            && pm.update({ id: existing.matchId, password })) {
            pm.delete(generated.id);
            onListChangedCb?.();
          } else if (existing.status === 'match') {
            pm.delete(generated.id);
            onListChangedCb?.();
          }
        }
      }
      pendingGenerated.delete(tabId);
      tabStates.delete(tabId);
      pushIfActive(win, tabId, null);
      return;
    }

    // ⚠️ Запись с ПУСТЫМ логином — это след генератора (handleGenerateAndFill кладёт пароль в сейф
    // сразу, логина он ещё не знает). Дописать его должен был путь pendingGenerated выше, но он
    // держится в памяти и только для этой вкладки: перезапуск приложения, регистрация в соседней
    // вкладке или потерянный submit — и логин не узнаётся уже никогда. А checkCredential ищет по
    // паре origin+username, поэтому такую запись он не найдёт по определению и ответит 'new' —
    // человек получал предложение сохранить ВТОРУЮ запись, а первая навсегда оставалась без
    // логина. Отсюда жалоба «пароль сохраняется, а логин нет». Дописываем молча: пароль тот же,
    // origin тот же — это та же учётка, а не новая.
    if (username !== '') {
      const blank = pm.list().find((e) => e.origin === origin && e.username === '' && pm.reveal(e.id) === password);
      if (blank && pm.update({ id: blank.id, username })) {
        onListChangedCb?.();
        pendingGenerated.delete(tabId);
        tabStates.delete(tabId);
        pushIfActive(win, tabId, null);
        return;
      }
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

export function handleUsernameCaptured(tabId: string, username: string, url: string): void {
  const value = username.trim();
  if (!value) return;
  const origin = originOf(url);
  usernameCandidates.set(tabId, { origin, username: value });
  const generated = pendingGenerated.get(tabId);
  const pm = passwordManagerRef;
  if (pm && generated?.origin === origin && pm.update({ id: generated.id, username: value })) {
    onListChangedCb?.();
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
  usernameCandidates.delete(tabId);
}

// ── Действия из поповера (см. main.ts::registerIpc, PASSWORDS_INDICATOR_*) — всегда про
// ТЕКУЩУЮ активную вкладку (поповер анкерится к omnibox, не к конкретной вкладке в стороне) ──

export function handleSave(win: BrowserWindow, usernameOverride?: string): boolean {
  try {
    const pm = passwordManagerRef;
    const tabId = tabsOf(win)?.getActiveId();
    if (!pm || !tabId) return false;
    const pending = pendingSecrets.get(tabId);
    const state = tabStates.get(tabId);
    if (!pending || !state || state.kind !== 'offer-save') return false;

    const title = hostnameOf(state.origin);
    const username = typeof usernameOverride === 'string' ? usernameOverride.trim().slice(0, 320) : pending.username;
    const ok = pm.add({ url: state.origin, username, password: pending.password, title });
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

export function handleUpdate(win: BrowserWindow, usernameOverride?: string): boolean {
  try {
    const pm = passwordManagerRef;
    const tabId = tabsOf(win)?.getActiveId();
    if (!pm || !tabId) return false;
    const pending = pendingSecrets.get(tabId);
    const state = tabStates.get(tabId);
    if (!pending || !state || state.kind !== 'offer-update' || pending.matchId === undefined) return false;

    const username = typeof usernameOverride === 'string' ? usernameOverride.trim().slice(0, 320) : undefined;
    const ok = pm.update({ id: pending.matchId, password: pending.password, username });
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

export async function handleFill(win: BrowserWindow, id: number): Promise<boolean> {
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

    // Точный origin можно подставлять автоматически; соседний поддомен — только после этого
    // явного клика человека. Public Suffix List не даёт смешать разных арендаторов вроде
    // a.github.io и b.github.io.
    const meta = pm.list().find((e) => e.id === id && passwordOriginMatch(state.origin, e.origin) !== null);
    if (!meta) return false;
    if (!(await (authorizeFillCb?.() ?? Promise.resolve(true)))) return false;
    // Пока был открыт системный диалог, вкладка или origin могли смениться.
    if (tm.getActiveId() !== tabId || originOf(tm.getActiveWebContents()?.getURL() ?? '') !== state.origin) return false;
    const password = pm.reveal(id);
    if (password === null) return false;

    return tm.sendPasswordFill(tabId, { username: match.username, password, mode: 'login' });
  } catch (e) {
    console.warn('[PasswordAutofill] handleFill error:', (e as Error).message);
    return false;
  }
}

export function handleDismiss(win: BrowserWindow, permanent = false): void {
  try {
    const tabId = tabsOf(win)?.getActiveId();
    if (!tabId) return;
    const state = tabStates.get(tabId);
    if (permanent && state && (state.kind === 'offer-save' || state.kind === 'offer-update')) {
      blockOriginCb?.(state.origin);
    }
    pendingSecrets.delete(tabId);
    tabStates.delete(tabId);
    pushIfActive(win, tabId, null);
  } catch (e) {
    console.warn('[PasswordAutofill] handleDismiss error:', (e as Error).message);
  }
}

async function fillMatch(
  win: BrowserWindow,
  tabId: string,
  origin: string,
  match: { id: number; username: string },
  onlyIfEmpty: boolean,
): Promise<boolean> {
  const pm = passwordManagerRef;
  const tm = tabsOf(win);
  if (!pm || !tm) return false;
  // Фоновая подстановка строже явного выбора: только запись ровно этого origin.
  const meta = pm.list().find((e) => e.id === match.id && e.origin === origin);
  if (!meta) return false;
  if (!(await (authorizeFillCb?.() ?? Promise.resolve(true)))) return false;
  if (tm.getActiveId() !== tabId || originOf(tm.getActiveWebContents()?.getURL() ?? '') !== origin) return false;
  const password = pm.reveal(match.id);
  if (password === null) return false;
  const filled = tm.sendPasswordFill(tabId, {
    username: match.username, password, onlyIfEmpty, mode: 'login',
  });
  if (filled) autofilledTabs.set(tabId, origin);
  return filled;
}

function hostnameOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

function pathOf(url: string): string | undefined {
  try {
    const path = new URL(url).pathname;
    return path && path !== '/' ? path.slice(0, 120) : undefined;
  } catch {
    return undefined;
  }
}
