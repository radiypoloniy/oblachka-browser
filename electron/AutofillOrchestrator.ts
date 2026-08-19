// Оркестрация автозаполнения форм — связывает сигналы гостевой страницы (TabManager), хранилище
// (AutofillManager) и поповер выбора (AutofillPopoverManager). Тот же приём, что
// PasswordAutofillManager: модуль с функциями + init(), без класса. В отличие от паролей, адреса/
// карты НЕ привязаны к origin — поповер показывает все сохранённые профили.
import type { BrowserWindow } from 'electron';
import type { AutofillManager } from './AutofillManager';
import type { AddressProfile, CardMeta, AddressInput, CardInput, AutofillFillFields } from '../shared/ipc';
import type { AutofillPopoverState } from './AutofillPopoverManager';
import { contextForWindow } from './WindowRegistry';

let amRef: AutofillManager | null = null;

// ⚠️ Состояние — ПО ОКНУ. Формы заполняют в разных окнах независимо, и одна общая запись означала
// бы, что выбор профиля в окне B подставляется в поле, сфокусированное в окне A, а «Сохранить» в
// одном окне кладёт в сейф карту, отправленную в другом. Менеджер вкладок здесь не хранится вовсе:
// он берётся из реестра по окну — так он не может устареть после закрытия окна.
interface WindowAutofill {
  // Вкладка и вид формы, где было сфокусировано поле — туда уйдёт подстановка после выбора в поповере.
  focusTabId: string | null;
  kind: 'address' | 'card' | null;
  // Данные из отправленной формы, ожидающие подтверждения «Сохранить» (offer-save). Полный номер
  // карты живёт здесь в main до явного согласия пользователя; в поповер уходит только маска.
  pendingSave: { kind: 'address'; input: AddressInput } | { kind: 'card'; input: CardInput } | null;
  // Разобранная вставленная строка, ждущая подтверждения «Разложить» (AI-IDEAS.md №1).
  // ⚠️ Держим ЗДЕСЬ, в main, а не в поповере: наружу уходит только предпросмотр, а сами значения
  // до согласия человека никуда не подставляются.
  pendingParse: { tabId: string; fields: AutofillFillFields } | null;
}

const perWindow = new Map<number, WindowAutofill>();

function stateFor(win: BrowserWindow): WindowAutofill {
  const existing = perWindow.get(win.id);
  if (existing) return existing;
  const created: WindowAutofill = { focusTabId: null, kind: null, pendingSave: null, pendingParse: null };
  perWindow.set(win.id, created);
  win.once('closed', () => { perWindow.delete(win.id); });
  return created;
}

export function initAutofillOrchestrator(am: AutofillManager): void {
  amRef = am;
}

export function getLastKind(win: BrowserWindow): 'address' | 'card' | null {
  return perWindow.get(win.id)?.kind ?? null;
}

// Фокус на поле адреса → список профилей для поповера (null — нечего показывать).
export function handleAddressFieldFocus(win: BrowserWindow, tabId: string): AddressProfile[] | null {
  const st = stateFor(win);
  st.focusTabId = tabId;
  st.kind = 'address';
  const list = amRef?.listAddresses() ?? [];
  return list.length > 0 ? list : null;
}

// Фокус на поле карты → список карт для поповера (null — нечего показывать).
export function handleCardFieldFocus(win: BrowserWindow, tabId: string): CardMeta[] | null {
  const st = stateFor(win);
  st.focusTabId = tabId;
  st.kind = 'card';
  const list = amRef?.listCards() ?? [];
  return list.length > 0 ? list : null;
}

// Человек закрыл предложение крестиком → говорим странице запомнить отказ по этому полю.
export function notifyDeclined(win: BrowserWindow): void {
  const st = perWindow.get(win.id);
  const tm = contextForWindow(win)?.tabs;
  if (!tm || !st?.focusTabId) return;
  tm.sendAutofillDeclined(st.focusTabId);
}

// Выбор профиля в поповере → подставляем в ту вкладку, где было сфокусировано поле.
export function handleFillAddress(win: BrowserWindow, id: number): boolean {
  const st = perWindow.get(win.id);
  const tm = contextForWindow(win)?.tabs;
  if (!amRef || !tm || !st?.focusTabId) return false;
  const addr = amRef.listAddresses().find((a) => a.id === id);
  if (!addr) return false;
  return tm.sendAutofillFill(st.focusTabId, addressToFields(addr));
}

// Выбор карты → расшифровываем полный номер (revealCardNumber) и подставляем. ВНИМАНИЕ: гейт
// Windows Hello делается вызывающей стороной (main.ts) ДО вызова этой функции — здесь номер уже
// считается разрешённым к подстановке.
export function handleFillCard(win: BrowserWindow, id: number): boolean {
  const st = perWindow.get(win.id);
  const tm = contextForWindow(win)?.tabs;
  if (!amRef || !tm || !st?.focusTabId) return false;
  const card = amRef.listCards().find((c) => c.id === id);
  if (!card) return false;
  const number = amRef.revealCardNumber(id);
  if (number === null) return false;
  const fields: AutofillFillFields = {
    ccName: card.cardholder,
    ccNumber: number,
    ccExpMonth: card.expMonth ? String(card.expMonth).padStart(2, '0') : '',
    ccExpYear: card.expYear ? String(card.expYear) : '',
    ccExp: card.expMonth && card.expYear ? `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}` : '',
  };
  return tm.sendAutofillFill(st.focusTabId, fields);
}

// ── Разбор вставленной строки (AI-IDEAS.md №1) ──────────────────────────────────────────────
//
// ⚠️ Два шага и человек между ними, как у имени файла по содержимому: «разобрать» ничего не
// трогает на странице, «разложить» подставляет. Промежуточное состояние живёт в main.

/** Запомнить разбор до ответа человека. Возвращает состояние поповера с предпросмотром. */
export function handleParsedPaste(
  win: BrowserWindow,
  tabId: string,
  parts: { key: keyof AutofillFillFields; label: string; value: string }[],
): AutofillPopoverState | null {
  if (parts.length === 0) return null;
  const st = stateFor(win);
  const fields: AutofillFillFields = {};
  for (const p of parts) fields[p.key] = p.value;
  st.pendingParse = { tabId, fields };
  return { kind: 'parse-address', parts: parts.map((p) => ({ label: p.label, value: p.value })) };
}

/** Человек нажал «Разложить» — подставляем в ту же вкладку, где он вставлял строку. */
export function handleApplyParsedPaste(win: BrowserWindow): boolean {
  const st = perWindow.get(win.id);
  const tm = contextForWindow(win)?.tabs;
  const pending = st?.pendingParse ?? null;
  if (st) st.pendingParse = null; // одноразовое: второй раз подставлять нечего
  if (!tm || !pending) return false;
  return tm.sendAutofillFill(pending.tabId, pending.fields);
}

/** Отказ или закрытие поповера — разбор забываем, ничего не подставив. */
export function forgetParsedPaste(win: BrowserWindow): void {
  const st = perWindow.get(win.id);
  if (st) st.pendingParse = null;
}

// ── Offer-save после отправки формы ─────────────────────────────────────────────────────────
// Решает, предлагать ли сохранить отправленные данные (новые, не дубль). Возвращает состояние
// поповера-предложения или null. Полный номер карты кладём в pendingSave (main), в поповер — маска.
export function handleAutofillSubmit(win: BrowserWindow, kind: 'address' | 'card', fields: AutofillFillFields): AutofillPopoverState | null {
  if (!amRef) return null;
  const st = stateFor(win);
  if (kind === 'card') {
    const digits = (fields.ccNumber ?? '').replace(/\D/g, '');
    if (digits.length < 12) return null;
    const last4 = digits.slice(-4);
    // Дубль по последним 4 цифрам — не спамим предложением уже сохранённой картой.
    if (amRef.listCards().some((c) => c.last4 === last4)) return null;
    const { month, year } = parseExp(fields);
    const input: CardInput = { cardholder: fields.ccName ?? '', number: digits, expMonth: month, expYear: year };
    st.pendingSave = { kind: 'card', input };
    return { kind: 'save-card', title: `•••• ${last4}`, sub: input.cardholder };
  }
  const input = fieldsToAddress(fields);
  if (meaningfulCount(input) < 2) return null;
  if (amRef.listAddresses().some((a) => sameAddress(a, input))) return null; // уже сохранён
  st.pendingSave = { kind: 'address', input };
  return {
    kind: 'save-address',
    title: input.fullName || input.email || input.phone || 'Адрес',
    sub: [input.street, input.city].filter(Boolean).join(', '),
  };
}

// Подтверждение «Сохранить» из поповера — кладём отложенные данные в хранилище.
export function saveSubmitted(win: BrowserWindow): boolean {
  const st = perWindow.get(win.id);
  if (!amRef || !st?.pendingSave) return false;
  const pending = st.pendingSave;
  const ok = pending.kind === 'card' ? amRef.addCard(pending.input) : amRef.addAddress(pending.input);
  st.pendingSave = null;
  return ok;
}

function parseExp(f: AutofillFillFields): { month: number; year: number } {
  let month = Number((f.ccExpMonth ?? '').replace(/\D/g, ''));
  let year = Number((f.ccExpYear ?? '').replace(/\D/g, ''));
  if ((!month || !year) && f.ccExp) {
    const m = f.ccExp.match(/(\d{1,2})\s*[/\-.]\s*(\d{2,4})/);
    if (m) { month = Number(m[1]); year = Number(m[2]); }
  }
  if (year && year < 100) year += 2000;
  return { month: month || 0, year: year || 0 };
}

function fieldsToAddress(f: AutofillFillFields): AddressInput {
  const fullName = f.fullName || [f.givenName, f.familyName].filter(Boolean).join(' ');
  return {
    fullName: fullName ?? '', organization: f.organization ?? '', email: f.email ?? '',
    phone: f.phone ?? '', street: f.street ?? '', city: f.city ?? '', region: f.region ?? '',
    postalCode: f.postalCode ?? '', country: f.country ?? '',
  };
}

function meaningfulCount(a: AddressInput): number {
  return [a.fullName, a.email, a.phone, a.street, a.city, a.postalCode].filter((v) => v && v.trim()).length;
}

// Дубль адреса: совпал непустой e-mail ЛИБО связка улица+город+индекс — этого достаточно, чтобы
// не предлагать сохранить уже известное.
function sameAddress(a: AddressProfile, b: AddressInput): boolean {
  const eq = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();
  if (a.email && b.email && eq(a.email, b.email)) return true;
  if (a.street && b.street && eq(a.street, b.street) && eq(a.city, b.city) && eq(a.postalCode, b.postalCode)) return true;
  return false;
}

// Раскладываем адрес по словарю категорий полей (см. shared/ipc.ts::AutofillFieldKey). fullName
// дополнительно бьём на given/family — на формах с раздельными полями имени/фамилии.
function addressToFields(a: AddressProfile): AutofillFillFields {
  const parts = a.fullName.trim().split(/\s+/).filter(Boolean);
  const givenName = parts[0] ?? '';
  const familyName = parts.slice(1).join(' ');
  return {
    fullName: a.fullName,
    givenName,
    familyName,
    email: a.email,
    phone: a.phone,
    street: a.street,
    city: a.city,
    region: a.region,
    postalCode: a.postalCode,
    country: a.country,
    organization: a.organization,
  };
}
