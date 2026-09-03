// Чат хаба, ключ Gemini, SearXNG, пользовательские скиллы
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import * as ConnectionStore from '../ai/ConnectionStore';
import * as KeyStore from '../ai/KeyStore';
import { connectionsState, probeConnection } from '../ai/connections';
import type { Connection } from '../../shared/aiProviders';
import type { AiRole } from '../../shared/aiRouting';
import { IPC } from '../../shared/ipc';
import * as aiKeyStore from '../AiKeyStore';
import * as searxngKeyStore from '../SearxngKeyStore';
import { buildGroundingPrompt, searxngSearch } from '../SearxngSearch';
import * as skillsStore from '../SkillsStore';
import type { ChatOutcome } from '../TranslationService';
import { broadcastToChrome } from '../WindowRegistry';
import { dialog, ipcMain } from 'electron';
import fsp from 'node:fs/promises';
import * as FileStore from '../ai/FileStore';
import { extForMime } from '../../shared/aiAttachments';
import { sanitizeFileNameBase } from '../../shared/fileNameSafety';
import { randomUUID } from 'node:crypto';
import type { IpcDeps } from './deps';

export function registerAiHubIpc(d: IpcDeps): void {
  const { chromeOf, hubChat, sendTo, winOf } = d;

  // AI-чат на Hub (см. electron/HubChatManager.ts) — только локальная модель в этом заходе.
  // send — fire-and-forget (не invoke): ответ идёт стримом чанков + финальным результатом,
  // так проще, чем тащить длинный запрос через invoke (тот же приём, что у AI-панели).
  ipcMain.on(IPC.HUB_CHAT_SEND, (e, payload: { tabId: string; text: string; grounding: boolean; sourcesContext?: string }) => {
    const { tabId, text, grounding, sourcesContext } = payload;
    // Адресат ответа фиксируется в момент запроса: стрим приходит асинхронно, и к его концу
    // фокус может быть уже в другом окне — искать окно заново было бы поздно и неверно.
    const target = chromeOf(e);
    const sendResult = (sessionId: number | null, outcome: ChatOutcome) => {
      sendTo(target, IPC.HUB_CHAT_RESULT, {
        tabId,
        sessionId,
        outcome: outcome.ok ? { ok: true, out: outcome.out } : { ok: false, error: outcome.error },
      });
    };
    const onChunk = (chunkText: string) => {
      sendTo(target, IPC.HUB_CHAT_CHUNK, { tabId, text: chunkText });
    };
    void (async () => {
      // Web-grounding (SearXNG) — ОТДЕЛЬНАЯ ветка перед обычным путём ниже, целиком независимая
      // (тот же приём, что в AiPanelManager.ts::ai-panel:chat-send): риск сломать обычный
      // хаб-чат/персистентность сессий сведён к этому одному if с ранним return, сам обычный
      // путь (hubChat.sendMessage(tabId, text, onChunk) без 4-го аргумента) не тронут ни строкой.
      // Нет извлечения страницы, в отличие от AI-панели — в Hub её физически нет (это не вкладка
      // сайта), запрос = сырой текст пользователя как есть.
      if (grounding) {
        const search = await searxngSearch(text);
        if (!search.ok) {
          sendResult(null, { ok: false, error: search.error });
          return;
        }
        const promptText = buildGroundingPrompt(text, search.results);
        const { outcome, sessionId } = await hubChat.sendMessage(tabId, text, onChunk, { promptText, sources: search.results });
        sendResult(sessionId, outcome);
        return;
      }
      // Грунтинг блокнота: подмешиваем текст выбранных источников в промпт (модель отвечает по ним),
      // но в истории/показе остаётся сырой вопрос пользователя. sources пуст → ссылки не дописываются.
      if (sourcesContext && sourcesContext.trim()) {
        const promptText =
          'Отвечай, опираясь на приведённые источники. Если ответа в них нет — так и скажи, не выдумывай.\n\n'
          + sourcesContext + '\n\nВопрос: ' + text;
        const { outcome, sessionId } = await hubChat.sendMessage(tabId, text, onChunk, { promptText, sources: [] });
        sendResult(sessionId, outcome);
        return;
      }
      const { outcome, sessionId } = await hubChat.sendMessage(tabId, text, onChunk);
      sendResult(sessionId, outcome);
    })();
  });
  ipcMain.handle(IPC.HUB_CHAT_LIST_SESSIONS, () => hubChat.listSessions());
  ipcMain.handle(IPC.HUB_CHAT_GET_SESSION, (_e, sessionId: number) => hubChat.getSession(sessionId));
  ipcMain.handle(IPC.HUB_CHAT_NEW_SESSION, (_e, tabId: string) => hubChat.newSession(tabId));
  ipcMain.handle(IPC.HUB_CHAT_RESUME_SESSION, (_e, tabId: string, sessionId: number) =>
    hubChat.resumeSession(tabId, sessionId));
  ipcMain.handle(IPC.HUB_CHAT_DELETE_SESSION, (_e, sessionId: number) => hubChat.deleteSession(sessionId));

  // Заход D — ключ Gemini (AI-фактчек). Сам ключ не возвращается в renderer, только статус.
  ipcMain.handle(IPC.AI_GET_KEY_STATUS, () => aiKeyStore.getKeyStatus());
  ipcMain.handle(IPC.AI_SAVE_KEY,       (_e, key: string) => aiKeyStore.saveKey(key));
  ipcMain.handle(IPC.AI_DELETE_KEY,     () => aiKeyStore.deleteKey());

  // ── Подключения к моделям ────────────────────────────────────────────────
  // ⚠️ Снимок собирается ЗДЕСЬ, а не хранится: `ready` зависит от ключей (другое хранилище), а
  // список и маршруты — от своего. Держать их склеенными в третьем месте значило бы завести
  // состояние, которое умеет разъехаться с обоими источниками.
  ipcMain.handle(IPC.AI_CONN_LIST, () => connectionsState());
  ipcMain.handle(IPC.AI_CONN_SAVE, (_e, conn: Connection, key: string | null) => {
    // ⚠️ Порядок важен: сперва ключ, потом подключение. Иначе между записями существует момент,
    // когда подключение уже видно интерфейсу, а ключа у него ещё нет, — и первый же запрос уйдёт
    // с отказом «нет ключа», хотя человек его только что ввёл.
    if (key !== null && key.trim()) KeyStore.saveKey(conn.id, key);
    return ConnectionStore.upsert(conn);
  });
  ipcMain.handle(IPC.AI_CONN_DELETE, (_e, id: string) => {
    // Ключ удаляем вместе с подключением: осиротевший секрет на диске никому не нужен.
    KeyStore.deleteKey(id);
    return ConnectionStore.remove(id);
  });
  ipcMain.handle(IPC.AI_CONN_TEST, (_e, conn: Connection, key: string | null) => probeConnection(conn, key));
  ipcMain.handle(IPC.AI_SET_ROUTE, (_e, role: AiRole, connectionId: string | null) =>
    ConnectionStore.setRoute(role, connectionId));

  // ── Вложения из ответа модели ────────────────────────────────────────────
  // ⚠️ id приезжает из renderer и превращается в ПУТЬ. Проверка формы — внутри FileStore, здесь
  // её не дублируем: два места, решающих, что такое годный id, разъедутся на первой же правке.
  ipcMain.handle(IPC.AI_FILE_DATA, (_e, id: string) => FileStore.dataUrl(id));
  ipcMain.handle(IPC.AI_FILE_SAVE, async (e, id: string) => {
    const w = winOf(e);
    const src = FileStore.pathOf(id);
    const meta = FileStore.metaOf(id);
    if (!w || src === null || meta === null) return false;
    const res = await dialog.showSaveDialog(w, {
      title: 'Сохранить вложение',
      defaultPath: meta.name,
      filters: [{ name: meta.kind === 'image' ? 'Изображение' : 'Файл', extensions: [extForMime(meta.mime)] }],
    });
    if (res.canceled || !res.filePath) return false;
    try {
      await fsp.copyFile(src, res.filePath);
      return true;
    } catch (err) {
      console.warn('[ai-files] сохранение упало:', (err as Error).message);
      return false;
    }
  });
  ipcMain.handle(IPC.AI_TEXT_SAVE, async (e, name: string, text: string) => {
    const w = winOf(e);
    if (!w || typeof text !== 'string' || text === '') return false;
    // ⚠️ Имя собрано нами (язык фенса + номер), но ПРИЕЗЖАЕТ ИЗ RENDERER — значит проверяется
    // здесь, тем же санитайзером, что и имена загрузок. Не прошло — берём безобидное своё, а не
    // отказываем: человек нажал «сохранить», и молчание в ответ он прочтёт как поломку.
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : '.txt';
    const base = sanitizeFileNameBase(dot > 0 ? name.slice(0, dot) : name, ext) ?? 'Фрагмент';
    const res = await dialog.showSaveDialog(w, { title: 'Сохранить фрагмент', defaultPath: `${base}${ext}` });
    if (res.canceled || !res.filePath) return false;
    try {
      await fsp.writeFile(res.filePath, text, 'utf8');
      return true;
    } catch (err) {
      console.warn('[ai-files] сохранение фрагмента упало:', (err as Error).message);
      return false;
    }
  });
  // Пуш статуса в чром (секция настроек) — тот же источник, что слушает и AI-панель отдельно
  // (см. AiPanelManager.ts, заход D шаг 4), оба подписаны на один aiKeyStore.onKeyStatusChanged.
  aiKeyStore.onKeyStatusChanged((connected) => {
    broadcastToChrome(IPC.AI_KEY_STATUS_CHANGED, connected);
  });

  // Задел под web-grounding (SearXNG) — тот же контракт/паттерн, что у ключа Gemini выше.
  // Пока только чром (секция настроек); AI-панель подключится отдельно, когда там появится
  // сам тоггл — свой preload, своя видимость, заводить сейчас незачем.
  ipcMain.handle(IPC.SEARXNG_GET_STATUS,    () => searxngKeyStore.getStatus());
  ipcMain.handle(IPC.SEARXNG_SAVE_CONFIG,   (_e, config: { endpoint: string; token: string }) => searxngKeyStore.saveConfig(config));
  ipcMain.handle(IPC.SEARXNG_DELETE_CONFIG, () => searxngKeyStore.deleteConfig());
  searxngKeyStore.onStatusChanged((configured) => {
    broadcastToChrome(IPC.SEARXNG_STATUS_CHANGED, configured);
  });

  // Реестр AI-скиллов (см. shared/ipc.ts::Skill, electron/SkillsStore.ts) — CRUD-мост для Settings
  // (чром). id для add генерим здесь, а не в сторе (SkillsStore.add() ожидает готовый id на входе,
  // сам не создаёт) — тем же приёмом, что TabManager.createSpecialTab использует randomUUID().
  ipcMain.handle(IPC.SKILLS_LIST,   () => skillsStore.list());
  ipcMain.handle(IPC.SKILLS_ADD,    (_e, input: { label: string; prompt: string; icon?: string }) =>
    skillsStore.add({ id: randomUUID(), ...input }));
  ipcMain.handle(IPC.SKILLS_UPDATE, (_e, id: string, patch: { label?: string; prompt?: string; icon?: string; visible?: boolean }) =>
    skillsStore.update(id, patch));
  ipcMain.handle(IPC.SKILLS_REMOVE, (_e, id: string) => skillsStore.remove(id));
  // Пуш в чром (Settings) — НЕЗАВИСИМАЯ вторая подписка на тот же skillsStore.onSkillsChanged,
  // что уже слушает AI-панель (AiPanelManager.ts:267, свой ad-hoc ai-panel:skills-list) — Set
  // слушателей в SkillsStore поддерживает несколько подписчиков, тот пуш не трогаем/не дублируем.
  skillsStore.onSkillsChanged((skills) => {
    broadcastToChrome(IPC.SKILLS_CHANGED, skills);
  });

  // VPN, шаг 1 — подписка + список серверов. Ссылка и credential серверов остаются в main
  // (см. VpnKeyStore.ts) — тот же принцип, что у ключа Gemini чуть выше.
}
