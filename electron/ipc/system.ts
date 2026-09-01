// Загрузки, разрешения сайтов, браузер по умолчанию, онбординг, поиск по настройкам
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import { IPC } from '../../shared/ipc';
import type { DownloadNameSuggestion, DownloadRenameResult, ParsedAddressPart, PermKey } from '../../shared/ipc';
import { parseAddressBlob } from '../AddressParser';
import { openAiPanelApp } from '../AiPanelManager';
import { getCryptoHistory } from '../CryptoRates';
import { getCurrencyHistory } from '../CurrencyRates';
import { isDefaultBrowser, requestDefaultBrowser } from '../DefaultBrowser';
import { renameDownloadedFile, suggestFileName } from '../DownloadNamer';
import { permissionAnswered, setPermissionPopoverHeight } from '../PermissionPopoverManager';
import { searchSettingsByMeaning } from '../SettingsSearch';
import { ipcMain } from 'electron';
import type { IpcDeps } from './deps';
import { buildResourceSnapshot, sleepTabFromResources } from '../ResourceSnapshot';

// То же самое для поиска по настройкам фразой (см. SETTINGS_SEARCH_SMART).
let settingsSearchBusy = false;

export function registerSystemIpc(d: IpcDeps): void {
  // ── Диспетчер задач (Shift+Esc) ────────────────────────────────────────────
  //
  // ⚠️ Здесь, а не в menus.ts: та функция уже за порогом храповика, и дописывать в неё новое —
  // растить то, что и так велико. Ресурсы приложения — системная тема, файл подходит по смыслу.
  // Разбор «почему Private Bytes» и «почему снимок по запросу» — в шапке ResourceSnapshot.ts.
  ipcMain.handle(IPC.RESOURCES_SNAPSHOT, () => buildResourceSnapshot());
  ipcMain.handle(IPC.RESOURCES_SLEEP_TAB, (_e, tabId: string) => sleepTabFromResources(tabId));

  const { downloads, permissions, settings, winOf } = d;

  // был только предложением импорта, и без источников показывать было нечего. Теперь это ещё и
  // рассказ о браузере — он нужен и тому, у кого переносить нечего (шаг переноса в этом случае
  // сам скажет, что источников не нашлось).
  ipcMain.handle(IPC.CURRENCY_HISTORY, (_e, code: string, days?: number) => getCurrencyHistory(code, days));
  ipcMain.handle(IPC.CRYPTO_HISTORY, (_e, ticker: string, days?: number) => getCryptoHistory(ticker, days));

  ipcMain.handle(IPC.AI_PANEL_OPEN_APP, (e, appId: string) => {
    const w = winOf(e);
    if (w) openAiPanelApp(w, appId);
  });

  ipcMain.handle(IPC.DOWNLOADS_GET_ASK_LOCATION, () => settings.getAskDownloadLocation());
  ipcMain.handle(IPC.DOWNLOADS_SET_ASK_LOCATION, (_e, value: boolean) => {
    settings.setAskDownloadLocation(value);
    downloads.setAskLocation(value);
  });

  ipcMain.handle(IPC.DEFAULT_BROWSER_IS, () => isDefaultBrowser());
  ipcMain.handle(IPC.DEFAULT_BROWSER_REQUEST, () => requestDefaultBrowser());

  ipcMain.handle(IPC.ONBOARDING_SHOULD_SHOW, () => !settings.getImportOffered());
  ipcMain.handle(IPC.ONBOARDING_MARK_SHOWN, () => { settings.setImportOffered(); });

  // Разрешения сайтов. Ответ приходит из вью поповера (preload-permissionpopover.ts); после
  // него снимаем вопрос с очереди — там может ждать следующий (сайт умеет попросить камеру и
  // геолокацию подряд).
  ipcMain.handle(IPC.PERMISSION_RESPONSE,
    (_e, requestId: string, granted: boolean, remember: boolean) => {
      permissions.respond(requestId, granted, remember);
      permissionAnswered(requestId);
    },
  );
  ipcMain.on('permission-popover:height', (e, px: number) => setPermissionPopoverHeight(e.sender, px));
  // Раздел настроек «Разрешения сайтов». ⚠️ Отозвать (забыть) и запретить — РАЗНЫЕ операции:
  // забытый сайт спросит снова, запрещённый не спросит никогда. Склеить их в одну кнопку значило
  // бы лишить человека способа исправить своё же ошибочное «нет».
  ipcMain.handle(IPC.PERMISSION_HINT, (_e, origin: string) =>
    permissions.hintFor(typeof origin === 'string' ? origin : ''));
  ipcMain.handle(IPC.PERMISSION_LIST, () => permissions.list());
  ipcMain.handle(IPC.PERMISSION_SET, (_e, origin: string, key: PermKey, decision: 'granted' | 'denied') => {
    permissions.set(origin, key, decision);
  });
  ipcMain.handle(IPC.PERMISSION_REVOKE, (_e, origin: string, key?: PermKey) => {
    permissions.revoke(origin, key);
  });

  // Загрузки
  ipcMain.handle(IPC.DOWNLOADS_GET_ALL,    ()               => downloads.getAll());
  ipcMain.handle(IPC.DOWNLOAD_PAUSE,       (_e, id: string) => downloads.pause(id));
  ipcMain.handle(IPC.DOWNLOAD_RESUME,      (_e, id: string) => downloads.resume(id));
  ipcMain.handle(IPC.DOWNLOAD_CANCEL,      (_e, id: string) => downloads.cancel(id));
  ipcMain.handle(IPC.DOWNLOAD_CLEAR,       (_e, id: string) => downloads.clear(id));
  ipcMain.handle(IPC.DOWNLOAD_OPEN_FILE,   (_e, id: string) => downloads.openFile(id));
  ipcMain.handle(IPC.DOWNLOAD_SHOW_FOLDER, (_e, id: string) => downloads.showFolder(id));
  ipcMain.handle(IPC.DOWNLOAD_RETRY,       (_e, id: string) => downloads.retry(id));

  // Поиск по настройкам фразой (AI-IDEAS.md №6) — второй эшелон, зовётся только на промахе
  // ключевых слов. ⚠️ Гвард «один запрос за раз» тот же, что у поиска вкладок: человек печатает
  // быстрее, чем модель отвечает, а очередь генерации общая и прерывать начатую нельзя.
  ipcMain.handle(IPC.SETTINGS_SEARCH_SMART, async (_e, query: string): Promise<number[]> => {
    if (settingsSearchBusy) return [];
    settingsSearchBusy = true;
    try {
      return await searchSettingsByMeaning(query);
    } catch (err) {
      console.warn('[settings-search] ошибка:', err);
      return [];
    } finally {
      settingsSearchBusy = false;
    }
  });

  // Разбор адреса строкой по кнопке в настройках (AI-IDEAS.md №1, вторая половина). Тот же
  // разбор, что у вставки на странице, но по явной просьбе — поэтому ждать модель он вправе.
  ipcMain.handle(IPC.AUTOFILL_PARSE_ADDRESS, async (_e, text: string): Promise<ParsedAddressPart[]> => {
    const parts = await parseAddressBlob(text, { explicit: true });
    return parts.map((p) => ({ key: p.key, label: p.label, value: p.value }));
  });

  // Имя по содержимому (AI-IDEAS.md №3). ⚠️ Ровно два шага, и между ними стоит человек:
  // «предложить» только читает файл и считает, «переименовать» трогает диск.
  ipcMain.handle(IPC.DOWNLOAD_SUGGEST_NAME, async (_e, id: string): Promise<DownloadNameSuggestion> => {
    const savePath = downloads.pathForRead(id);
    if (!savePath) return { ok: false, error: 'Файла на месте нет' };
    const res = await suggestFileName(savePath);
    return res.ok ? { ok: true, name: res.name } : { ok: false, error: res.error };
  });
  ipcMain.handle(IPC.DOWNLOAD_RENAME, async (_e, id: string, name: string): Promise<DownloadRenameResult> => {
    const savePath = downloads.pathForRead(id);
    if (!savePath) return { ok: false, error: 'Файла на месте нет' };
    const res = await renameDownloadedFile(savePath, name);
    if (!res.ok) return { ok: false, error: res.error };
    downloads.applyRename(id, res.filename, res.savePath);
    return { ok: true, filename: res.filename };
  });

}
