// Разбор ответа модели на части адреса + проверки кодом (AI-IDEAS.md №1).
//
// ⚠️ Живёт ОТДЕЛЬНО и БЕЗ единого импорта — намеренно, тем же приёмом, что shared/fileNameSafety.ts
// и electron/bookmarksSchema.ts. Это слой, который решает, что именно ляжет в форму доставки:
// ошибка здесь — посылка, уехавшая по чужому индексу, и заметить её человеку почти нечем. Без
// зависимостей его гоняет обычный node (npm run address-parse-check).

/** Ключи полей формы, которые умеет отдать разбор (подмножество AutofillFieldKey). */
export type AddressPartKey = 'fullName' | 'postalCode' | 'city' | 'street' | 'phone' | 'email';

export interface AddressPart {
  key: AddressPartKey;
  /** Как назвать часть человеку в предпросмотре. */
  label: string;
  value: string;
}

const PART_LABELS: Record<AddressPartKey, string> = {
  fullName: 'Имя',
  postalCode: 'Индекс',
  city: 'Город',
  street: 'Адрес',
  phone: 'Телефон',
  email: 'Почта',
};

/**
 * Значение помеченной строки. Каждая метка разбирается САМА ПО СЕБЕ — кривая строка не утаскивает
 * за собой соседние (приём RuleParser.ts).
 */
export function labelled(out: string, label: string): string {
  const m = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im').exec(out);
  const v = (m?.[1] ?? '').trim().replace(/^["'«»]|["'«»]$/g, '').trim();
  // Прочерк и словесное «нет» — это «части не было», а не значение.
  if (!v || v === '-' || /^(нет|none|n\/a|null|—|–)$/i.test(v)) return '';
  return v;
}

/**
 * ⚠️ Индекс проверяется КОДОМ, а не доверием к модели. Российский индекс — РОВНО шесть цифр;
 * «похожее на индекс» число подставлять нельзя: пустое поле человек заметит и заполнит, а
 * подменённое может не заметить вовсе.
 */
export function cleanPostal(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return /^\d{6}$/.test(digits) ? digits : '';
}

/**
 * ⚠️ Телефон проверяется по КОЛИЧЕСТВУ цифр, но возвращается как написал человек: форматы полей
 * на сайтах разные, а переписанный нами номер человек уже не узнает глазами при проверке — то
 * есть предпросмотр перестанет быть проверкой.
 */
export function cleanPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return '';
  return raw.replace(/\s+/g, ' ').trim();
}

export function cleanEmail(raw: string): string {
  const v = raw.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : '';
}

/** Сколько частей делает разбор осмысленным (см. ниже). */
export const MIN_PARTS = 2;

/**
 * Собирает части из сырого ответа модели.
 *
 * ⚠️ Меньше двух частей — это НЕ разбор: строку целиком с тем же успехом вставит сам человек, а
 * предложение «разложить по полям» ради одного поля выглядит навязчивым. Возвращаем пусто —
 * поповер тогда просто не появится, и человек даже не узнает, что мы пробовали.
 */
export function partsFromModelOutput(out: string): AddressPart[] {
  const parts: AddressPart[] = [];
  const push = (key: AddressPartKey, value: string): void => {
    if (value) parts.push({ key, label: PART_LABELS[key], value });
  };
  push('fullName', labelled(out, 'NAME'));
  push('postalCode', cleanPostal(labelled(out, 'POSTAL')));
  push('city', labelled(out, 'CITY'));
  push('street', labelled(out, 'STREET'));
  push('phone', cleanPhone(labelled(out, 'PHONE')));
  push('email', cleanEmail(labelled(out, 'EMAIL')));
  return parts.length >= MIN_PARTS ? parts : [];
}
