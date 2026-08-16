// Граф-воркспейс и узлы-веб-приложения
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import type { GraphStructure } from '../../shared/graph';
import type { ImagePreset } from '../../shared/imagePresets';
import { IPC } from '../../shared/ipc';
import type { ContentBounds } from '../../shared/ipc';
import { SUPPORTED_FILE_EXTENSIONS } from '../FileExtract';
import { sendChatMessage } from '../GraphChat';
import { cancelGraphRun, composeWebAppPrompt, computeNodeInputHash, runGraph } from '../GraphEngine';
import { captureAnswer, captureImage, closeGraphWebApp, insertPrompt, raiseGraphWebApp, setGraphWebAppBounds, showGraphWebApp } from '../GraphWebAppManager';
import { dialog, ipcMain, nativeImage } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { IpcDeps } from './deps';

export function registerGraphIpc(d: IpcDeps): void {
  const { chromeOf, graphs, maybeLazyWarmupOnDemand, sendTo, winOf } = d;

  // Граф-воркспейс. Структуру пишет renderer (GRAPH_SAVE), результаты узлов — только движок
  // (см. шапку GraphStore.ts). GRAPH_RUN — send, а не handle: прогон длинный, ход идёт
  // отдельными событиями GRAPH_PROGRESS, ждать его одним ответом нечем.
  ipcMain.handle(IPC.GRAPH_LIST, () => graphs.list());
  ipcMain.handle(IPC.GRAPH_CREATE, (_e, title: string) =>
    graphs.create(typeof title === 'string' ? title : ''));
  ipcMain.handle(IPC.GRAPH_GET, (_e, graphId: number) => graphs.get(graphId));
  ipcMain.handle(IPC.GRAPH_SAVE, (_e, graphId: number, structure: GraphStructure) => {
    graphs.saveStructure(graphId, structure);
  });
  ipcMain.handle(IPC.GRAPH_RENAME, (_e, graphId: number, title: string) => {
    graphs.rename(graphId, typeof title === 'string' ? title : '');
  });
  ipcMain.handle(IPC.GRAPH_DELETE, (_e, graphId: number) => graphs.remove(graphId));
  ipcMain.handle(IPC.GRAPH_CANCEL, (_e, graphId: number) => cancelGraphRun(graphId));
  ipcMain.handle(IPC.GRAPH_PRESETS_LIST, () => graphs.listImagePresets());
  ipcMain.handle(IPC.GRAPH_PRESET_SAVE, (_e, preset: ImagePreset) => graphs.saveImagePreset(preset));
  ipcMain.handle(IPC.GRAPH_PRESET_DELETE, (_e, id: string) => graphs.deleteImagePreset(id));
  ipcMain.handle(IPC.GRAPH_SAVE_OUTPUT, async (e, suggestedName: string, text: string) => {
    const w = winOf(e);
    if (!w || typeof text !== 'string' || !text) return false;
    // Имя чистим от того, что Windows не пустит в путь: заголовок узла пишет человек,
    // и двоеточие в «Поиск: чайники» иначе сорвало бы сохранение.
    const safe = (suggestedName || 'результат').replace(/[\/:*?"<>|]/g, ' ').trim().slice(0, 80);
    const res = await dialog.showSaveDialog(w, {
      title: 'Сохранить результат',
      defaultPath: `${safe || 'результат'}.md`,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Текст', extensions: ['txt'] },
      ],
    });
    if (res.canceled || !res.filePath) return false;
    try {
      await fsp.writeFile(res.filePath, text, 'utf8');
      return true;
    } catch (e) {
      console.warn('[Graph] сохранение результата упало:', (e as Error).message);
      return false;
    }
  });
  ipcMain.handle(IPC.GRAPH_CHAT_LIST, (_e, graphId: number, nodeId: string) =>
    graphs.listChatMessages(graphId, nodeId));
  ipcMain.handle(IPC.GRAPH_CHAT_CLEAR, (_e, graphId: number, nodeId: string) => {
    graphs.clearChat(graphId, nodeId);
  });
  ipcMain.on(IPC.GRAPH_CHAT_SEND, (e, graphId: number, nodeId: string, text: string) => {
    // Диалог с моделью — явное намерение поработать с AI, значит её пора греть.
    maybeLazyWarmupOnDemand();
    const target = chromeOf(e); // холст того окна, где ведут диалог, — см. chromeOf выше
    void sendChatMessage(graphs, graphId, nodeId, typeof text === 'string' ? text : '', {
      chunk: (chunk) => sendTo(target, IPC.GRAPH_CHAT_CHUNK, { graphId, nodeId, text: chunk }),
      done: (outcome) => {
        sendTo(target, IPC.GRAPH_CHAT_DONE, { graphId, nodeId, ...outcome });
        // Ответ стал выходом узла — холст должен увидеть это как обычный результат.
        if (outcome.ok) {
          sendTo(target, IPC.GRAPH_PROGRESS, {
            graphId, nodeId, status: 'done', output: outcome.text,
          });
        }
      },
    });
  });
  ipcMain.handle(IPC.GRAPH_NODE_HISTORY, (_e, graphId: number, nodeId: string) =>
    graphs.listNodeHistory(graphId, nodeId));
  ipcMain.handle(IPC.GRAPH_PICK_FILE, async (e) => {
    const w = winOf(e);
    if (!w) return null;
    const res = await dialog.showOpenDialog(w, {
      title: 'Документ для узла графа',
      properties: ['openFile'],
      filters: [
        { name: 'Документы', extensions: SUPPORTED_FILE_EXTENSIONS },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
  });
  ipcMain.handle(IPC.GRAPH_PICK_IMAGE, async (e) => {
    const w = winOf(e);
    if (!w) return null;
    const res = await dialog.showOpenDialog(w, {
      title: 'Картинка для узла графа',
      properties: ['openFile'],
      filters: [
        { name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif'] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
  });
  // Превью картинки узла. Файл читает main: у renderer нет доступа к file://, а тащить в
  // карточку полноразмерный кадр с генератора незачем — data-URL раздулся бы на десятки МБ.
  ipcMain.handle(IPC.GRAPH_IMAGE_PREVIEW, async (_e, filePath: string) => {
    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile() || stat.size > 40 * 1024 * 1024) return null;
      const img = nativeImage.createFromPath(filePath);
      if (!img.isEmpty()) {
        const { width } = img.getSize();
        // 1280 хватает и карточке, и раскрытому виду — двух размеров не заводим.
        return (width > 1280 ? img.resize({ width: 1280 }) : img).toDataURL();
      }
      // nativeImage декодирует не всё (svg, часть webp/avif). Такие отдаём как есть —
      // <img> в renderer их понимает сам.
      const ext = path.extname(filePath).slice(1).toLowerCase();
      if (stat.size > 8 * 1024 * 1024) return null;
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext || 'png'}`;
      return `data:${mime};base64,${(await fsp.readFile(filePath)).toString('base64')}`;
    } catch {
      return null;   // файла нет или он не читается — карточка покажет это сама
    }
  });
  // Electron принимает только целые пиксели, а renderer меряет getBoundingClientRect()
  // и присылает дробные — та же нормализация, что в TabManager.setContentBounds.
  const toRect = (b: ContentBounds) => ({
    x: Math.round(b.x), y: Math.round(b.y),
    width: Math.max(0, Math.round(b.width)),
    height: Math.max(0, Math.round(b.height)),
  });

  // Узел-веб-приложение. Промпт собирает main из СОХРАНЁННОГО графа, а не renderer:
  // так «что вставили» и «по каким входам посчитан отпечаток» — один и тот же источник.
  ipcMain.handle(IPC.GRAPH_WEBAPP_SHOW, (e, graphId: number, nodeId: string, url: string, b: ContentBounds) => {
    const w = winOf(e);
    if (w) showGraphWebApp(w, graphId, nodeId, url, toRect(b));
  });
  ipcMain.handle(IPC.GRAPH_WEBAPP_BOUNDS, (e, graphId: number, nodeId: string, b: ContentBounds) => {
    const w = winOf(e);
    if (w) setGraphWebAppBounds(w, graphId, nodeId, toRect(b));
  });
  ipcMain.handle(IPC.GRAPH_WEBAPP_RAISE, (e, graphId: number, nodeId: string) => {
    const w = winOf(e);
    if (w) raiseGraphWebApp(w, graphId, nodeId);
  });
  ipcMain.handle(IPC.GRAPH_WEBAPP_CLOSE, (e, graphId: number, nodeId: string) => {
    const w = winOf(e);
    if (w) closeGraphWebApp(w, graphId, nodeId);
  });
  ipcMain.handle(IPC.GRAPH_WEBAPP_INSERT, (_e, graphId: number, nodeId: string) => {
    const doc = graphs.get(graphId);
    if (!doc) return false;
    return insertPrompt(graphId, nodeId, composeWebAppPrompt(doc, nodeId));
  });
  ipcMain.handle(IPC.GRAPH_WEBAPP_CAPTURE_IMAGE, (_e, graphId: number, nodeId: string) =>
    captureImage(graphId, nodeId));
  ipcMain.handle(IPC.GRAPH_WEBAPP_CAPTURE, async (e, graphId: number, nodeId: string, mode: 'selection' | 'last') => {
    const text = await captureAnswer(graphId, nodeId, mode === 'last' ? 'last' : 'selection');
    if (!text) return '';
    // Результат пишет main, а не renderer: инвариант «результаты узлов принадлежат движку»
    // (см. шапку GraphStore.ts) держится и здесь, просто источник ответа — человек.
    // Отпечаток берём тот же, что посчитал бы движок, — тогда ответ живёт ровно до правки
    // входов узла и не считается устаревшим на пустом месте.
    const doc = graphs.get(graphId);
    if (!doc) return '';
    graphs.setNodeResult(graphId, nodeId, {
      inputHash: computeNodeInputHash(doc, nodeId),
      output: text,
      outputTitle: null,
      error: null,
    });
    sendTo(chromeOf(e), IPC.GRAPH_PROGRESS, {
      graphId, nodeId, status: 'done', output: text,
    });
    return text;
  });

  ipcMain.on(IPC.GRAPH_RUN, (e, graphId: number, nodeId: string | null) => {
    const w = winOf(e);
    // Прогон графа — явное намерение поработать с AI, значит модель пора греть (тот же
    // приём, что у AI_PANEL_TOGGLE и SETTINGS_*_HUB_MODE).
    maybeLazyWarmupOnDemand();
    const target = chromeOf(e);
    void runGraph(w, graphs, graphId, typeof nodeId === 'string' ? nodeId : null, (p) => {
      sendTo(target, IPC.GRAPH_PROGRESS, p);
    });
  });

  // Автозаполнение — адреса и карты (electron/AutofillManager.ts). Полный номер карты (reveal) —
  // под тем же OS-подтверждением, что показ пароля (ensurePasswordAuth); list/add/update номер
  // наружу не отдают.
}
