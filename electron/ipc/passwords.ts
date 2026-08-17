// Автозаполнение форм и пароли: CRUD, экспорт/импорт, индикатор
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import { IPC } from '../../shared/ipc';
import type { AddressInput, AddressUpdate, CardInput, CardUpdate, CsvPasswordImport, PasswordAddInput, PasswordGenerateOptions, PasswordUpdateInput } from '../../shared/ipc';
import { parseCsvPasswords } from '../../shared/csvPasswords';
import * as passwordAutofill from '../PasswordAutofillManager';
import { broadcastToChrome } from '../WindowRegistry';
import { dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import type { IpcDeps } from './deps';

export function registerPasswordsIpc(d: IpcDeps): void {
  const { autofill, ensurePasswordAuth, passwords, winOf } = d;

  const pushAutofillChanged = () => broadcastToChrome(IPC.AUTOFILL_CHANGED);
  ipcMain.handle(IPC.AUTOFILL_ADDRESS_LIST,   () => autofill.listAddresses());
  ipcMain.handle(IPC.AUTOFILL_ADDRESS_ADD,    (_e, input: AddressInput) => { const ok = autofill.addAddress(input); if (ok) pushAutofillChanged(); return ok; });
  ipcMain.handle(IPC.AUTOFILL_ADDRESS_UPDATE, (_e, input: AddressUpdate) => { const ok = autofill.updateAddress(input); if (ok) pushAutofillChanged(); return ok; });
  ipcMain.handle(IPC.AUTOFILL_ADDRESS_DELETE, (_e, id: number) => { const ok = autofill.deleteAddress(id); if (ok) pushAutofillChanged(); return ok; });
  ipcMain.handle(IPC.AUTOFILL_CARD_LIST,      () => autofill.listCards());
  ipcMain.handle(IPC.AUTOFILL_CARD_ADD,       (_e, input: CardInput) => { const ok = autofill.addCard(input); if (ok) pushAutofillChanged(); return ok; });
  ipcMain.handle(IPC.AUTOFILL_CARD_UPDATE,    (_e, input: CardUpdate) => { const ok = autofill.updateCard(input); if (ok) pushAutofillChanged(); return ok; });
  ipcMain.handle(IPC.AUTOFILL_CARD_DELETE,    (_e, id: number) => { const ok = autofill.deleteCard(id); if (ok) pushAutofillChanged(); return ok; });
  ipcMain.handle(IPC.AUTOFILL_CARD_REVEAL,    async (_e, id: number) =>
    (await ensurePasswordAuth('Показать номер карты')) ? autofill.revealCardNumber(id) : null);
  ipcMain.handle(IPC.PASSWORDS_GENERATE, (_e, opts: PasswordGenerateOptions) => passwords.generate(opts));
  ipcMain.handle(IPC.PASSWORDS_ADD, (_e, input: PasswordAddInput) => {
    const ok = passwords.add(input);
    if (ok) broadcastToChrome(IPC.PASSWORDS_CHANGED);
    return ok;
  });
  ipcMain.handle(IPC.PASSWORDS_UPDATE, (_e, input: PasswordUpdateInput) => {
    const ok = passwords.update(input);
    if (ok) broadcastToChrome(IPC.PASSWORDS_CHANGED);
    return ok;
  });
  ipcMain.handle(IPC.PASSWORDS_DELETE, (_e, id: number) => {
    passwords.delete(id);
    broadcastToChrome(IPC.PASSWORDS_CHANGED);
  });
  // Экспорт/импорт — диалог выбора файла целиком в main, на диск попадает только уже
  // зашифрованная под passphrase строка (см. PasswordManager.exportVault/importVault),
  // никогда не расшифрованный JSON.
  ipcMain.handle(IPC.PASSWORDS_EXPORT, async (e, passphrase: string) => {
    const w = winOf(e);
    const payload = passwords.exportVault(passphrase);
    if (payload === null || !w) return false;
    const { canceled, filePath } = await dialog.showSaveDialog(w, {
      title: 'Экспорт паролей',
      defaultPath: 'oblako-passwords.json',
      filters: [{ name: 'Зашифрованный экспорт', extensions: ['json'] }],
    });
    if (canceled || !filePath) return false;
    try {
      fs.writeFileSync(filePath, payload, 'utf8');
      return true;
    } catch (e) {
      console.error('[Passwords] экспорт: не удалось записать файл:', (e as Error).message);
      return false;
    }
  });
  ipcMain.handle(IPC.PASSWORDS_IMPORT, async (e, passphrase: string) => {
    const w = winOf(e);
    if (!w) return 0;
    const { canceled, filePaths } = await dialog.showOpenDialog(w, {
      title: 'Импорт паролей',
      filters: [{ name: 'Зашифрованный экспорт', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return 0;
    let payload: string;
    try {
      payload = fs.readFileSync(filePaths[0], 'utf8');
    } catch (e) {
      console.error('[Passwords] импорт: не удалось прочитать файл:', (e as Error).message);
      return 0;
    }
    const count = passwords.importVault(passphrase, payload);
    if (count > 0) broadcastToChrome(IPC.PASSWORDS_CHANGED);
    return count;
  });
  // Импорт паролей из CSV-экспорта другого браузера (см. shared/csvPasswords.ts — почему CSV, а не
  // чтение с диска). Диалог выбора файла и разбор целиком здесь; в сейф уходит через тот же
  // неразрушающий bulkImport, что и импорт с диска (только вставка новых, дедуп по origin+username,
  // существующий пароль не перезаписывается).
  ipcMain.handle(IPC.IMPORT_PASSWORDS_CSV, async (e): Promise<CsvPasswordImport> => {
    const w = winOf(e);
    if (!w) return { status: 'canceled' };
    // Сейф мог не подняться (нет safeStorage/нативного модуля) — переносить некуда, честно скажем.
    if (!passwords.available) return { status: 'vault-unavailable' };
    const { canceled, filePaths } = await dialog.showOpenDialog(w, {
      title: 'Импорт паролей из CSV',
      filters: [{ name: 'CSV-экспорт паролей', extensions: ['csv'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return { status: 'canceled' };
    let text: string;
    try {
      text = fs.readFileSync(filePaths[0], 'utf8');
    } catch (err) {
      console.error('[Passwords] CSV-импорт: не удалось прочитать файл:', (err as Error).message);
      return { status: 'read-error' };
    }
    const rows = parseCsvPasswords(text);
    if (rows.length === 0) return { status: 'empty' };
    const { inserted, skipped } = passwords.bulkImport(rows);
    if (inserted > 0) broadcastToChrome(IPC.PASSWORDS_CHANGED);
    return { status: 'ok', inserted, skipped };
  });

  // Менеджер паролей, шаг 2 — действия из поповера индикатора (всегда про активную вкладку,
  // см. PasswordAutofillManager.ts::handleSave/handleUpdate/handleDismiss).
  // ⚠️ «Активная вкладка» здесь — активная в окне ОТПРАВИТЕЛЯ: пароль обязан уйти на ту страницу,
  // где человек его и вводит, а не на активную вкладку соседнего окна.
  ipcMain.handle(IPC.PASSWORDS_INDICATOR_SAVE,    (e) => { const w = winOf(e); return w ? passwordAutofill.handleSave(w) : false; });
  ipcMain.handle(IPC.PASSWORDS_INDICATOR_UPDATE,  (e) => { const w = winOf(e); return w ? passwordAutofill.handleUpdate(w) : false; });
  ipcMain.handle(IPC.PASSWORDS_INDICATOR_FILL,    (e, id: number) => { const w = winOf(e); return w ? passwordAutofill.handleFill(w, id) : false; });
  ipcMain.handle(IPC.PASSWORDS_INDICATOR_DISMISS, (e) => { const w = winOf(e); if (w) passwordAutofill.handleDismiss(w); });
  ipcMain.handle(IPC.PASSWORDS_INDICATOR_GENERATE, (e) => { const w = winOf(e); return w ? passwordAutofill.handleGenerateAndFill(w) : false; });

  // Индикатор качества индекса умного поиска (Settings.tsx) — снимок на момент запроса,
}
