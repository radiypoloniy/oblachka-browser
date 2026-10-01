import { ipcMain, webContents, type WebContents } from 'electron';
import { IPC } from '../../shared/ipc';
import { comparisonRows, relatedCompareProducts, type CompareProduct, type CompareState } from '../../shared/tabCompare';
import { allContexts, contextFromSender, contextForWindow, type WindowContext } from '../WindowRegistry';
import type { SettingsManager } from '../SettingsManager';
import { getActiveProfile } from '../ProfileStore';
import * as Connections from '../ai/ConnectionStore';
import { readCompareProduct } from './ComparePage';
import { alignComparison, comparisonModels } from './CompareEngine';
import { readExpandedCompareProduct, revealWbDetails } from './CompareWb';
import { closeCompareOffer, compareOfferHeight, compareOfferWindow, initCompareOfferDismissal, showCompareOffer } from './CompareOffer';

interface Work { state: CompareState; controller: AbortController | null; profile: string; comparingTab: string | null }
const work = new Map<number, Work>();
const cache = new Map<number, { url: string; at: number; product: CompareProduct | null }>();
let prefs: SettingsManager;
let scanning = false;
function forWindow(ctx: WindowContext): Work {
  const profile = getActiveProfile().id;
  const old = work.get(ctx.win.id);
  if (old?.profile === profile) return old;
  old?.controller?.abort();
  const value: Work = { profile, controller: null, comparingTab: null, state: { enabled: prefs.getTabCompareEnabled(), candidates: [],
    products: [], rows: [], phase: 'idle', note: '', connectionId: '', models: comparisonModels(), via: null } };
  work.set(ctx.win.id, value);
  if (!old) ctx.win.once('closed', () => { work.get(ctx.win.id)?.controller?.abort(); work.delete(ctx.win.id); });
  return value;
}
function senderContext(sender: WebContents): WindowContext | null {
  return contextFromSender(sender) ?? contextForWindow(compareOfferWindow(sender));
}
function publish(ctx: WindowContext, value: Work): void {
  if (ctx.win.isDestroyed() || work.get(ctx.win.id) !== value || value.profile !== getActiveProfile().id) return;
  value.state.enabled = prefs.getTabCompareEnabled(); value.state.models = comparisonModels();
  ctx.chromeView.webContents.send(IPC.COMPARE_CHANGED, value.state);
  // Поповер получает ту же копию состояния, а не ходит в ещё одну очередь извлечения.
  for (const wc of webContents.getAllWebContents()) if (compareOfferWindow(wc)?.id === ctx.win.id) wc.send(IPC.COMPARE_CHANGED, value.state);
}
export async function scanCompareCandidates(): Promise<void> {
  if (scanning || !prefs?.getTabCompareEnabled()) return;
  scanning = true;
  const alive = new Set<number>();
  try {
    for (const ctx of allContexts()) {
      if (ctx.win.isDestroyed() || !ctx.win.isVisible() || ctx.win.isMinimized()) continue;
      const job = forWindow(ctx), tabs = ctx.tabs.snapshot().filter(t => t.kind === 'page' && !t.incognito && !t.isSleeping && /^https?:/.test(t.url));
      const activeId = ctx.tabs.getActiveId();
      if (tabs.length < 2 || !tabs.some(t => t.id === activeId)) {
        if (job.state.candidates.length) { job.state.candidates = []; closeCompareOffer(ctx.win); publish(ctx, job); }
        continue;
      }
      const products: CompareProduct[] = [];
      const chosen = [...tabs].sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId)).slice(0, 20);
      for (const tab of chosen) {
        const wc = ctx.tabs.getWebContentsForTab(tab.id);
        if (!wc || wc.isDestroyed() || wc.isLoadingMainFrame()) continue;
        alive.add(wc.id);
        const hit = cache.get(wc.id), ttl = hit?.product ? 60_000 : 12_000;
        const reused = hit?.url === tab.url && Date.now() - hit.at < ttl;
        const product = reused ? hit.product : await readCompareProduct(wc, tab.id);
        if (ctx.win.isDestroyed() || getActiveProfile().id !== job.profile) break;
        if (!reused) cache.set(wc.id, { url: tab.url, at: Date.now(), product });
        if (product) products.push(product);
      }
      const active = products.find(p => p.tabId === activeId);
      const candidates = active ? relatedCompareProducts(active, products) : [];
      // Переход/закрытие могли произойти, пока отвечала страница: старое предложение не показываем.
      if (ctx.win.isDestroyed() || ctx.tabs.getActiveId() !== activeId) continue;
      const next = candidates.length >= 2 ? candidates : [];
      if (JSON.stringify(next) !== JSON.stringify(job.state.candidates)) { job.state.candidates = next; if (!next.length) closeCompareOffer(ctx.win); publish(ctx, job); }
    }
    for (const id of cache.keys()) if (!alive.has(id)) cache.delete(id);
  } finally { scanning = false; }
}
async function start(ctx: WindowContext, ids: unknown, model: unknown, refresh = false): Promise<void> {
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 5 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('Выберите от двух до пяти вкладок');
  if (typeof model !== 'string' || model.length > 200) throw new Error('Некорректное подключение');
  const visible = ctx.tabs.snapshot();
  const chosen = ids.map(id => visible.find(t => t.id === id));
  if (chosen.some(t => !t || t.incognito || t.kind !== 'page' || t.isSleeping || !/^https?:/.test(t.url))) throw new Error('Вкладка закрыта, спит или недоступна для сравнения');
  const job = forWindow(ctx); job.controller?.abort(); const controller = new AbortController(); job.controller = controller;
  closeCompareOffer(ctx.win);
  job.state = { ...job.state, phase: 'reading', note: 'Читаю открытые карточки товаров…', connectionId: model, via: null };
  if (!refresh) {
    job.state.products = []; job.state.rows = []; job.state.via = null;
    if (job.comparingTab && visible.some(t => t.id === job.comparingTab)) ctx.tabs.activate(job.comparingTab);
    else job.comparingTab = ctx.tabs.createSpecialTab('compare');
  }
  publish(ctx, job);
  const current = () => !controller.signal.aborted && !ctx.win.isDestroyed() && work.get(ctx.win.id) === job && job.profile === getActiveProfile().id;
  try {
    const products: CompareProduct[] = [];
    for (const tab of chosen) {
      if (!current() || !tab) return;
      const wc = ctx.tabs.getWebContentsForTab(tab.id), product = wc ? await readExpandedCompareProduct(wc, tab.id) : null;
      if (!product) throw new Error(`Не удалось прочитать «${tab.title}». Откройте карточку и её характеристики, затем повторите сравнение.`);
      products.push(product);
    }
    if (!current()) return;
    job.state.products = products; job.state.rows = comparisonRows(products);
    job.state.note = model ? 'Данные уже доступны. Модель сопоставляет названия характеристик…' : 'Данные из открытых страниц';
    publish(ctx, job);
    // Не более одного запроса на сравнение. Автоматическое предложение никогда не трогает модель.
    let timer: NodeJS.Timeout | undefined;
    try {
      job.state.rows = await Promise.race([alignComparison(products, model, controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Модель не успела ответить. Исходные данные сохранены.')); }, 120_000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
    if (!current()) return;
    job.state.phase = 'ready'; job.state.via = comparisonModels().find(c => c.id === model)?.label ?? null;
    job.state.note = 'Снимок выбранных вариантов. Цены и условия могли измениться — обновите перед покупкой.';
  } catch (e) {
    if (ctx.win.isDestroyed() || work.get(ctx.win.id) !== job || job.profile !== getActiveProfile().id || job.controller !== controller) return;
    job.state.phase = job.state.products.length ? 'ready' : 'error';
    job.state.note = e instanceof Error ? e.message : 'Не удалось собрать сравнение';
  } finally { if (job.controller === controller) { job.controller = null; publish(ctx, job); } }
}
export function registerTabCompareIpc(settings: SettingsManager): void {
  prefs = settings; initCompareOfferDismissal();
  Connections.onChanged(() => { for (const ctx of allContexts()) publish(ctx, forWindow(ctx)); });
  const timer = setInterval(() => { void scanCompareCandidates().catch(() => { /* Следующий проход повторит чтение. */ }); }, 6000); timer.unref();
  ipcMain.handle(IPC.COMPARE_STATE, e => { const ctx = senderContext(e.sender); if (!ctx) throw new Error('Окно недоступно'); const job = forWindow(ctx); job.state.models = comparisonModels(); return job.state; });
  ipcMain.handle(IPC.COMPARE_ENABLED, (_e, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('Некорректная настройка');
    prefs.setTabCompareEnabled(enabled);
    for (const ctx of allContexts()) { const job = forWindow(ctx); if (!enabled) { job.state.candidates = []; closeCompareOffer(ctx.win); } publish(ctx, job); }
    if (enabled) void scanCompareCandidates();
  });
  ipcMain.handle(IPC.COMPARE_OFFER_SHOW, async (e, anchor) => {
    const ctx = contextFromSender(e.sender);
    if (ctx && anchor?.automatic) {
      if (!ctx.win.isFocused() || ctx.win.isFullScreen()) return;
      const activeId = ctx.tabs.getActiveId(), active = ctx.tabs.getActiveWebContents();
      if (!forWindow(ctx).state.candidates.some(p => p.tabId === activeId)) return;
      if (ctx.win.contentView.children.some(v => 'webContents' in v && /^oblako-chrome:.*(?:popover|prompt|suggestdropdown)/.test((v as Electron.WebContentsView).webContents.getURL()) && !/compareoffer/.test((v as Electron.WebContentsView).webContents.getURL()))) return;
      let timer: NodeJS.Timeout | undefined;
      const editing = active ? await Promise.race([
        active.executeJavaScriptInIsolatedWorld(1005, [{ code: `!!document.activeElement?.matches('input,textarea,[contenteditable="true"]')` }]).catch(() => true),
        new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), 500); }),
      ]).finally(() => { if (timer) clearTimeout(timer); }) : true;
      if (editing || ctx.win.isDestroyed() || ctx.tabs.getActiveId() !== activeId) return;
    }
    if (ctx && prefs.getTabCompareEnabled() && forWindow(ctx).state.candidates.length >= 2 && anchor
      && ['x', 'y', 'width', 'height'].every(k => typeof anchor[k] === 'number' && Number.isFinite(anchor[k])) && anchor.width > 0 && anchor.height > 0) showCompareOffer(ctx.win, anchor);
  });
  ipcMain.handle(IPC.COMPARE_OFFER_CLOSE, e => { const ctx = senderContext(e.sender); if (ctx) closeCompareOffer(ctx.win); });
  ipcMain.on(IPC.COMPARE_OFFER_HEIGHT, (e, height: number) => compareOfferHeight(e.sender, height));
  ipcMain.handle(IPC.COMPARE_START, (e, ids: unknown, model: unknown) => {
    const ctx = senderContext(e.sender); if (!ctx) throw new Error('Окно недоступно');
    return start(ctx, ids, model);
  });
  ipcMain.handle(IPC.COMPARE_REFRESH, e => { const ctx = senderContext(e.sender); if (!ctx) return; const job = forWindow(ctx); return start(ctx, job.state.products.map(p => p.tabId), job.state.connectionId, true); });
  ipcMain.handle(IPC.COMPARE_SOURCE, async (e, id: string, factId: number) => {
    const ctx = senderContext(e.sender); if (!ctx) return false;
    const product = forWindow(ctx).state.products.find(p => p.tabId === id), fact = product?.facts.find(f => f.id === factId);
    const tab = ctx.tabs.snapshot().find(t => t.id === id);
    if (!fact || !product || !tab || tab.url !== product.url) return false;
    ctx.tabs.activate(id);
    const wc = ctx.tabs.getWebContentsForTab(id);
    if (wc) { await revealWbDetails(wc); if (!wc.isDestroyed()) wc.findInPage(fact.value, { forward: true }); }
    return true;
  });
}
