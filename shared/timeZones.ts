// Поиск часового пояса так, как его называет человек.
//
// ⚠️ Люди не пишут «America/New_York». Они пишут EDT, EST, МСК, «Нью-Йорк» — и живой случай
// ровно такой: поиск по «edt» не находил ничего, потому что в списке ICU этой строки нет вовсе.
// Аббревиатура — не идентификатор, а ЯРЛЫК, и таблица ниже переводит ярлык в идентификатор.
//
// ⚠️ Летние и зимние ярлыки ведут в ОДИН пояс (EDT и EST — оба America/New_York), и это
// правильно: пояс один, меняется только его подпись по времени года. Выбирать между ними
// человеку не нужно, и предлагать этот выбор было бы ошибкой.
//
// Значимых импортов нет — проверка scripts/timezones-check.mjs гоняет модуль голым node.

/** Ярлык (аббревиатура или русское имя города) → идентификатор IANA. */
export const ZONE_ALIASES: Record<string, string> = {
  // Северная Америка
  edt: 'America/New_York', est: 'America/New_York', et: 'America/New_York',
  cdt: 'America/Chicago', cst: 'America/Chicago',
  mdt: 'America/Denver', mst: 'America/Denver',
  pdt: 'America/Los_Angeles', pst: 'America/Los_Angeles', pt: 'America/Los_Angeles',
  akst: 'America/Anchorage', hst: 'Pacific/Honolulu',
  // Европа
  msk: 'Europe/Moscow', мск: 'Europe/Moscow',
  cet: 'Europe/Berlin', cest: 'Europe/Berlin',
  eet: 'Europe/Kyiv', eest: 'Europe/Kyiv',
  bst: 'Europe/London', gmt: 'Europe/London',
  wet: 'Europe/Lisbon', utc: 'UTC',
  // Азия и Океания
  jst: 'Asia/Tokyo', kst: 'Asia/Seoul', ist: 'Asia/Kolkata',
  gst: 'Asia/Dubai', hkt: 'Asia/Hong_Kong', sgt: 'Asia/Singapore',
  aest: 'Australia/Sydney', aedt: 'Australia/Sydney', nzst: 'Pacific/Auckland',
  // Южная Америка
  brt: 'America/Sao_Paulo', art: 'America/Argentina/Buenos_Aires',
  // Русские имена самых ходовых точек
  москва: 'Europe/Moscow', питер: 'Europe/Moscow', 'санкт-петербург': 'Europe/Moscow',
  калининград: 'Europe/Kaliningrad', екатеринбург: 'Asia/Yekaterinburg',
  новосибирск: 'Asia/Novosibirsk', владивосток: 'Asia/Vladivostok',
  'нью-йорк': 'America/New_York', ньюйорк: 'America/New_York',
  'лос-анджелес': 'America/Los_Angeles', чикаго: 'America/Chicago',
  лондон: 'Europe/London', париж: 'Europe/Paris', берлин: 'Europe/Berlin',
  амстердам: 'Europe/Amsterdam', рим: 'Europe/Rome', мадрид: 'Europe/Madrid',
  лиссабон: 'Europe/Lisbon', варшава: 'Europe/Warsaw', прага: 'Europe/Prague',
  стамбул: 'Europe/Istanbul', киев: 'Europe/Kyiv', минск: 'Europe/Minsk',
  ереван: 'Asia/Yerevan', тбилиси: 'Asia/Tbilisi', алматы: 'Asia/Almaty',
  ташкент: 'Asia/Tashkent', баку: 'Asia/Baku', дубай: 'Asia/Dubai',
  токио: 'Asia/Tokyo', пекин: 'Asia/Shanghai', шанхай: 'Asia/Shanghai',
  сеул: 'Asia/Seoul', дели: 'Asia/Kolkata', бангкок: 'Asia/Bangkok',
  сингапур: 'Asia/Singapore', гонконг: 'Asia/Hong_Kong', бали: 'Asia/Makassar',
  сидней: 'Australia/Sydney', мельбурн: 'Australia/Melbourne',
  тельавив: 'Asia/Jerusalem', 'тель-авив': 'Asia/Jerusalem',
};

/**
 * Пояса, переименованные между версиями базы IANA: современное имя → прежние.
 *
 * ⚠️ Это НЕ косметика. Node в этой машине отдаёт Asia/Calcutta и Europe/Kiev, а Chromium в
 * Electron — почти наверняка Asia/Kolkata и Europe/Kyiv: у них разные версии CLDR. Записать
 * в таблицу одно из имён значит получить молча пустую выдачу в другой половине случаев —
 * ровно то, с чего начался разбор про «edt».
 */
const ZONE_EQUIV: Record<string, string[]> = {
  'Asia/Kolkata': ['Asia/Calcutta'],
  'Europe/Kyiv': ['Europe/Kiev'],
  'America/Argentina/Buenos_Aires': ['America/Buenos_Aires'],
  'Asia/Ho_Chi_Minh': ['Asia/Saigon'],
  UTC: ['Etc/UTC', 'Etc/GMT', 'Etc/Greenwich'],
};

/** Умеет ли ICU вообще считать время в этом поясе. */
function canFormat(id: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: id });
    return true;
  } catch {
    return false;
  }
}

/**
 * Имя пояса, которое реально работает в этой сборке ICU. Пусто — такого пояса тут нет вовсе.
 *
 * ⚠️ Список supportedValuesOf — НЕ полный перечень того, что ICU умеет: UTC и вся ветка Etc/*
 * в него не входят по спецификации, но время в UTC считается прекрасно. Поэтому судим по
 * способности ФОРМАТИРОВАТЬ, а не по членству в списке: иначе «utc» молча не находится.
 */
export function resolveZone(id: string, all: readonly string[]): string {
  if (!id) return '';
  if (all.includes(id) || canFormat(id)) return id;
  for (const alt of ZONE_EQUIV[id] ?? []) {
    if (all.includes(alt)) return alt;
  }
  // И обратно: в таблице прежнее имя, а сборка знает только современное.
  for (const [modern, legacy] of Object.entries(ZONE_EQUIV)) {
    if (legacy.includes(id) && all.includes(modern)) return modern;
  }
  return '';
}

/** Город из идентификатора: «America/New_York» → «New York». */
export function zoneCity(id: string): string {
  return (id.split('/').pop() ?? id).replace(/_/g, ' ');
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

/**
 * Поиск пояса по тому, что набрал человек.
 *
 * ⚠️ Точное совпадение с ярлыком идёт ПЕРВЫМ и отдельной строкой. Иначе «ist» тонет среди
 * двух десятков «...Istanbul...», а именно его человек и искал.
 */
export function searchTimeZones(query: string, all: readonly string[], exclude: readonly string[] = []): string[] {
  const q = norm(query);
  const skip = new Set(exclude);
  const pool = all.filter((z) => !skip.has(z));
  if (!q) return pool.slice(0, 40);

  const out: string[] = [];
  const push = (z: string): void => {
    if (z && !skip.has(z) && !out.includes(z)) out.push(z);
  };

  // 1. Ярлык целиком: edt, мск, «нью-йорк».
  const alias = ZONE_ALIASES[q.replace(/\s+/g, '')] ?? ZONE_ALIASES[q];
  if (alias) push(resolveZone(alias, all));

  // 2. Ярлык, начинающийся с введённого: набрали «мос» — предлагаем Москву.
  for (const [key, id] of Object.entries(ZONE_ALIASES)) {
    if (out.length >= 40) break;
    if (key.startsWith(q.replace(/\s+/g, ''))) push(resolveZone(id, all));
  }

  // 3. Обычное совпадение по идентификатору и городу.
  for (const z of pool) {
    if (out.length >= 40) break;
    if (norm(z).includes(q) || norm(zoneCity(z)).includes(q)) push(z);
  }
  return out.slice(0, 40);
}

/**
 * Живая аббревиатура пояса: EDT, JST, MSK.
 *
 * ⚠️ Возвращает пустую строку, когда у пояса ярлыка нет: для Москвы Intl отдаёт «GMT+3», и
 * показывать это рядом с уже посчитанным смещением — значит дважды сказать одно и то же.
 */
export function zoneAbbrev(id: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: id, timeZoneName: 'short' })
      .formatToParts(at);
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    return /^[A-Z]{2,5}$/.test(raw) ? raw : '';
  } catch {
    return '';
  }
}
