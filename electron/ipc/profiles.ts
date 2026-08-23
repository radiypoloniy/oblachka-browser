import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc';
import {
  DEFAULT_PROFILE_ID, type ProfileAvatar, type ProfileLook, type ProfileSettings,
} from '../../shared/profiles';
import {
  getProfiles, createProfile, deleteProfile, updateProfileName,
  updateProfileSettings, updateProfileAvatar, updateProfileLook,
  setActiveProfile, pinStartupProfile,
} from '../ProfileStore';
import { initProfileData } from '../ProfileData';
import { trackingCheckAfterProfileSwitch } from '../TrackingChecker';
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
    // ⚠️ То же правило и для остальных настроек сессии (UA, язык, адблок): применяются сразу,
    // иначе человек переключает вид на «Телефон», сайт открывается прежним — и функция выглядит
    // рабочей, ничего не делая.
    d.applyProfileSettings(String(id));
    broadcast();
    return state;
  });

  // ⚠️ Аватарка и облик прокси НЕ трогают — это внешность, а не сеть. Отдельные каналы, а не
  // поля в PROFILES_SETTINGS, именно поэтому: там каждая правка обязана переставить прокси
  // (см. шапку), и гнать перестановку туннеля из-за смены эмодзи было бы и медленно, и странно.
  ipcMain.handle(IPC.PROFILES_AVATAR, (_e, id: string, avatar: ProfileAvatar) => {
    const state = updateProfileAvatar(String(id), avatar);
    broadcast();
    return state;
  });

  ipcMain.handle(IPC.PROFILES_LOOK, (_e, id: string, patch: Partial<ProfileLook>) => {
    const state = updateProfileLook(String(id), (patch ?? {}) as Partial<ProfileLook>);
    // ⚠️ Правка облика ДЕЙСТВУЮЩЕГО профиля обязана перекрасить интерфейс тут же. Без этой
    // рассылки человек выбирал профилю тёмную тему и не видел ровно ничего: облик уходил на
    // диск, а тема пересчитывается только по THEME_CHANGED — то есть до следующего переключения
    // профиля настройка выглядела мёртвой. Ровно та же ошибка, что была с рассылкой списка
    // профилей 22.08: main всё делал правильно, а на экране не менялось ничего.
    if (String(id) === state.activeId) {
      broadcastToChrome(IPC.THEME_CHANGED, d.currentThemePrefs());
      d.broadcastChromeTheme();
    }
    broadcast();
    return state;
  });

  ipcMain.handle(IPC.PROFILES_STARTUP, (_e, id: string | null) => {
    const state = pinStartupProfile(typeof id === 'string' ? id : null);
    broadcast();
    return state;
  });

  ipcMain.handle(IPC.PROFILES_SWITCH, async (_e, id: string) => {
    const state = setActiveProfile(String(id));
    // ⚠️ ЖДЁМ базы нового профиля прежде, чем звать интерфейс перечитаться. У профиля своя
    // история и свои закладки (ProfileData.ts), и открываются они асинхронно: разошли мы
    // «обновитесь» раньше — человек увидел бы ПУСТЫЕ закладки и решил, что они пропали.
    await initProfileData(state.activeId);
    // ⚠️ Прокси НЕ трогаем: он персональный и уже стоит у каждой сессии.
    // ⚠️ А вот полосу вкладок трогаем обязательно и ВО ВСЕХ окнах: у профиля свой набор вкладок,
    // и чужие обязаны уйти с глаз (не закрыться — просто перестать показываться, см.
    // TabManager.onProfileSwitched). Без этого человек переключался и видел те же вкладки, что
    // и всегда, — ровно та жалоба, с которой началась эта правка.
    for (const ctx of allContexts()) ctx.tabs.onProfileSwitched();
    // Панель закладок висит на экране постоянно и сама не перечитывается — без этого она
    // продолжала бы показывать закладки прежнего профиля до первой правки.
    broadcastToChrome(IPC.BOOKMARK_CHANGED);
    // ⚠️ Отслеживание товаров тоже профильное (ProfileData.ts). Открытая страница «Что я
    // отслеживаю» и звёздочка-индикатор в адресной строке иначе показывали бы список прежнего
    // профиля — то есть чужие покупки под новым именем.
    broadcastToChrome(IPC.TRACKING_CHANGED);
    // Загрузки тоже профильные (DownloadManager.#profileOf): читаем файл нового профиля и
    // рассылаем его список — иначе значок и поповер показывали бы чужие файлы.
    d.downloads.onProfileSwitched(state.activeId);
    // ⚠️ Тема и палитра у профиля могут быть свои (ProfileLook), а разрешаются они в main
    // (currentThemePrefs). Без этой рассылки человек переключил бы профиль и увидел прежние
    // цвета до первой правки настроек — то есть решил бы, что своя тема не работает.
    broadcastToChrome(IPC.THEME_CHANGED, d.currentThemePrefs());
    d.broadcastChromeTheme();
    for (const ctx of allContexts()) d.pushProductState(ctx.win);
    // Товары нового профиля лежали без движения, пока человек сидел в другом, — догоняем
    // проверки его порогами запуска (см. TrackingChecker).
    trackingCheckAfterProfileSwitch();
    broadcast();
    return state;
  });
}
