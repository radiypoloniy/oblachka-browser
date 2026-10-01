import { app, ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { createHash } from 'node:crypto';
import { INSIGHTS, INSIGHTS_COOLDOWN, type InsightsState, type PageInsight } from '../../shared/pageInsights';
import { LOCAL_CONNECTION_ID, capsFor } from '../../shared/aiProviders';
import { panelBySender, panelViews, tabsOf } from './instances';
import { connectionsState } from '../ai/connections';
import * as Models from '../ModelRegistry';
import { broadcastToChrome } from '../WindowRegistry';
import { insightsConfig, setInsightsConfig, reserveInsightRequest } from './InsightsStore';
import { eligibleInsightPage, insightPageText, revealInsight } from './InsightsPage';
import { generateInsights, insightModelWarm } from './InsightsGeneration';
import { sendCurrentContext } from './tabChat';
import { prepareActiveInsights, preparedInsights, clearPreparedInsights } from './InsightsPreparation';

interface Watcher {
  sender: WebContents;
  state: InsightsState;
  pageKey: string;
  hash: string;
  stableAt: number;
  waitingAt: number;
  text: string;
  version: string;
  abort: AbortController | null;
  published: string;
}
const watchers = new Map<number, Watcher>();
const cache = new Map<string, { cards: PageInsight[]; via: InsightsState['via'] }>();
const attempts = new Map<string, number>();
let timer: NodeJS.Timeout | null = null;
let ticking = false;
let registered = false;
const emptyState = (): InsightsState => ({ tabId: null, phase: 'idle', cards: [], via: null, note: '' });
function publish(w: Watcher): void {
  if (w.sender.isDestroyed()) return;
  const serialized = JSON.stringify(w.state);
  if (serialized === w.published) return;
  w.published = serialized; w.sender.send(INSIGHTS.state, w.state);
}
function stop(w: Watcher): void { w.abort?.abort(); w.abort = null; }
export function pausePageInsights(windowId: number): void {
  for (const w of watchers.values()) if (panelBySender(w.sender)?.win.id === windowId) stop(w);
}
function trim<T>(map: Map<string, T>, max: number): void {
  while (map.size > max) { const key = map.keys().next().value; if (key !== undefined) map.delete(key); }
}
function phase(w: Watcher, value: InsightsState['phase'], note: string): void {
  w.state.phase = value; w.state.note = note; publish(w);
}
function route() {
  const config = insightsConfig(), id = config.connectionId ?? LOCAL_CONNECTION_ID;
  if (id === LOCAL_CONNECTION_ID) return { id, local: true, label: Models.getDefault()?.label ?? 'Локальная модель', available: Models.getDefault() !== null };
  const state = connectionsState(), connection = state.connections.find(c => c.id === id);
  // Исчезнувшее подключение не откатывается на другую модель и не будит локальную.
  return { id, local: connection ? capsFor(connection).local : false,
    label: connection?.label ?? 'Подключение недоступно', available: !!connection && state.ready.includes(id) };
}
async function inspect(w: Watcher, explicit = false): Promise<void> {
  const panel = panelBySender(w.sender), config = insightsConfig();
  if (!panel?.open || panel.kind !== 'full' || panel.win.isMinimized() || !panel.win.isVisible()) { stop(w); return; }
  if (!config.enabled) { stop(w); phase(w, 'off', 'Автоподсказки выключены'); return; }
  const tm = tabsOf(panel.win), tab = tm?.snapshot().find(t => t.isActive);
  const wc = tab ? tm?.getActiveWebContents(tab.id) : null;
  const pageKey = `${app.getPath('userData')}:${tab?.id}:${tab?.url}`;
  if (pageKey !== w.pageKey) {
    stop(w); w.pageKey = pageKey; w.hash = ''; w.stableAt = Date.now(); w.waitingAt = Date.now();
    w.state = { ...emptyState(), tabId: tab?.id ?? null }; publish(w);
  }
  if (!tab || !wc || wc.isDestroyed() || !eligibleInsightPage(tab.url)) { phase(w, 'idle', 'На этой странице нет материала для карточек'); return; }
  if (wc.isLoadingMainFrame()) { stop(w); phase(w, w.state.cards.length ? 'stale' : 'idle', 'Страница загружается'); return; }
  const target = route();
  w.state.via = { label: target.label, local: target.local };
  if (!target.available) { phase(w, 'setup', 'Подключите модель для подсказок по странице'); return; }
  if (!target.local && !config.allowRemote) { phase(w, 'setup', 'Разрешите фоновые запросы выбранному подключению'); return; }
  const version = target.id === LOCAL_CONNECTION_ID ? Models.getDefault()?.id :
    JSON.stringify(connectionsState().connections.find(c => c.id === target.id));
  const text = await insightPageText(wc);
  const prepared = preparedInsights(panel.win.id, tab.id, tab.url);
  const matching = prepared?.text === text && prepared.title === tab.title ? prepared : null;
  const freshConfig = insightsConfig();
  if (w.pageKey !== pageKey || !panel.open || w.sender.isDestroyed() || watchers.get(w.sender.id) !== w ||
      !freshConfig.enabled || freshConfig.connectionId !== config.connectionId || freshConfig.allowRemote !== config.allowRemote) return;
  if (text.length < 600) { stop(w); w.state.cards = []; phase(w, 'idle', 'Здесь недостаточно текста для полезных карточек'); return; }
  const hash = w.text === text && w.version === String(version) && w.hash ? w.hash :
    createHash('sha256').update(text).update(String(version)).digest('hex');
  w.text = text; w.version = String(version);
  if (w.hash !== hash) {
    w.hash = hash; w.stableAt = matching?.stableAt ?? Date.now();
    if (!w.waitingAt || !w.text) w.waitingAt = matching?.waitingAt ?? Date.now();
    if (matching) w.waitingAt = matching.waitingAt;
    if (!w.abort) phase(w, w.state.cards.length ? 'stale' : 'idle', 'Подготавливаю текст страницы');
  }
  if (w.abort) return;
  const cacheKey = `${app.getPath('userData')}:${tab.url}:${target.id}:${hash}`;
  const hit = cache.get(cacheKey);
  if (hit && !explicit) { w.state.cards = hit.cards; w.state.via = hit.via; phase(w, 'ready', hit.cards.length ? 'По текущей версии страницы' : 'В ответе модели нет карточек. Можно повторить разбор'); return; }
  if (w.abort || (!explicit && (Date.now() - w.stableAt < 4000 && Date.now() - w.waitingAt < 10000))) return;
  if (!explicit && target.local && (target.id !== LOCAL_CONNECTION_ID || !insightModelWarm())) {
    phase(w, 'sleep', target.id === LOCAL_CONNECTION_ID ? 'Модель отдыхает. Автоподсказки её не загружают' :
      'Для локального API запустите разбор вручную — браузер не загружает модель в фоне'); return;
  }
  const attemptKey = `${pageKey}:${target.id}`;
  if (!explicit && Date.now() - (attempts.get(attemptKey) ?? 0) < INSIGHTS_COOLDOWN) {
    if (w.state.phase !== 'error') phase(w, w.state.cards.length ? 'stale' : 'idle', 'Следующий автоматический разбор — после паузы'); return;
  }
  // Одна задача на всё приложение: несколько окон не устраивают параллельный фоновый инференс.
  if ([...watchers.values()].some(other => other.abort !== null)) return;
  if (!target.local && !reserveInsightRequest()) { phase(w, 'limit', 'Дневной предел облачных разборов достигнут'); return; }
  attempts.set(attemptKey, Date.now()); trim(attempts, 200);
  const abort = new AbortController(); w.abort = abort;
  phase(w, 'reading', 'Выделяю главное на странице');
  void generateInsights(text, tab.title, target.id, explicit, abort.signal, matching?.material).then(async cards => {
    if (abort.signal.aborted || w.pageKey !== pageKey || wc.isDestroyed()) return;
    // Ответ может прийти между тиками проверки DOM. Перед публикацией сверяем источник ещё раз.
    const fresh = await insightPageText(wc);
    if (abort.signal.aborted || w.pageKey !== pageKey || !insightsConfig().enabled) return;
    cache.set(cacheKey, { cards, via: w.state.via }); trim(cache, 40);
    w.state.cards = cards; w.waitingAt = 0;
    phase(w, fresh !== text ? 'stale' : 'ready', fresh !== text ? 'Материал изменился во время разбора. Можно обновить карточки' :
      cards.length ? 'По текущей версии страницы' : 'В ответе модели нет карточек. Можно повторить разбор');
  }).catch(error => {
    if (!abort.signal.aborted) console.warn('[page-insights] Разбор не выполнен:', error instanceof Error ? error.message : 'ошибка подключения');
    if (!abort.signal.aborted && w.pageKey === pageKey) phase(w, 'error',
      error instanceof Error && error.message === 'Модель вернула пустой обзор' ?
        'Модель вернула пустой обзор вместо главного тезиса. Попробуйте другую модель или повторите разбор' :
        'Не удалось разобрать страницу. Можно повторить вручную');
  }).finally(() => { if (w.abort === abort) w.abort = null; });
}
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await prepareActiveInsights().catch(() => {});
    await Promise.all([...watchers.values()].map(w => inspect(w).catch(() => phase(w, 'error', 'Страница пока недоступна для разбора'))));
  }
  finally { ticking = false; }
}
function schedule(): void {
  if (insightsConfig().enabled && !timer) { timer = setInterval(() => { void tick(); }, 2500); timer.unref(); }
  if (!insightsConfig().enabled && timer) { clearInterval(timer); timer = null; clearPreparedInsights(); }
}
export function registerPageInsightsIpc(): void {
  if (registered) return; registered = true;
  schedule();
  ipcMain.handle(INSIGHTS.config, () => insightsConfig());
  ipcMain.handle(INSIGHTS.set, (_e, patch: unknown) => {
    const before = insightsConfig();
    const config = setInsightsConfig(patch);
    if (before.enabled !== config.enabled || before.connectionId !== config.connectionId || before.allowRemote !== config.allowRemote) {
      for (const w of watchers.values()) { stop(w); w.hash = ''; }
    }
    broadcastToChrome(INSIGHTS.changed, config);
    for (const view of panelViews()) view.webContents.send(INSIGHTS.changed, config);
    schedule();
    void tick(); return config;
  });
  ipcMain.on(INSIGHTS.watch, (e, visible: boolean) => {
    if (!panelBySender(e.sender)) return;
    // React подписался на контекст: ранний did-finish-load мог обогнать его эффекты.
    if (visible) sendCurrentContext();
    const existing = watchers.get(e.sender.id);
    if (!visible) { if (existing) stop(existing); watchers.delete(e.sender.id); }
    else if (!existing) {
      watchers.set(e.sender.id, { sender: e.sender, state: emptyState(), pageKey: '', hash: '', stableAt: 0, waitingAt: 0, text: '', version: '', abort: null, published: '' });
      e.sender.once('destroyed', () => { const w = watchers.get(e.sender.id); if (w) stop(w); watchers.delete(e.sender.id); });
    }
    schedule();
    void tick();
  });
  ipcMain.on(INSIGHTS.run, e => { const w = watchers.get(e.sender.id); if (w) void inspect(w, true).catch(() => phase(w, 'error', 'Не удалось начать разбор')); });
  ipcMain.on(INSIGHTS.source, (e, index: unknown) => {
    const w = watchers.get(e.sender.id), panel = panelBySender(e.sender);
    if (!w || !panel || w.state.phase !== 'ready' || typeof index !== 'number' || !Number.isInteger(index)) return;
    const tab = tabsOf(panel.win)?.snapshot().find(t => t.isActive);
    if (tab?.id !== w.state.tabId || w.pageKey !== `${app.getPath('userData')}:${tab?.id}:${tab?.url}`) return;
    const card = w.state.cards[index], wc = tab ? tabsOf(panel.win)?.getActiveWebContents(tab.id) : null;
    if (card && wc) void revealInsight(wc, card.quote).catch(() => {});
  });
  for (const channel of ['ai-panel:chat-send', 'ai-panel:quick-translate', 'ai-panel:fact-check']) {
    ipcMain.on(channel, e => { const w = watchers.get(e.sender.id); if (w) stop(w); });
  }
}
