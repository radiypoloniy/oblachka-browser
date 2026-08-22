// Профили: «работа», «личное», «второй аккаунт». Чистая модель — без electron и без диска.
//
// ⚠️ ЧТО ЭТО ТАКОЕ ПО СУЩЕСТВУ. Профиль — единица УДОБСТВА, а не режим защиты. Большинство
// заведёт второй профиль ради второго аккаунта на одном сайте, а не ради анонимности.
// Приватность здесь — один из переключателей в ряду (свой VPN, свой адблок), а не рамка,
// в которую загоняется всё остальное. Отсюда два следствия, каждое проверяется ниже:
//   • новый профиль ничего не «усиливает» сам: пустой профиль — это просто чистые куки;
//   • отказ VPN в одном профиле НЕ трогает другие (см. vpn: 'off' и разбор kill switch).
//
// ⚠️ ГЛАВНОЕ ПРАВИЛО, ЛОМАЮЩЕЕ ДАННЫЕ, ЕСЛИ ЕГО НАРУШИТЬ: профиль по умолчанию сидит на
// СЕССИИ ПО УМОЛЧАНИЮ (partition === null). Все куки, логины и кэш человека уже лежат там.
// Выдай ему собственную партицию «для единообразия» — и при первом же запуске он окажется
// разлогинен везде, где был залогинен. Это не гипотеза: партиция и есть то, где живут куки.
//
// Значимых импортов нет — проверка scripts/profiles-check.mjs гоняет модуль голым node.

/** Id профиля по умолчанию. ⚠️ Не переименовывать: он записан в раскладках и сессии на диске. */
export const DEFAULT_PROFILE_ID = 'default';

export const PROFILES_MAX = 8;
export const PROFILE_NAME_MAX = 24;

/**
 * Как профиль ходит в сеть.
 *
 * ⚠️ `off` — это НЕ «выключить защиту», а «этому профилю туннель не нужен». Разница
 * принципиальна для kill switch: профиль с `off` обязан продолжать работать, когда туннель
 * упал у соседнего. Приложение с одним общим отказом здесь не годится.
 */
export type ProfileVpn =
  | 'off'      // прямой выход, VPN этого профиля не касается
  | 'on'       // через туннель; упал — профиль ждёт (fail-closed) и не течёт мимо
  | 'inherit'; // как переключено в приложении сейчас — поведение до появления профилей

export interface ProfileSettings {
  vpn: ProfileVpn;
  /** Сетевая блокировка трекеров в этой сессии. Косметика — только у профиля по умолчанию. */
  adblock: boolean;
}

export interface Profile {
  id: string;
  name: string;
  /** Цвет метки — id из палитры плиток, не сырой цвет (см. WIDGET_FILLS). */
  color: string;
  settings: ProfileSettings;
  createdAt: number;
}

export interface ProfilesState {
  profiles: Profile[];
  activeId: string;
  /**
   * С каким профилем запускаться, не спрашивая. null — спрашивать при старте.
   *
   * ⚠️ Умолчание — null, но экран выбора при этом НЕ появляется, пока профиль один: спрашивать
   * «с каким из одного?» — издевательство. Условие показа целиком в shouldAskProfileOnStart,
   * и оно проверяется, потому что ошибка здесь встречает человека при КАЖДОМ запуске.
   */
  startupProfileId: string | null;
}

/** Цвета меток. ⚠️ Из набора плиток стола, чтобы профиль читался как часть системы. */
export const PROFILE_COLORS = ['blue', 'teal', 'green', 'orange', 'pink', 'slate'] as const;

export function defaultProfileSettings(): ProfileSettings {
  // ⚠️ Умолчание — 'inherit', а не 'off' и не 'on'. Новый профиль обязан вести себя ровно так
  // же, как браузер вёл себя до профилей: человек не просил ничего менять, он просил отдельные
  // куки. Любое другое умолчание — это молчаливое изменение поведения.
  return { vpn: 'inherit', adblock: true };
}

export function defaultProfilesState(): ProfilesState {
  return {
    profiles: [{
      id: DEFAULT_PROFILE_ID,
      name: 'Основной',
      color: 'blue',
      settings: defaultProfileSettings(),
      createdAt: 0,
    }],
    activeId: DEFAULT_PROFILE_ID,
    startupProfileId: null,
  };
}

/**
 * Спрашивать ли профиль при запуске.
 *
 * ⚠️ Три условия, и каждое отвечает на своё возражение: профилей больше одного (иначе выбирать
 * не из чего), человек не закрепил выбор (закрепил — значит просил не спрашивать), а закреплённый
 * профиль всё ещё существует (удалил — вопрос возвращается сам, а не молча падает в основной).
 */
export function shouldAskProfileOnStart(state: ProfilesState): boolean {
  if (state.profiles.length < 2) return false;
  if (!state.startupProfileId) return true;
  return !state.profiles.some((p) => p.id === state.startupProfileId);
}

/** С каким профилем стартовать без вопроса. */
export function startupProfile(state: ProfilesState): Profile {
  const pinned = state.startupProfileId
    ? state.profiles.find((p) => p.id === state.startupProfileId)
    : null;
  return pinned ?? state.profiles.find((p) => p.id === DEFAULT_PROFILE_ID) ?? state.profiles[0]!;
}

/** Закрепить профиль за запуском (или снять закрепление, передав null). */
export function setStartupProfile(state: ProfilesState, id: string | null): ProfilesState {
  if (id === null) return { ...state, startupProfileId: null };
  return state.profiles.some((p) => p.id === id) ? { ...state, startupProfileId: id } : state;
}

/**
 * Имя партиции сессии для профиля — или null для профиля по умолчанию.
 *
 * ⚠️ null здесь — не «не задано», а ОСМЫСЛЕННОЕ значение: сессия по умолчанию, где уже лежат
 * данные человека (см. шапку). Вызывающая сторона обязана его различать, а не подставлять
 * пустую строку.
 *
 * ⚠️ `persist:` обязателен: без него партиция живёт в памяти и профиль забывает логины при
 * перезапуске — ровно так сделано инкогнито, и там это цель, а здесь было бы багом.
 */
export function profilePartition(id: string): string | null {
  if (id === DEFAULT_PROFILE_ID) return null;
  return `persist:oblako-profile-${sanitizeProfileId(id)}`;
}

/** Id безопасен для имени партиции: партиция — это в конечном счёте путь на диске. */
export function sanitizeProfileId(raw: string): string {
  return String(raw ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 32);
}

export function newProfileId(now = Date.now()): string {
  return `p${now.toString(36)}`;
}

function cleanName(raw: unknown, fallback: string): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  return s ? s.slice(0, PROFILE_NAME_MAX) : fallback;
}

function cleanSettings(raw: unknown): ProfileSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const vpn: ProfileVpn = o.vpn === 'on' || o.vpn === 'off' ? o.vpn : 'inherit';
  return { vpn, adblock: o.adblock !== false };
}

/**
 * Разбор того, что лежит на диске.
 *
 * ⚠️ Профиль по умолчанию ВОССТАНАВЛИВАЕТСЯ, даже если в файле его нет: без него человек
 * останется без единственной сессии, где лежат все его данные. Битый файл не имеет права
 * стоить людям логинов.
 */
export function parseProfiles(raw: unknown): ProfilesState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(o.profiles) ? o.profiles : [];
  const seen = new Set<string>();
  const profiles: Profile[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const id = p.id === DEFAULT_PROFILE_ID ? DEFAULT_PROFILE_ID : sanitizeProfileId(String(p.id ?? ''));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    profiles.push({
      id,
      name: cleanName(p.name, id === DEFAULT_PROFILE_ID ? 'Основной' : 'Профиль'),
      color: (PROFILE_COLORS as readonly string[]).includes(String(p.color)) ? String(p.color) : 'blue',
      settings: cleanSettings(p.settings),
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
    });
    if (profiles.length >= PROFILES_MAX) break;
  }

  if (!profiles.some((p) => p.id === DEFAULT_PROFILE_ID)) {
    // ⚠️ Основной ВСТАВЛЯЕТСЯ, и потолок пересчитывается ПОСЛЕ вставки. Иначе битый файл с
    // сорока записями давал PROFILES_MAX + 1: цикл набирал восемь, а девятым приходил основной.
    profiles.unshift(defaultProfilesState().profiles[0]!);
    profiles.length = Math.min(profiles.length, PROFILES_MAX);
  }

  const wanted = String(o.activeId ?? '');
  const activeId = profiles.some((p) => p.id === wanted) ? wanted : DEFAULT_PROFILE_ID;
  const pinned = typeof o.startupProfileId === 'string' && profiles.some((p) => p.id === o.startupProfileId)
    ? o.startupProfileId
    : null;
  return { profiles, activeId, startupProfileId: pinned };
}

export function findProfile(state: ProfilesState, id: string): Profile | null {
  return state.profiles.find((p) => p.id === id) ?? null;
}

export function activeProfile(state: ProfilesState): Profile {
  return findProfile(state, state.activeId) ?? state.profiles[0]!;
}

export function addProfile(state: ProfilesState, name: string, color: string, now = Date.now()): ProfilesState {
  if (state.profiles.length >= PROFILES_MAX) return state;
  const id = newProfileId(now);
  if (state.profiles.some((p) => p.id === id)) return state;
  const profile: Profile = {
    id,
    name: cleanName(name, 'Профиль'),
    color: (PROFILE_COLORS as readonly string[]).includes(color) ? color : 'blue',
    settings: defaultProfileSettings(),
    createdAt: now,
  };
  return { ...state, profiles: [...state.profiles, profile] };
}

export function renameProfile(state: ProfilesState, id: string, name: string): ProfilesState {
  return {
    ...state,
    profiles: state.profiles.map((p) => (p.id === id ? { ...p, name: cleanName(name, p.name) } : p)),
  };
}

export function setProfileSettings(state: ProfilesState, id: string, patch: Partial<ProfileSettings>): ProfilesState {
  return {
    ...state,
    profiles: state.profiles.map((p) => (
      p.id === id ? { ...p, settings: cleanSettings({ ...p.settings, ...patch }) } : p
    )),
  };
}

/**
 * Удаление профиля.
 *
 * ⚠️ Профиль по умолчанию удалить НЕЛЬЗЯ: это сессия, где лежат данные человека, и «удалить»
 * означало бы стереть их. Возвращаем состояние как было — молча, потому что до этого места
 * запрос не должен доходить (кнопки у него нет).
 */
export function removeProfile(state: ProfilesState, id: string): ProfilesState {
  if (id === DEFAULT_PROFILE_ID) return state;
  const profiles = state.profiles.filter((p) => p.id !== id);
  if (profiles.length === state.profiles.length) return state;
  const activeId = state.activeId === id ? DEFAULT_PROFILE_ID : state.activeId;
  // ⚠️ Закрепление за удалённым профилем снимается здесь же. Иначе следующий запуск искал бы
  // несуществующий профиль — и либо молча падал в основной, либо спрашивал без объяснения.
  const startupProfileId = state.startupProfileId === id ? null : state.startupProfileId;
  return { profiles, activeId, startupProfileId };
}

export function switchProfile(state: ProfilesState, id: string): ProfilesState {
  return state.profiles.some((p) => p.id === id) ? { ...state, activeId: id } : state;
}

/**
 * Нужен ли этому профилю туннель прямо сейчас.
 *
 * ⚠️ Здесь и живёт «приватность как опция». Профиль с `off` при упавшем туннеле обязан
 * работать дальше: у него своя сессия и свой прокси, и общий отказ на приложение его не
 * касается. Профиль с `on` — наоборот, ждёт (fail-closed): он просил туннель, и молча
 * выпустить его трафик напрямую было бы обманом.
 */
export function profileWantsVpn(p: Profile, appVpnOn: boolean): boolean {
  if (p.settings.vpn === 'on') return true;
  if (p.settings.vpn === 'off') return false;
  return appVpnOn;
}

/** Профиль, который обязан замереть при упавшем туннеле (а не выйти напрямую). */
export function profileFailsClosed(p: Profile): boolean {
  return p.settings.vpn === 'on';
}
