import { clipboard, dialog, ipcMain } from 'electron';
import { IPC } from '../../shared/ipc';
import { INPUT_EXTENSIONS, INPUT_COUNT_MAX, type InputResult } from '../../shared/aiChatInputs';
import { connectionFor, getOrCreateContext, selectionFor, tabContexts } from './chatOwnership';
import { panelBySender } from './instances';
import * as files from '../ai/InputFileStore';
import * as registry from '../ai/registry';
import { registerDroppedInputs } from './dropInputs';

export function registerInputFiles(): void {
  registerDroppedInputs(imagesAllowed);
  ipcMain.handle(IPC.AI_PANEL_INPUT_PICK, async (event, requested: unknown): Promise<InputResult> => {
    const panel = panelBySender(event.sender), selected = selectionFor(event.sender, requested);
    if (!panel || !selected) return { ok: false, error: 'Беседа недоступна' };
    const ctx = getOrCreateContext(selected.key, selected.url, selected.title), job = ctx.job;
    if (ctx.pending) return { ok: false, error: 'Дождитесь ответа модели' };
    const allowImages = imagesAllowed(selected.source);
    const extensions = INPUT_EXTENSIONS.filter(ext => allowImages || !['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext));
    const picked = await dialog.showOpenDialog(panel.win, { properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Фото и документы', extensions: [...extensions] }] });
    if (picked.canceled) return { ok: true, files: [] };
    if (picked.filePaths.length > INPUT_COUNT_MAX) return { ok: false, error: 'Не более пяти файлов за один раз' };
    const added = [];
    try {
      for (const filename of picked.filePaths) added.push(await files.importFile(selected.key, filename, allowImages));
      // Диалог/разбор могут пережить переключение источника, очистку беседы или закрытие окна.
      if (event.sender.isDestroyed() || selectionFor(event.sender)?.key !== selected.key || tabContexts.get(ctx.key) !== ctx || ctx.job !== job) {
        throw new Error('Беседа изменилась. Прикрепите файлы заново.');
      }
      return { ok: true, files: added };
    } catch (error) {
      added.forEach(file => files.removeDraft(selected.key, file.id));
      return { ok: false, error: error instanceof Error ? error.message : 'Не удалось прикрепить файл' };
    }
  });
  ipcMain.handle(IPC.AI_PANEL_INPUT_PASTE, (event, requested: unknown): InputResult => {
    const selected = selectionFor(event.sender, requested);
    if (!selected || selectionFor(event.sender)?.key !== selected.key) return { ok: false, error: 'Беседа изменилась' };
    try {
      const ctx = getOrCreateContext(selected.key, selected.url, selected.title);
      if (ctx.pending) throw new Error('Дождитесь ответа модели');
      if (!imagesAllowed(selected.source)) throw new Error('Встроенная модель не читает изображения');
      const image = clipboard.readImage();
      if (image.isEmpty()) throw new Error('В буфере нет изображения');
      return { ok: true, files: [files.importImage(selected.key, image.toPNG())] };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Не удалось вставить изображение' }; }
  });
  ipcMain.handle(IPC.AI_PANEL_INPUT_REMOVE, (event, requested: unknown, id: unknown) => {
    const selected = selectionFor(event.sender, requested);
    if (selected && typeof id === 'string') files.removeDraft(selected.key, id);
  });
  ipcMain.handle(IPC.AI_PANEL_INPUT_PREVIEW, (event, requested: unknown, id: unknown) => {
    const selected = selectionFor(event.sender, requested);
    return selected && typeof id === 'string' ? files.preview(selected.key, id) : null;
  });
}

export function imagesAllowed(source: Parameters<typeof connectionFor>[0]): boolean {
  const id = connectionFor(source) ?? registry.routeFor('chat').connectionId;
  return id !== 'local' && registry.status().connections.some(connection => connection.id === id && connection.kind !== 'local');
}
