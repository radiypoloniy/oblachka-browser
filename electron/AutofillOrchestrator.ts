// Оркестрация автозаполнения форм — связывает сигналы гостевой страницы (TabManager), хранилище
// (AutofillManager) и поповер выбора (AutofillPopoverManager). Тот же приём, что
// PasswordAutofillManager: модуль с функциями + init(), без класса. В отличие от паролей, адреса/
// карты НЕ привязаны к origin — поповер показывает все сохранённые профили.
import type { TabManager } from './TabManager';
import type { AutofillManager } from './AutofillManager';
import type { AddressProfile, CardMeta, AutofillFillFields } from '../shared/ipc';

let tmRef: TabManager | null = null;
let amRef: AutofillManager | null = null;
// Вкладка и вид формы, где было сфокусировано поле — туда уйдёт подстановка после выбора в поповере.
let lastFocusTabId: string | null = null;
let lastKind: 'address' | 'card' | null = null;

export function initAutofillOrchestrator(tm: TabManager, am: AutofillManager): void {
  tmRef = tm;
  amRef = am;
}

export function getLastKind(): 'address' | 'card' | null {
  return lastKind;
}

// Фокус на поле адреса → список профилей для поповера (null — нечего показывать).
export function handleAddressFieldFocus(tabId: string): AddressProfile[] | null {
  lastFocusTabId = tabId;
  lastKind = 'address';
  const list = amRef?.listAddresses() ?? [];
  return list.length > 0 ? list : null;
}

// Фокус на поле карты → список карт для поповера (null — нечего показывать).
export function handleCardFieldFocus(tabId: string): CardMeta[] | null {
  lastFocusTabId = tabId;
  lastKind = 'card';
  const list = amRef?.listCards() ?? [];
  return list.length > 0 ? list : null;
}

// Выбор профиля в поповере → подставляем в ту вкладку, где было сфокусировано поле.
export function handleFillAddress(id: number): boolean {
  if (!amRef || !tmRef || !lastFocusTabId) return false;
  const addr = amRef.listAddresses().find((a) => a.id === id);
  if (!addr) return false;
  return tmRef.sendAutofillFill(lastFocusTabId, addressToFields(addr));
}

// Выбор карты → расшифровываем полный номер (revealCardNumber) и подставляем. ВНИМАНИЕ: гейт
// Windows Hello делается вызывающей стороной (main.ts) ДО вызова этой функции — здесь номер уже
// считается разрешённым к подстановке.
export function handleFillCard(id: number): boolean {
  if (!amRef || !tmRef || !lastFocusTabId) return false;
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
  return tmRef.sendAutofillFill(lastFocusTabId, fields);
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
