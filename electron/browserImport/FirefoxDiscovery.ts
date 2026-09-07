import fs from 'node:fs';
import path from 'node:path';
import type { ImportDataType } from '../../shared/ipc';
import type { DiscoveredProfile } from './ChromiumDiscovery';

// Обнаружение профилей Firefox на диске (Windows). Отдельный модуль от ChromiumDiscovery, потому
// что раскладка принципиально другая: у Chromium профили — это подкаталоги «User Data» с
// фиксированными именами, у Firefox список профилей ведётся ФАЙЛОМ profiles.ini, а сами каталоги
// названы случайным префиксом (t7wxyz01.default-release). Перечислять их обходом каталога нельзя:
// там же лежат удалённые и служебные профили, которых в браузере человек не видит.
//
// ⚠️ DiscoveredProfile переиспользуется как есть, включая имя поля userDataPath. У Chromium это
// корень «User Data» (профили + общий Local State с ключом), у Firefox — корень Mozilla\Firefox
// (profiles.ini + каталог Profiles). Роль одна: «общий для вендора корень над профилями», поэтому
// заводить второй тип ради названия поля смысла нет.

const VENDOR_ID = 'firefox';
const VENDOR_LABEL = 'Mozilla Firefox';

/** Корень профилей Firefox: %APPDATA%\Mozilla\Firefox. */
function firefoxRoot(): string | null {
  const roaming = process.env.APPDATA;
  if (!roaming) return null;
  const root = path.join(roaming, 'Mozilla', 'Firefox');
  return fs.existsSync(root) ? root : null;
}

interface IniSection {
  name: string;
  values: Map<string, string>;
}

/**
 * Разбор INI. Свой, потому что формат тривиален (секции и `ключ=значение`), а тянуть зависимость
 * ради одного файла — против правила проекта.
 *
 * ⚠️ Значение НЕ обрезается по первому '=': путь профиля его не содержит, а вот сравнение с
 * регистром — содержит подвох, поэтому ключи приводим к нижнему регистру (Firefox пишет `IsRelative`,
 * сторонние сборки встречались с `isrelative`).
 */
function parseIni(text: string): IniSection[] {
  const sections: IniSection[] = [];
  let current: IniSection | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith(';') || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      current = { name: line.slice(1, -1), values: new Map() };
      sections.push(current);
      continue;
    }
    if (!current) continue; // строка до первой секции — мусор, пропускаем
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    current.values.set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1).trim());
  }
  return sections;
}

/**
 * Все профили Firefox, перечисленные в profiles.ini и реально существующие на диске.
 *
 * ⚠️ Существование каталога проверяем ОБЯЗАТЕЛЬНО: profiles.ini помнит профили, каталоги которых
 * человек удалил руками, и такой призрак дал бы источник импорта, из которого ничего не берётся.
 */
export function discoverFirefoxProfiles(): DiscoveredProfile[] {
  const root = firefoxRoot();
  if (!root) return [];

  let sections: IniSection[];
  try {
    sections = parseIni(fs.readFileSync(path.join(root, 'profiles.ini'), 'utf8'));
  } catch {
    return []; // нет profiles.ini — Firefox не устанавливался либо профиль ещё не создан
  }

  const profiles = sections.filter((s) => /^Profile\d+$/i.test(s.name));
  const out: DiscoveredProfile[] = [];
  for (const section of profiles) {
    const rawPath = section.values.get('path');
    if (!rawPath) continue;
    // IsRelative=1 (обычный случай) — путь относительно корня Mozilla\Firefox, причём с прямыми
    // слэшами даже на Windows; path.join их нормализует сам.
    const relative = section.values.get('isrelative') !== '0';
    const profilePath = relative ? path.join(root, rawPath) : rawPath;
    if (!fs.existsSync(profilePath)) continue;

    const name = section.values.get('name') ?? '';
    out.push({
      sourceId: `${VENDOR_ID}::${section.name}`,
      vendorId: VENDOR_ID,
      vendorLabel: VENDOR_LABEL,
      profileLabel: name,
      profilePath,
      userDataPath: root,
    });
  }

  // Лейбл с именем профиля — только когда профилей несколько (тот же приём, что у Chromium: у
  // одиночного профиля имя «default-release» человеку ничего не говорит и только шумит).
  if (out.length > 1) {
    for (const profile of out) {
      if (profile.profileLabel) profile.vendorLabel = `${VENDOR_LABEL} — ${profile.profileLabel}`;
    }
  }
  return out;
}

/**
 * Какие типы данных физически есть в профиле Firefox.
 *
 * ⚠️ Закладки и история — ОДИН файл places.sqlite, в отличие от Chromium с его отдельными
 * Bookmarks и History. Поэтому наличие обоих типов определяется одной проверкой, и «есть закладки,
 * но нет истории» здесь состояние невозможное.
 */
export function firefoxDataTypes(profile: DiscoveredProfile): ImportDataType[] {
  const has = (file: string): boolean => {
    try { return fs.existsSync(path.join(profile.profilePath, file)); } catch { return false; }
  };
  const types: ImportDataType[] = [];
  if (has('places.sqlite')) types.push('bookmarks', 'history');
  // Ключ без хранилища логинов бесполезен, хранилище без ключа нечитаемо — нужны оба файла.
  if (has('logins.json') && has('key4.db')) types.push('passwords');
  return types;
}
