// ── Страна сервера VPN по его имени ───────────────────────────────────────────
//
// Зачем. В подписке сервер приходит одной строкой-ремаркой («🇳🇱 NL-Amsterdam-02», «Germany
// Frankfurt», «RU-MSK»), и список из двух десятков таких строк читается глазами тяжело.
// Флаг слева превращает список в то, что человек узнаёт не читая, — так устроены Happ и
// прочие клиенты Xray.
//
// ⚠️ Почему нельзя просто оставить эмодзи-флаг из ремарки. Windows НЕ рисует пары
// regional indicator как флаг: Segoe UI Emoji их не содержит, и «🇳🇱» показывается двумя
// буквами «NL» в квадратиках. Ровно поэтому в проекте есть stripEmoji (см. shared/text.ts) —
// эмодзи из ремарок вырезаются. Флаг поэтому рисуется картинкой (src/public/flags, см.
// scripts/download-flags.mjs), а эта таблица нужна, чтобы понять, КАКУЮ картинку взять.
//
// Порядок распознавания важен и идёт от самого надёжного признака к самому шаткому:
// эмодзи-флаг (провайдер сказал прямо) → название страны или города → двухбуквенный код.

export interface CountryInfo {
  /** ISO 3166-1 alpha-2 в нижнем регистре — он же имя файла флага. */
  code: string;
  /** Русское название для подписи и подсказки. */
  name: string;
}

// hints — то, что ищется ПОДСТРОКОЙ, поэтому здесь только куски длиной от четырёх букв:
// короткие («ru», «de») ловились бы внутри чужих слов. Двухбуквенные коды разбираются
// отдельным правилом ниже. Города — только крупные узлы, где их пишут вместо страны.
const COUNTRIES: Array<CountryInfo & { hints: string[] }> = [
  // Европейский союз — не страна, но в подписках это ходовая пометка: ей называют
  // «Авто»/«ближайший сервер», и без записи такой сервер оставался единственным в списке без
  // флага. Стоит ПЕРВЫМ: подписки часто пишут «EU-Auto», и по коду он должен найтись раньше,
  // чем что-либо ещё.
  { code: 'eu', name: 'Европа',        hints: ['европ', 'evropa'] },
  { code: 'nl', name: 'Нидерланды',    hints: ['netherland', 'holland', 'amsterdam', 'нидерланд', 'голланд', 'амстердам'] },
  { code: 'de', name: 'Германия',      hints: ['germany', 'german', 'deutschland', 'frankfurt', 'berlin', 'герман', 'франкфурт', 'берлин'] },
  { code: 'us', name: 'США',           hints: ['united states', 'america', 'new york', 'los angeles', 'miami', 'dallas', 'seattle', 'chicago', 'сша', 'америк', 'нью-йорк'] },
  { code: 'gb', name: 'Великобритания',hints: ['united kingdom', 'england', 'britain', 'london', 'англи', 'британ', 'лондон'] },
  { code: 'fr', name: 'Франция',       hints: ['france', 'french', 'paris', 'франц', 'париж'] },
  { code: 'fi', name: 'Финляндия',     hints: ['finland', 'helsinki', 'финлянд', 'хельсинки'] },
  { code: 'se', name: 'Швеция',        hints: ['sweden', 'stockholm', 'швеци', 'стокгольм'] },
  { code: 'no', name: 'Норвегия',      hints: ['norway', 'oslo', 'норвег'] },
  { code: 'dk', name: 'Дания',         hints: ['denmark', 'copenhagen', 'дани', 'копенгаген'] },
  { code: 'pl', name: 'Польша',        hints: ['poland', 'warsaw', 'польш', 'варшав'] },
  { code: 'cz', name: 'Чехия',         hints: ['czech', 'prague', 'чехи', 'прага'] },
  { code: 'at', name: 'Австрия',       hints: ['austria', 'vienna', 'австри', 'вена'] },
  { code: 'ch', name: 'Швейцария',     hints: ['switzerland', 'swiss', 'zurich', 'швейцар', 'цюрих'] },
  { code: 'es', name: 'Испания',       hints: ['spain', 'madrid', 'barcelona', 'испани', 'мадрид'] },
  { code: 'it', name: 'Италия',        hints: ['italy', 'milan', 'rome', 'итали', 'милан', 'рим'] },
  { code: 'pt', name: 'Португалия',    hints: ['portugal', 'lisbon', 'португал', 'лиссабон'] },
  { code: 'ie', name: 'Ирландия',      hints: ['ireland', 'dublin', 'ирланд', 'дублин'] },
  { code: 'be', name: 'Бельгия',       hints: ['belgium', 'brussels', 'бельги', 'брюссель'] },
  { code: 'lu', name: 'Люксембург',    hints: ['luxembourg', 'люксембург'] },
  { code: 'is', name: 'Исландия',      hints: ['iceland', 'reykjavik', 'исланд'] },
  { code: 'ru', name: 'Россия',        hints: ['russia', 'moscow', 'petersburg', 'росси', 'москв', 'петербург'] },
  { code: 'ua', name: 'Украина',       hints: ['ukraine', 'kyiv', 'kiev', 'украин', 'киев'] },
  { code: 'by', name: 'Беларусь',      hints: ['belarus', 'minsk', 'беларус', 'минск'] },
  { code: 'kz', name: 'Казахстан',     hints: ['kazakh', 'almaty', 'astana', 'казахст', 'алматы'] },
  { code: 'lv', name: 'Латвия',        hints: ['latvia', 'riga', 'латви', 'рига'] },
  { code: 'lt', name: 'Литва',         hints: ['lithuania', 'vilnius', 'литв', 'вильнюс'] },
  { code: 'ee', name: 'Эстония',       hints: ['estonia', 'tallinn', 'эстони', 'таллин'] },
  { code: 'md', name: 'Молдова',       hints: ['moldova', 'chisinau', 'молдов', 'кишинёв', 'кишинев'] },
  { code: 'ro', name: 'Румыния',       hints: ['romania', 'bucharest', 'румын', 'бухарест'] },
  { code: 'bg', name: 'Болгария',      hints: ['bulgaria', 'sofia', 'болгар', 'софия'] },
  { code: 'rs', name: 'Сербия',        hints: ['serbia', 'belgrade', 'серби', 'белград'] },
  { code: 'hu', name: 'Венгрия',       hints: ['hungary', 'budapest', 'венгр', 'будапешт'] },
  { code: 'gr', name: 'Греция',        hints: ['greece', 'athens', 'греци', 'афины'] },
  { code: 'hr', name: 'Хорватия',      hints: ['croatia', 'zagreb', 'хорват'] },
  { code: 'si', name: 'Словения',      hints: ['slovenia', 'ljubljana', 'словени'] },
  { code: 'sk', name: 'Словакия',      hints: ['slovakia', 'bratislava', 'словаки'] },
  { code: 'cy', name: 'Кипр',          hints: ['cyprus', 'кипр'] },
  { code: 'tr', name: 'Турция',        hints: ['turkey', 'turkiye', 'türkiye', 'istanbul', 'турци', 'стамбул'] },
  { code: 'ge', name: 'Грузия',        hints: ['tbilisi', 'грузи', 'тбилиси'] },
  { code: 'am', name: 'Армения',       hints: ['armenia', 'yerevan', 'армени', 'ереван'] },
  { code: 'az', name: 'Азербайджан',   hints: ['azerbaijan', 'baku', 'азербайдж', 'баку'] },
  { code: 'uz', name: 'Узбекистан',    hints: ['uzbek', 'tashkent', 'узбек', 'ташкент'] },
  { code: 'kg', name: 'Киргизия',      hints: ['kyrgyz', 'bishkek', 'киргиз', 'бишкек'] },
  { code: 'ae', name: 'ОАЭ',           hints: ['emirates', 'dubai', 'эмират', 'дубай'] },
  { code: 'il', name: 'Израиль',       hints: ['israel', 'tel aviv', 'израил'] },
  { code: 'sa', name: 'Саудовская Аравия', hints: ['saudi', 'riyadh', 'саудов'] },
  { code: 'eg', name: 'Египет',        hints: ['egypt', 'cairo', 'египет'] },
  { code: 'za', name: 'ЮАР',           hints: ['south africa', 'johannesburg', 'юар'] },
  { code: 'jp', name: 'Япония',        hints: ['japan', 'tokyo', 'осака', 'япони', 'токио'] },
  { code: 'kr', name: 'Южная Корея',   hints: ['korea', 'seoul', 'коре', 'сеул'] },
  { code: 'cn', name: 'Китай',         hints: ['china', 'shanghai', 'beijing', 'кита', 'шанхай', 'пекин'] },
  { code: 'hk', name: 'Гонконг',       hints: ['hong kong', 'hongkong', 'гонконг'] },
  { code: 'tw', name: 'Тайвань',       hints: ['taiwan', 'тайвань'] },
  { code: 'sg', name: 'Сингапур',      hints: ['singapore', 'сингапур'] },
  { code: 'in', name: 'Индия',         hints: ['india', 'mumbai', 'инди', 'мумбаи'] },
  { code: 'id', name: 'Индонезия',     hints: ['indonesia', 'jakarta', 'индонез'] },
  { code: 'my', name: 'Малайзия',      hints: ['malaysia', 'kuala', 'малайз'] },
  { code: 'th', name: 'Таиланд',       hints: ['thailand', 'bangkok', 'таиланд', 'бангкок'] },
  { code: 'vn', name: 'Вьетнам',       hints: ['vietnam', 'hanoi', 'вьетнам'] },
  { code: 'ph', name: 'Филиппины',     hints: ['philippin', 'manila', 'филиппин'] },
  { code: 'au', name: 'Австралия',     hints: ['australia', 'sydney', 'австрали', 'сидней'] },
  { code: 'nz', name: 'Новая Зеландия',hints: ['zealand', 'auckland', 'зеланди'] },
  { code: 'ca', name: 'Канада',        hints: ['canada', 'toronto', 'montreal', 'канад', 'торонто'] },
  { code: 'br', name: 'Бразилия',      hints: ['brazil', 'brasil', 'sao paulo', 'бразили'] },
  { code: 'ar', name: 'Аргентина',     hints: ['argentina', 'buenos', 'аргентин'] },
  { code: 'mx', name: 'Мексика',       hints: ['mexico', 'мексик'] },
  { code: 'cl', name: 'Чили',          hints: ['chile', 'santiago', 'чили'] },
  { code: 'co', name: 'Колумбия',      hints: ['colombia', 'bogota', 'колумби'] },
  { code: 'pe', name: 'Перу',          hints: ['peru', 'lima'] },
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, { code: c.code, name: c.name }]));

/** Есть ли у нас картинка флага для такого кода. Наружу — чтобы не рисовать битую <img>. */
export function knownCountryCode(code: string): boolean {
  return BY_CODE.has(code.toLowerCase());
}

// Пара regional indicator'ов → код страны. U+1F1E6 = 'A', дальше по алфавиту.
function codeFromFlagEmoji(text: string): string | null {
  const pair = [...text].filter((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    return cp >= 0x1f1e6 && cp <= 0x1f1ff;
  });
  if (pair.length < 2) return null;
  const letter = (ch: string) => String.fromCharCode((ch.codePointAt(0)! - 0x1f1e6) + 97);
  return letter(pair[0]) + letter(pair[1]);
}

/**
 * Страна сервера по его ремарке. null — не поняли; тогда список просто не покажет флаг,
 * и это лучше, чем показать чужой.
 */
export function detectCountry(remark: string): CountryInfo | null {
  if (!remark) return null;

  // 1. Эмодзи-флаг: провайдер назвал страну прямо, гадать не о чем.
  const fromEmoji = codeFromFlagEmoji(remark);
  if (fromEmoji) {
    const known = BY_CODE.get(fromEmoji);
    if (known) return known;
  }

  const lower = remark.toLowerCase();

  // 2. Название страны или крупного города. Идёт раньше кодов: «Indiana» не должна стать
  // Индией из-за куска «IN», а «Germany-01» обязана определиться и без кода.
  for (const c of COUNTRIES) {
    for (const hint of c.hints) {
      if (lower.includes(hint)) return { code: c.code, name: c.name };
    }
  }

  // 3. Двухбуквенный код отдельным токеном — и ТОЛЬКО заглавными. В нижнем регистре
  // половина кодов совпадает с обычными словами («no», «it», «is», «in», «de»), и строка
  // «server is up» стала бы Исландией.
  const token = /(^|[^A-Za-z])([A-Z]{2})([^A-Za-z]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(remark)) !== null) {
    const known = BY_CODE.get(m[2].toLowerCase());
    if (known) return known;
  }

  return null;
}
