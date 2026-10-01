import { ipcRenderer } from 'electron';
import { IPC, type ContentBounds, type OblakoApi } from '../../shared/ipc';

export const contentBoundsBridge: Pick<OblakoApi, 'setContentBounds' | 'onContentBoundsRefresh'> = {
  setContentBounds: (b: ContentBounds) => ipcRenderer.invoke(IPC.CONTENT_SET_BOUNDS, b),
  onContentBoundsRefresh: cb => {
    const handler = () => cb(); ipcRenderer.on(IPC.CONTENT_REFRESH_BOUNDS, handler);
    return () => { ipcRenderer.off(IPC.CONTENT_REFRESH_BOUNDS, handler); };
  },
};
