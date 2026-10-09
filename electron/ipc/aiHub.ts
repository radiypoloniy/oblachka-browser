// Чат хаба, ключ Gemini, SearXNG, пользовательские скиллы
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import * as ConnectionStore from '../ai/ConnectionStore';
import { registerPageInsightsIpc } from '../aipanel/PageInsights';
import { registerTabCompareIpc } from '../compare/TabCompare';
import * as KeyStore from '../ai/KeyStore';
import { connectionsState, probeConnection } from '../ai/connections';
import { discoverRunners, listModels } from '../ai/modelList';
import type { Connection } from '../../shared/aiProviders';
import type { AiRole } from '../../shared/aiRouting';
import { IPC } from '../../shared/ipc';
import * as aiKeyStore from '../AiKeyStore';
import * as searxngKeyStore from '../SearxngKeyStore';
import * as skillsStore from '../SkillsStore';
import * as contextStore from '../AiContextStore';
import { AI_CONTEXTS } from '../../shared/aiContexts';
import { broadcastToChrome } from '../WindowRegistry';
import { dialog, ipcMain } from 'electron';
import fsp from 'node:fs/promises';
import * as FileStore from '../ai/FileStore';
import * as UsageStore from '../ai/UsageStore';
import { extForMime } from '../../shared/aiAttachments';
import { sanitizeFileNameBase } from '../../shared/fileNameSafety';
import { randomUUID } from 'node:crypto';
import type { IpcDeps } from './deps';
import { registerHubChatIpc } from './hubChat';

export function registerAiHubIpc(d: IpcDeps): void {
  registerPageInsightsIpc();
  registerTabCompareIpc(d.settings);
  const { winOf } = d;

  registerHubChatIpc(d);

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
    // Ключ и счёт расхода уходят вместе с подключением: осиротевшая запись никому не нужна.
    KeyStore.deleteKey(id);
    UsageStore.forget(id);
    return ConnectionStore.remove(id);
  });
  ipcMain.handle(IPC.AI_CONN_TEST, (_e, conn: Connection, key: string | null) => probeConnection(conn, key));
  // ⚠️ Список моделей и проба раннеров живут в ai/modelList.ts, а не рядом с probeConnection:
  // это вопрос «что у тебя есть», который задаётся ещё до того, как подключение заведено.
  ipcMain.handle(IPC.AI_CONN_MODELS, (_e, conn: Connection, key: string | null) => listModels(conn, key));
  ipcMain.handle(IPC.AI_CONN_DISCOVER, () => discoverRunners());
  ipcMain.handle(IPC.AI_SET_ROUTE, (_e, role: AiRole, connectionId: string | null) =>
    ConnectionStore.setRoute(role, connectionId));

  // ── Вложения из ответа модели ────────────────────────────────────────────
  // ⚠️ id приезжает из renderer и превращается в ПУТЬ. Проверка формы — внутри FileStore, здесь
  // её не дублируем: два места, решающих, что такое годный id, разъедутся на первой же правке.
  ipcMain.handle(IPC.AI_USAGE, () => UsageStore.snapshot());
  ipcMain.handle(IPC.AI_USAGE_RESET, (_e, id?: string) => { UsageStore.reset(id); });

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

  // Наборы контекста AI-панели (shared/aiContexts.ts) — редактор в настройках. Панели узнают об
  // изменениях своей подпиской (aipanel/panelStatus.ts), беседы перестраивает chatOwnership.ts.
  ipcMain.handle(AI_CONTEXTS.list, () => contextStore.getState());
  ipcMain.handle(AI_CONTEXTS.save, (_e, input: unknown) => contextStore.save(input));
  ipcMain.handle(AI_CONTEXTS.remove, (_e, id: unknown) =>
    typeof id === 'string' ? contextStore.remove(id) : contextStore.getState());
  ipcMain.handle(AI_CONTEXTS.setDefault, (_e, id: unknown) => contextStore.setDefault(typeof id === 'string' ? id : null));
  contextStore.onChanged((state) => { broadcastToChrome(AI_CONTEXTS.changed, state); });

  // VPN, шаг 1 — подписка + список серверов. Ссылка и credential серверов остаются в main
  // (см. VpnKeyStore.ts) — тот же принцип, что у ключа Gemini чуть выше.
}
