// Разбор скопированной строки с адресом на поля формы (AI-IDEAS.md №1).
//
// Зачем. Человек копирует из письма или мессенджера «Иванов Иван Петрович, 123456, Москва,
// ул. Ленина 1 кв. 5, +7 900 123-45-67» и вставляет в ЛЮБОЕ поле формы доставки. Дальше он
// либо раскладывает это руками по шести полям, либо бросает заказ.
//
// ⚠️ Почему не обычный код. Порядок частей произвольный, разделители любые, «кв. 5» бывает
// отдельным полем и частью улицы, отчество бывает и не бывает. Регулярками надёжно ловятся
// ровно две части из шести — индекс и телефон, — и обе мы как раз и проверяем кодом (см. ниже).
//
// ⚠️ Ответ — ПОМЕЧЕННЫЕ СТРОКИ, а не JSON, и каждая метка разбирается ОТДЕЛЬНО (приём
// RuleParser.ts): кривая строка не утаскивает за собой соседние, а JSON эта модель ломает
// регулярно (ровно поэтому в проекте живёт normalizeQuiz).
//
// ⚠️ Данные предельно личные — домашний адрес и телефон. Наружу не уходит ничего: строку читает
// локальная модель, и только она.
import { runTabOrganizePrompt, isModelWarm } from './TranslationService';
import { partsFromModelOutput, type AddressPart } from '../shared/addressParts';

export type { AddressPart } from '../shared/addressParts';

// Длиннее этого — уже не адрес, а кусок письма; отдавать модели чужой текст незачем.
const MAX_INPUT_CHARS = 400;
// Один разбор за раз: очередь генерации общая, а вставить человек может несколько раз подряд.
let busy = false;

// ⚠️ Инструкция ПО-АНГЛИЙСКИ при русском содержимом — правило проекта (см. TabSearch.ts и
// RuleParser.ts): русские формулировки на задачах разбора заставляют модель пересказывать вход.
function buildPrompt(text: string): string {
  return (
    `A person copied one line with a delivery address, in Russian:\n"${text}"\n\n` +
    `Split it into parts. Rules for your answer:\n` +
    `- Copy the text EXACTLY as written. Do not translate, correct or reformat anything.\n` +
    `- NAME is a person's full name. POSTAL is the postal code (digits only).\n` +
    `- CITY is the settlement alone, without "г." and without the region.\n` +
    `- STREET is the street with house and flat number.\n` +
    `- PHONE is the phone number. EMAIL is the e-mail address.\n` +
    // ⚠️ Прочерк обязателен как ЗАКОННЫЙ ответ: без него модель дописывает недостающее от себя,
    // а выдуманный индекс в форме доставки хуже пустого поля.
    `- If a part is not present in the text, write a dash. Never invent a value.\n\n` +
    `Answer with exactly these six lines and nothing else:\n` +
    `NAME: <full name, or - >\n` +
    `POSTAL: <postal code, or - >\n` +
    `CITY: <city, or - >\n` +
    `STREET: <street, house, flat, or - >\n` +
    `PHONE: <phone, or - >\n` +
    `EMAIL: <e-mail, or - >`
  );
}

/**
 * Разбирает строку на части. Пустой массив — «не разобралось»: предлагать нечего, и поповер
 * просто не появится (человек даже не узнает, что мы пробовали).
 *
 * ⚠️ Ничего не подставляет. Подстановку делает человек, увидев предпросмотр.
 */
export async function parseAddressBlob(
  text: string,
  opts: { explicit?: boolean } = {},
): Promise<AddressPart[]> {
  const input = text.trim().slice(0, MAX_INPUT_CHARS);
  if (input.length < 12) return [];
  // ⚠️ Два разных повода — два разных правила, и разница не косметическая.
  //  • вставка в поле НА СТРАНИЦЕ (explicit=false): человек вставил строку, а разбор не заказывал,
  //    поэтому только тёплая модель и фоновая полоса. Будить ради этого 9B на полминуты нельзя
  //    (правило «никаких неявных загрузок модели»); на холодной вставка ведёт себя как раньше.
  //  • кнопка В НАСТРОЙКАХ (explicit=true): это явное действие, и оно вправе ждать загрузку
  //    модели — то же решение, что у смыслового Ctrl+F.
  if (busy) return [];
  if (!opts.explicit && !isModelWarm()) return [];

  busy = true;
  let res;
  try {
    res = await runTabOrganizePrompt(buildPrompt(input), { background: !opts.explicit });
  } finally {
    busy = false;
  }
  if (!res.ok) {
    console.warn('[address-parse] модель не ответила:', res.error);
    return [];
  }
  // Разбор ответа и проверки индекса/телефона — в shared/addressParts.ts (без импортов, под
  // прогон: это слой, решающий, что ляжет в форму доставки).
  const parts = partsFromModelOutput(res.out.trim());
  if (parts.length === 0) {
    console.log('[address-parse] частей не набралось — не предлагаем');
    return [];
  }
  // В лог — ТОЛЬКО имена частей и их длины: сам адрес и телефон человека в логах не место
  // (ср. правило логирования у остальных AI-функций — там в лог идут номера, а не тексты).
  console.log(`[address-parse] части: ${parts.map((p) => `${p.key}(${p.value.length})`).join(', ')}`);
  return parts;
}
