import { app, webContents, WebContentsView, type BrowserWindow, type WebContents } from 'electron';
import path from 'node:path';
import type { ContentBounds } from '../../shared/ipc';
import { OVERLAY_GAP, OVERLAY_SHADOW_MARGIN } from '../../shared/overlayMetrics';
import { closeWindowView } from '../viewTeardown';
import { restackUpdatePrompt } from '../UpdatePromptManager';
import { restackPermissionPopover } from '../PermissionPopoverManager';

const WIDTH = 340;
interface Offer { win: BrowserWindow; view: WebContentsView; anchor: ContentBounds; height: number; open: boolean }
const offers = new Map<number, Offer>();
export function compareOfferWindow(sender: WebContents): BrowserWindow | null {
  for (const s of offers.values()) if (s.view.webContents === sender) return s.win;
  return null;
}
function layout(s: Offer): void {
  if (s.win.isDestroyed()) return;
  const bounds = s.win.getContentBounds(), margin = OVERLAY_SHADOW_MARGIN;
  const x = Math.max(margin, Math.min(s.anchor.x + s.anchor.width - WIDTH, bounds.width - WIDTH - margin));
  const y = Math.max(margin, Math.min(s.anchor.y + s.anchor.height + OVERLAY_GAP, bounds.height - s.height - margin));
  s.view.setBounds({ x: Math.round(x - margin), y: Math.round(y - margin), width: WIDTH + margin * 2, height: s.height + margin * 2 });
}
export function closeCompareOffer(win: BrowserWindow): void {
  const s = offers.get(win.id);
  if (!s?.open || win.isDestroyed()) return;
  s.open = false;
  try { win.contentView.removeChildView(s.view); } catch { /* Окно уже закрывает дочерние слои. */ }
}
export function showCompareOffer(win: BrowserWindow, anchor: ContentBounds): void {
  let s = offers.get(win.id);
  if (!s) {
    const view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, '../preload-compareoffer.js'), sandbox: false, contextIsolation: true } });
    view.setBackgroundColor('#00000000');
    s = { win, view, anchor, height: 420, open: false }; offers.set(win.id, s);
    win.once('closed', () => { closeWindowView(view); offers.delete(win.id); });
    win.on('resize', () => { const state = offers.get(win.id); if (state?.open) layout(state); });
    void view.webContents.loadURL('oblako-chrome://localhost/compareoffer.html').catch(() => closeCompareOffer(win));
  }
  s.anchor = anchor; s.open = true; layout(s); win.contentView.addChildView(s.view);
  restackUpdatePrompt(win); restackPermissionPopover(win);
}
export function compareOfferHeight(sender: WebContents, height: number): void {
  if (!Number.isFinite(height) || height < 80 || height > 800) return;
  for (const s of offers.values()) if (s.view.webContents === sender) { s.height = Math.ceil(height); if (s.open) layout(s); }
}
export function initCompareOfferDismissal(): void {
  const watch = (wc: WebContents) => {
    const dismiss = () => {
      for (const s of offers.values()) if (s.open && s.view.webContents !== wc && !s.win.isDestroyed()
        && s.win.contentView.children.some(v => v instanceof WebContentsView && v.webContents === wc)) closeCompareOffer(s.win);
    };
    wc.on('input-event', (_e, input) => { if (input.type === 'mouseDown') dismiss(); });
    wc.on('before-input-event', (_e, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { const win = compareOfferWindow(wc); if (win) closeCompareOffer(win); else dismiss(); } });
  };
  for (const wc of webContents.getAllWebContents()) watch(wc);
  app.on('web-contents-created', (_e, wc) => watch(wc));
}
