import { contextBridge, ipcRenderer } from 'electron';
import type { AutofillPopoverState } from './AutofillPopoverManager';

contextBridge.exposeInMainWorld('autofillPopover', {
  pick:         (id: number) => ipcRenderer.send('autofill-popover:pick', id),
  save:         () => ipcRenderer.send('autofill-popover:save'),
  close:        () => ipcRenderer.send('autofill-popover:close'),
  reportHeight: (px: number) => ipcRenderer.send('autofill-popover:height', px),
  onShow: (cb: (state: AutofillPopoverState) => void) => {
    const handler = (_e: unknown, state: AutofillPopoverState) => cb(state);
    ipcRenderer.on('autofill-popover:show', handler);
    return () => ipcRenderer.removeListener('autofill-popover:show', handler);
  },
});
