import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc';
import { hubSelection, syncHubChats } from '../hubChatOwnership';
import { buildGroundingPrompt, searxngSearch } from '../SearxngSearch';
import type { ChatOutcome } from '../TranslationService';
import { uiLanguage } from '../uiText';
import type { IpcDeps } from './deps';

export function registerHubChatIpc({ hubChat, sendTo }: IpcDeps): void {
  const jobs = new Map<string, object>();
  ipcMain.on(IPC.HUB_CHAT_SEND, (e, payload: { tabId: string; text: string; grounding: boolean; sourcesContext?: string; notebook?: boolean }) => {
    const selection = hubSelection(e.sender, payload?.tabId);
    if (!selection || typeof payload.text !== 'string' || !payload.text.trim() || jobs.has(selection.key)) return;
    const { key, owner } = selection;
    syncHubChats(owner.win, hubChat);
    const token = {};
    jobs.set(key, token);
    const current = () => jobs.get(key) === token && !owner.win.isDestroyed();
    const cancel = () => { if (jobs.get(key) === token) jobs.delete(key); };
    owner.win.once('closed', cancel);
    const sendResult = (sessionId: number | null, outcome: ChatOutcome) => {
      if (current()) sendTo(owner.chromeView.webContents, IPC.HUB_CHAT_RESULT, {
        tabId: payload.tabId, sessionId,
        outcome: outcome.ok ? { ok: true, out: outcome.out } : { ok: false, error: outcome.error },
      });
    };
    void (async () => {
      const { text, sourcesContext } = payload;
      let grounding: Parameters<typeof hubChat.sendMessage>[3];
      if (payload.grounding) {
        const search = await searxngSearch(text);
        if (!current()) return;
        if (!search.ok) { sendResult(null, { ok: false, error: search.error }); return; }
        grounding = { promptText: buildGroundingPrompt(text, search.results), sources: search.results };
      } else if (sourcesContext?.trim()) {
        const prefix = uiLanguage() === 'en'
          ? 'Answer from the sources below. If they do not contain the answer, say so — do not invent.\n\n'
          : 'Отвечай, опираясь на приведённые источники. Если ответа в них нет — так и скажи, не выдумывай.\n\n';
        grounding = { promptText: prefix + sourcesContext + '\n\n' + text, sources: [] };
      }
      if (!current()) return;
      const result = await hubChat.sendMessage(key, text, chunk => {
        if (current()) sendTo(owner.chromeView.webContents, IPC.HUB_CHAT_CHUNK, { tabId: payload.tabId, text: chunk });
      }, grounding, payload.notebook ? 'notebook' : 'chat');
      sendResult(result.sessionId, result.outcome);
    })().catch(error => sendResult(null, { ok: false, error: String(error) })).finally(() => {
      cancel(); owner.win.removeListener('closed', cancel);
    });
  });
  ipcMain.handle(IPC.HUB_CHAT_LIST_SESSIONS, () => hubChat.listSessions());
  ipcMain.handle(IPC.HUB_CHAT_GET_SESSION, (_e, id: number) => hubChat.getSession(id));
  ipcMain.handle(IPC.HUB_CHAT_NEW_SESSION, (e, id: string) => {
    const selection = hubSelection(e.sender, id);
    if (selection) { jobs.delete(selection.key); hubChat.newSession(selection.key); }
  });
  ipcMain.handle(IPC.HUB_CHAT_RESUME_SESSION, (e, id: string, sessionId: number) => {
    const selection = hubSelection(e.sender, id);
    if (!selection) return [];
    jobs.delete(selection.key);
    return hubChat.resumeSession(selection.key, sessionId);
  });
  ipcMain.handle(IPC.HUB_CHAT_DELETE_SESSION, (_e, id: number) => hubChat.deleteSession(id));
}
