import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc';
import { INPUT_COUNT_MAX, INPUT_FILE_MAX, type InputResult } from '../../shared/aiChatInputs';
import { connectionFor, getOrCreateContext, selectionFor, tabContexts } from './chatOwnership';
import { panelBySender } from './instances';
import { contextForWindow } from '../WindowRegistry';
import { profileSession } from '../ProfileSession';
import * as files from '../ai/InputFileStore';

function dataBytes(url: string): Buffer {
  const match = /^data:image\/(?:png|jpeg|webp|gif);base64,([\da-z+/=\r\n]+)$/i.exec(url);
  if (!match || match[1].length > Math.ceil(INPUT_FILE_MAX * 4 / 3) + 4) throw new Error('Нужно изображение не больше 5 МБ');
  return Buffer.from(match[1], 'base64');
}

async function imageBytes(url: string, win: BrowserWindow): Promise<Buffer> {
  if (url.startsWith('data:')) return dataBytes(url);
  if (url.length > 8192) throw new Error('Слишком длинный адрес изображения');
  const address = new URL(url);
  const owner = contextForWindow(win);
  if (!owner) throw new Error('Окно закрыто');
  let source = owner.tabs.getActiveWebContents();
  // Ищем страницу-источник в этом окне: её куки, приватность и прокси относятся к картинке.
  for (const id of owner.tabs.tabIds()) {
    const page = owner.tabs.getWebContentsForTab(id);
    if (!page || page.isDestroyed()) continue;
    const found = await page.executeJavaScript(`Array.from(document.images).some(i=>i.currentSrc===${JSON.stringify(url)}||i.src===${JSON.stringify(url)})`).catch(() => false);
    if (found) { source = page; break; }
  }
  if (address.protocol === 'blob:') {
    if (!source || source.isDestroyed()) throw new Error('Страница изображения недоступна');
    // blob принадлежит renderer страницы. Получаем ограниченный снимок уже показанной картинки,
    // не читаем произвольные файлы и не переносим cookie в интерфейс панели.
    const snapshot: unknown = await source.executeJavaScript(`(() => {
      const image=Array.from(document.images).find(i=>i.currentSrc===${JSON.stringify(url)}||i.src===${JSON.stringify(url)});
      if(!image?.complete || !image.naturalWidth) return null;
      const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height); return canvas.toDataURL('image/png');
    })()`);
    if (typeof snapshot !== 'string') throw new Error('Не удалось прочитать изображение страницы');
    return dataBytes(snapshot);
  }
  if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password) throw new Error('Нужен адрес HTTP/HTTPS или изображение страницы');
  const session = source && !source.isDestroyed() ? source.session : profileSession();
  const response = await session.fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/')) throw new Error('По адресу не удалось загрузить изображение');
  if (Number(response.headers.get('content-length')) > INPUT_FILE_MAX) { await response.body?.cancel(); throw new Error('Изображение больше 5 МБ'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Пустое изображение');
  const chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > INPUT_FILE_MAX) throw new Error('Изображение больше 5 МБ');
      chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}

export function registerDroppedInputs(allowImages: (source: Parameters<typeof connectionFor>[0]) => boolean): void {
  ipcMain.handle(IPC.AI_PANEL_INPUT_DROP, async (event, requested: unknown, inputs: unknown): Promise<InputResult> => {
    const panel = panelBySender(event.sender), selected = selectionFor(event.sender, requested);
    if (!panel || !selected || selectionFor(event.sender)?.key !== selected.key) return { ok: false, error: 'Беседа изменилась' };
    const ctx = getOrCreateContext(selected.key, selected.url, selected.title), job = ctx.job;
    const added = [];
    try {
      if (ctx.pending) throw new Error('Дождитесь ответа модели');
      if (!allowImages(selected.source)) throw new Error('Встроенная модель не читает изображения');
      if (!Array.isArray(inputs) || !inputs.length || inputs.length > INPUT_COUNT_MAX) throw new Error('До пяти изображений за один раз');
      for (const value of inputs) {
        if (!value || typeof value !== 'object') throw new Error('Некорректное изображение');
        const input = value as Record<string, unknown>;
        let bytes: Buffer, name = 'Изображение.png';
        if (typeof input.url === 'string') {
          bytes = await imageBytes(input.url, panel.win);
          if (/^https?:/.test(input.url)) name = new URL(input.url).pathname.split('/').at(-1)?.slice(0, 100) || name;
        } else {
          if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength > INPUT_FILE_MAX) throw new Error('Нужно изображение не больше 5 МБ');
          bytes = Buffer.from(input.bytes);
          if (typeof input.name === 'string') name = input.name.replace(/[\\/\u0000-\u001f]/g, '').slice(0, 100) || name;
        }
        added.push(files.importImage(selected.key, bytes, name));
      }
      if (event.sender.isDestroyed() || selectionFor(event.sender)?.key !== selected.key || tabContexts.get(ctx.key) !== ctx || ctx.job !== job) throw new Error('Беседа изменилась. Прикрепите изображения заново.');
      return { ok: true, files: added };
    } catch (error) {
      added.forEach(file => files.removeDraft(selected.key, file.id));
      return { ok: false, error: error instanceof Error ? error.message : 'Не удалось прикрепить изображение' };
    }
  });
}
