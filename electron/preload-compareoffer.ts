import { contextBridge, ipcRenderer } from 'electron';
import { compareBridge } from './preload/compare';
import { exposeUiLanguage } from './preload/uiLanguage';
import { IPC } from '../shared/ipc';
contextBridge.exposeInMainWorld('compareOffer', {
  ...compareBridge,
  reportHeight: (height: number) => ipcRenderer.send(IPC.COMPARE_OFFER_HEIGHT, height),
});
exposeUiLanguage();
