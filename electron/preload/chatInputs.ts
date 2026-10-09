import { ipcRenderer } from 'electron';
import { IPC } from '../../shared/ipc';
import type { InputResult } from '../../shared/aiChatInputs';

export const chatInputsBridge = {
  pickInputs: (tabId: string): Promise<InputResult> => ipcRenderer.invoke(IPC.AI_PANEL_INPUT_PICK, tabId),
  pasteInput: (tabId: string): Promise<InputResult> => ipcRenderer.invoke(IPC.AI_PANEL_INPUT_PASTE, tabId),
  removeInput: (tabId: string, id: string): Promise<void> => ipcRenderer.invoke(IPC.AI_PANEL_INPUT_REMOVE, tabId, id),
  inputPreview: (tabId: string, id: string): Promise<string | null> => ipcRenderer.invoke(IPC.AI_PANEL_INPUT_PREVIEW, tabId, id),
};
