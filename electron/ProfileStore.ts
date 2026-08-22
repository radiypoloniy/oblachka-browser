import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseProfiles, defaultProfilesState, addProfile, removeProfile, renameProfile,
  switchProfile, setProfileSettings, activeProfile, findProfile, setStartupProfile,
  type Profile, type ProfileSettings, type ProfilesState,
} from '../shared/profiles';

// Список профилей на диске. Вся логика — в shared/profiles.ts под npm test; здесь только файл.
//
// ⚠️ Отдельный файл, а не поле в settings.json, и это не вкусовщина. settings.json описывает
// ПРИЛОЖЕНИЕ (тема, поисковик, модель) и переживает любые эксперименты; profiles.json описывает,
// ГДЕ ЛЕЖАТ ДАННЫЕ ЧЕЛОВЕКА. Смешать их — значит однажды потерять список профилей вместе с
// откатом настроек, а список профилей это карта к его кукам и логинам.

const FILE = 'profiles.json';

let state: ProfilesState | null = null;
const listeners = new Set<(s: ProfilesState) => void>();

function filePath(): string {
  return path.join(app.getPath('userData'), FILE);
}

function load(): ProfilesState {
  if (state) return state;
  try {
    const raw = fs.readFileSync(filePath(), 'utf8');
    state = parseProfiles(JSON.parse(raw));
  } catch {
    // Файла нет (первый запуск) или он битый — у человека всё равно есть основной профиль,
    // и это ровно та сессия, где лежат его данные. Разбор это гарантирует, см. parseProfiles.
    state = defaultProfilesState();
  }
  return state;
}

function save(next: ProfilesState): void {
  state = next;
  try {
    fs.writeFileSync(filePath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    console.warn('[profiles] не удалось записать profiles.json:', e);
  }
  for (const cb of listeners) cb(next);
}

export function getProfiles(): ProfilesState {
  return load();
}

export function getActiveProfile(): Profile {
  return activeProfile(load());
}

export function getProfile(id: string): Profile | null {
  return findProfile(load(), id);
}

export function onProfilesChanged(cb: (s: ProfilesState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function createProfile(name: string, color: string): ProfilesState {
  const next = addProfile(load(), name, color);
  save(next);
  return next;
}

export function deleteProfile(id: string): ProfilesState {
  const next = removeProfile(load(), id);
  save(next);
  return next;
}

export function updateProfileName(id: string, name: string): ProfilesState {
  const next = renameProfile(load(), id, name);
  save(next);
  return next;
}

export function updateProfileSettings(id: string, patch: Partial<ProfileSettings>): ProfilesState {
  const next = setProfileSettings(load(), id, patch);
  save(next);
  return next;
}

export function pinStartupProfile(id: string | null): ProfilesState {
  const next = setStartupProfile(load(), id);
  save(next);
  return next;
}

export function setActiveProfile(id: string): ProfilesState {
  const next = switchProfile(load(), id);
  save(next);
  return next;
}
