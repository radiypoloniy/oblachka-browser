// Оркестрация автозаполнения форм — связывает сигналы гостевой страницы (TabManager), хранилище
// (AutofillManager) и поповер выбора (AutofillPopoverManager). Тот же приём, что
// PasswordAutofillManager: модуль с функциями + init(), без класса. В отличие от паролей, адреса/
// карты НЕ привязаны к origin — поповер показывает все сохранённые профили.
import type { TabManager } from './TabManager';
import type { AutofillManager } from './AutofillManager';
import type { AddressProfile, AutofillFillFields } from '../shared/ipc';

let tmRef: TabManager | null = null;
let amRef: AutofillManager | null = null;
// Вкладка, где было сфокусировано поле — туда уйдёт подстановка после выбора в поповере.
let lastFocusTabId: string | null = null;

export function initAutofillOrchestrator(tm: TabManager, am: AutofillManager): void {
  tmRef = tm;
  amRef = am;
}

// Фокус на поле адреса → список профилей для поповера (null — нечего показывать).
export function handleAddressFieldFocus(tabId: string): AddressProfile[] | null {
  lastFocusTabId = tabId;
  const list = amRef?.listAddresses() ?? [];
  return list.length > 0 ? list : null;
}

// Выбор профиля в поповере → подставляем в ту вкладку, где было сфокусировано поле.
export function handleFillAddress(id: number): boolean {
  if (!amRef || !tmRef || !lastFocusTabId) return false;
  const addr = amRef.listAddresses().find((a) => a.id === id);
  if (!addr) return false;
  return tmRef.sendAutofillFill(lastFocusTabId, addressToFields(addr));
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
