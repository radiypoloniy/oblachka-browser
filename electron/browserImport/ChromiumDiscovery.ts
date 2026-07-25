import fs from 'node:fs';
import path from 'node:path';
import type { ImportDataType } from '../../shared/ipc';

// Обнаружение источников импорта на диске (Windows). Отдельный модуль от самих импортёров:
// «какие браузеры/профили есть» — общий вопрос для всех типов данных (закладки/история/пароли),
// поэтому один discovery, а не по копии в каждом импортёре (раньше ChromiumBookmarkImporter сам
// хардкодил путь до Default — теперь перечисляем ВСЕ профили каждого вендора, как это делает
// Яндекс.Браузер/Chrome при импорте).

// Известные Chromium-производные на Windows. root — где вендор держит профиль: LOCALAPPDATA у
// большинства, APPDATA (Roaming) у Opera. userDataSubpath — до каталога «User Data» (или до самого
// каталога профиля у Opera, где профиль не в подпапке). Firefox/Safari — другой формат, добавятся
// отдельным discovery (тот же ImportManager соберёт их вместе).
interface ChromiumVendor {
  id: string;
  label: string;
  root: 'local' | 'roaming';
  userDataSubpath: string;
  // true — профили лежат в подпапках User Data (Default, Profile 1, …), Local State в корне User Data.
  // false (Opera) — сам userDataSubpath И есть каталог профиля, файлы данных и Local State прямо в нём.
  profilesInSubdirs: boolean;
}

const VENDORS: ChromiumVendor[] = [
  { id: 'chrome',   label: 'Google Chrome',  root: 'local',   userDataSubpath: path.join('Google', 'Chrome', 'User Data'),                profilesInSubdirs: true },
  { id: 'edge',     label: 'Microsoft Edge', root: 'local',   userDataSubpath: path.join('Microsoft', 'Edge', 'User Data'),               profilesInSubdirs: true },
  { id: 'brave',    label: 'Brave',          root: 'local',   userDataSubpath: path.join('BraveSoftware', 'Brave-Browser', 'User Data'),  profilesInSubdirs: true },
  { id: 'yandex',   label: 'Яндекс.Браузер', root: 'local',   userDataSubpath: path.join('Yandex', 'YandexBrowser', 'User Data'),         profilesInSubdirs: true },
  { id: 'vivaldi',  label: 'Vivaldi',        root: 'local',   userDataSubpath: path.join('Vivaldi', 'User Data'),                         profilesInSubdirs: true },
  { id: 'opera',    label: 'Opera',          root: 'roaming', userDataSubpath: path.join('Opera Software', 'Opera Stable'),               profilesInSubdirs: false },
  { id: 'operagx',  label: 'Opera GX',       root: 'roaming', userDataSubpath: path.join('Opera Software', 'Opera GX Stable'),            profilesInSubdirs: false },
];

// Один найденный профиль конкретного браузера. profilePath — каталог с файлами данных
// (Bookmarks/History/Login Data), userDataPath — корень User Data (там Local State с мастер-ключом
// паролей и info_cache с именами профилей). Оба нужны: ключ паролей общий на User Data, а не на профиль.
export interface DiscoveredProfile {
  sourceId: string;      // 'chrome::Default' — то, что уйдёт в ImportSource.id
  vendorId: string;      // 'chrome' | 'yandex' | … — для выбора вендор-специфичного ридера паролей
  vendorLabel: string;   // 'Google Chrome'
  profileLabel: string;  // 'Профиль 1' | 'Default' | '' — человекочитаемое имя профиля (из Local State)
  profilePath: string;   // …\User Data\Default
  userDataPath: string;  // …\User Data
}

// Имя файла БД паролей у профиля зависит от вендора: Яндекс.Браузер хранит их в `Ya Passman Data`
// (со своей схемой шифрования, см. YandexPasswordReader), остальные Chromium — в `Login Data`.
// Именно из-за этого раньше у Яндекса не появлялась галочка «Пароли»: проверяли только `Login Data`.
export function passwordDbFile(vendorId: string): string {
  return vendorId === 'yandex' ? 'Ya Passman Data' : 'Login Data';
}

function rootDir(root: 'local' | 'roaming'): string {
  return root === 'local' ? (process.env.LOCALAPPDATA ?? '') : (process.env.APPDATA ?? '');
}

// Имена профилей из Local State → profile.info_cache[dir].name (то, что видит пользователь в
// браузере, напр. «Личный»/«Работа»). Молча возвращаем пустую карту при любой проблеме — имена
// не критичны, есть фолбэк на имя каталога.
function readProfileNames(userDataPath: string): Map<string, string> {
  const names = new Map<string, string>();
  try {
    const raw = fs.readFileSync(path.join(userDataPath, 'Local State'), 'utf8');
    const data = JSON.parse(raw) as { profile?: { info_cache?: Record<string, { name?: unknown }> } };
    const cache = data.profile?.info_cache ?? {};
    for (const [dir, info] of Object.entries(cache)) {
      if (info && typeof info.name === 'string' && info.name.trim()) names.set(dir, info.name.trim());
    }
  } catch { /* Local State нет/битый — фолбэк на имя каталога */ }
  return names;
}

// Каталоги профилей внутри User Data: Default + Profile N. Ориентир — наличие Local State в
// корне и подпапок с файлом Bookmarks/History. Скан папок надёжнее, чем доверять info_cache
// (там могут быть удалённые/несозданные профили).
function listProfileDirs(userDataPath: string): string[] {
  const dirs: string[] = [];
  try {
    for (const entry of fs.readdirSync(userDataPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name === 'Default' || /^Profile \d+$/.test(name)) dirs.push(name);
    }
  } catch { /* нет доступа к User Data — вендор просто не даст источников */ }
  return dirs;
}

// Реально найденные профили всех известных Chromium-браузеров. isAvailable-логики больше нет:
// профиль попадает в список только если его каталог с данными существует.
export function discoverChromiumProfiles(): DiscoveredProfile[] {
  const out: DiscoveredProfile[] = [];
  for (const vendor of VENDORS) {
    const base = rootDir(vendor.root);
    if (!base) continue;
    const userDataPath = path.join(base, vendor.userDataSubpath);
    if (!fs.existsSync(userDataPath)) continue;

    if (vendor.profilesInSubdirs) {
      const names = readProfileNames(userDataPath);
      const profileDirs = listProfileDirs(userDataPath);
      const multi = profileDirs.length > 1;
      for (const dir of profileDirs) {
        const profileLabel = names.get(dir) ?? (dir === 'Default' ? '' : dir);
        // Лейбл источника: у одиночного профиля — просто имя браузера; у нескольких — с именем профиля,
        // чтобы пользователь различил их в диалоге.
        const label = multi && profileLabel ? `${vendor.label} — ${profileLabel}` : vendor.label;
        out.push({
          sourceId: `${vendor.id}::${dir}`,
          vendorId: vendor.id,
          vendorLabel: label,
          profileLabel,
          profilePath: path.join(userDataPath, dir),
          userDataPath,
        });
      }
    } else {
      // Opera: сам каталог = профиль, Local State там же.
      out.push({
        sourceId: `${vendor.id}::.`,
        vendorId: vendor.id,
        vendorLabel: vendor.label,
        profileLabel: '',
        profilePath: userDataPath,
        userDataPath,
      });
    }
  }
  return out;
}

// Какие типы данных физически присутствуют в профиле (файл на диске есть). Поддержанность типа
// (реализован ли импортёр) накладывает ImportManager сверху — discovery только про наличие файлов.
export function availableDataTypes(profile: DiscoveredProfile): ImportDataType[] {
  const has = (file: string): boolean => {
    try { return fs.existsSync(path.join(profile.profilePath, file)); } catch { return false; }
  };
  const types: ImportDataType[] = [];
  if (has('Bookmarks')) types.push('bookmarks');
  if (has('History')) types.push('history');
  // Имя файла паролей вендор-специфично (Яндекс — `Ya Passman Data`, см. passwordDbFile).
  if (has(passwordDbFile(profile.vendorId))) types.push('passwords');
  return types;
}
