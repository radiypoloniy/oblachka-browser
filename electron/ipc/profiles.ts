import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc';
import { DEFAULT_PROFILE_ID, type ProfileSettings } from '../../shared/profiles';
import {
  getProfiles, createProfile, deleteProfile, updateProfileName,
  updateProfileSettings, setActiveProfile, pinStartupProfile,
} from '../ProfileStore';
import { allContexts, broadcastToChrome } from '../WindowRegistry';
import type { IpcDeps } from './deps';

// Профили: свои куки и свои сетевые настройки (см. shared/profiles.ts).
//
// ⚠️ Каждая правка, меняющая сетевые настройки профиля, ОБЯЗАНА тут же переставить прокси.
// Иначе человек переключил профиль в «только через VPN», увидел новую подпись — а трафик
// продолжает идти как шёл. Ложное чувство защиты хуже её отсутствия: ровно этим обоснован
// fail-closed у VPN (см. комментарий к kill switch в main.ts).

// ⚠️ broadcastToChrome, а НЕ BrowserWindow.webContents.send. Интерфейс браузера живёт в
// WebContentsView внутри окна, и webContents САМОГО окна — это другой объект: сообщение туда
// уходит в никуда. Живой случай 22.08: переключение профиля и удаление молча «не работали» —
// main всё делал правильно, но список на экране не обновлялся, и человек видел, будто кнопки
// мертвы. Хуже того, удалённые профили продолжали показываться, пока их не смахнуло следующим
// ответом IPC, — со стороны это выглядело как пропажа данных.
function broadcast(): void {
  broadcastToChrome(IPC.PROFILES_CHANGED, getProfiles());
}

export function registerProfilesIpc(d: IpcDeps): void {
  ipcMain.handle(IPC.PROFILES_GET, () => getProfiles());

  ipcMain.handle(IPC.PROFILES_CREATE, async (_e, name: string, color: string) => {
    const before = new Set(getProfiles().profiles.map((p) => p.id));
    const state = createProfile(String(name ?? ''), String(color ?? 'blue'));
    // Новая сессия обязана получить тот же набор, что у основной (адблок, разрешения,
    // подсказки, доверие корню) — иначе профиль откроется без адблока.
    for (const p of state.profiles) if (!before.has(p.id)) d.wireProfileSession(p.id);
    await d.applyVpnProxy();
    broadcast();
    return state;
  });

  ipcMain.handle(IPC.PROFILES_REMOVE, async (_e, id: string) => {
    // ⚠️ Основной не удаляется — это сессия, где лежат данные человека. Модель это уже знает
    // (removeProfile вернёт состояние как было), здесь только не даём дойти до очистки.
    if (String(id) === DEFAULT_PROFILE_ID) return getProfiles();
    const state = deleteProfile(String(id));
    await d.applyVpnProxy();
    broadcast();
    return state;
  });

  ipcMain.handle(IPC.PROFILES_RENAME, (_e, id: string, name: string) => {
    const state = updateProfileName(String(id), String(name ?? ''));
    broadcast();
    return state;
  });

  ipcMain.handle(IPC.PROFILES_SETTINGS, async (_e, id: string, patch: Partial<ProfileSettings>) => {
    const state = updateProfileSettings(String(id), (patch ?? {}) as Partial<ProfileSettings>);
    // ⚠️ Немедленно, а не при следующей смене состояния VPN: см. шапку файла.
    await d.applyVpnProxy();
    broadcast();
    return state;
  });

  ipcMain.handle(IPC.PROFILES_STARTUP, (_e, id: string | null) => {
    const state = pinStartupProfile(typeof id === 'string' ? id : null);
    broadcast();
    return state;
  });

  ipcMain.handle(IPC.PROFILES_SWITCH, (_e, id: string) => {
    const state = setActiveProfile(String(id));
    // ⚠️ Прокси НЕ трогаем: он персональный и уже стоит у каждой сессии.
    // ⚠️ А вот полосу вкладок трогаем обязательно и ВО ВСЕХ окнах: у профиля свой набор вкладок,
    // и чужие обязаны уйти с глаз (не закрыться — просто перестать показываться, см.
    // TabManager.onProfileSwitched). Без этого человек переключался и видел те же вкладки, что
    // и всегда, — ровно та жалоба, с которой началась эта правка.
    for (const ctx of allContexts()) ctx.tabs.onProfileSwitched();
    broadcast();
    return state;
  });
}
