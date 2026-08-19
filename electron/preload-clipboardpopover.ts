import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { ClipboardEntry, ClipboardRevealResult } from '../shared/ipc';

// Мост поповера буфера. Как и у остальных оверлеев — свой preload, боевой window.oblako сюда не
// пробрасывается: вью изолированная и ей нужно ровно пять вызовов.
contextBridge.exposeInMainWorld('clipboardPopover', {
  list:    () => ipcRenderer.invoke(IPC.CLIPBOARD_LIST) as Promise<ClipboardEntry[]>,
  // Положить запись в системный буфер обмена — это и есть «взять из истории».
  put:     (id: number) => ipcRenderer.invoke(IPC.CLIPBOARD_PUT, id) as Promise<void>,
  // Взять из записи один адрес, а не текст: скопировали абзац со ссылкой, а нужна ссылка.
  putLink: (id: number, url: string) => ipcRenderer.invoke(IPC.CLIPBOARD_PUT_LINK, id, url) as Promise<void>,
  // Перейти к источнику: открыть страницу, где текст скопировали, и подсветить его на ней.
  openSource: (id: number) => ipcRenderer.invoke(IPC.CLIPBOARD_OPEN_SOURCE, id) as Promise<ClipboardRevealResult>,
  // Иконка сайта для заголовка группы. ⚠️ Своего канала не заводим — тот же FAVICON_GET, что у
  // списка паролей: он уже умеет кэш и берёт иконку ТОЛЬКО с самого домена (см. FaviconService.ts).
  favicon: (host: string) => ipcRenderer.invoke(IPC.FAVICON_GET, host) as Promise<string | null>,
  // Закрепить/открепить. false в ответе = полка закреплённого полна, запись НЕ закреплена.
  pin:     (id: number, on: boolean) => ipcRenderer.invoke(IPC.CLIPBOARD_PIN, id, on) as Promise<boolean>,
  remove:  (id: number) => ipcRenderer.invoke(IPC.CLIPBOARD_REMOVE, id) as Promise<void>,
  clear:   () => ipcRenderer.invoke(IPC.CLIPBOARD_CLEAR) as Promise<void>,
  getEnabled: () => ipcRenderer.invoke(IPC.CLIPBOARD_ENABLED_GET) as Promise<boolean>,
  setEnabled: (on: boolean) => ipcRenderer.invoke(IPC.CLIPBOARD_ENABLED_SET, on) as Promise<void>,
  close:   () => ipcRenderer.send('clipboard-popover:close'),
  reportHeight: (px: number) => ipcRenderer.send('clipboard-popover:height', px),
  onShow: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('clipboard-popover:show', handler);
    return () => ipcRenderer.removeListener('clipboard-popover:show', handler);
  },
});
