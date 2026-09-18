// Проезд split-панели в свой слот. TabManager остаётся владельцем tabMap и поколений жеста:
// applySplitBounds не должен ставить едущую вью на место посреди движения. Здесь только таймер
// и кадры — без дерева, без session.json, без второго владельца вкладок.

import type { WebContentsView } from 'electron';
import { SPLIT_PANE_RADIUS, splitSlideEase, splitSlidePosition, type Rect } from '../shared/layout';

// Вынесено из умолчания параметра, потому что по этой же длительности гаснет выселенная
// панель при замене — она обязана дожить ровно до конца проезда, и разъедься эти два числа,
// в слоте мелькнула бы пустота.
export const PANEL_SLIDE_MS = 240;
const FRAME_MS = 1000 / 60;

export interface SplitSlideMove {
  tabId: string;
  view: WebContentsView;
  to: Rect;
  fromX: number;
  fromY?: number;
}

export function slideSplitViews(
  moves: SplitSlideMove[],
  slideGen: Map<string, number>,
  durMs = PANEL_SLIDE_MS,
): void {
  if (!moves.length) return;

  const gens = new Map<string, number>();
  const starts = new Map<string, { x: number; y: number }>();
  for (const m of moves) {
    // Новый жест может прийти до конца предыдущего проезда. В таком случае продолжаем с
    // фактического положения вьюхи, иначе она прыгает назад к исходному слоту.
    const moving = slideGen.has(m.tabId);
    const current = moving && !m.view.webContents.isDestroyed() ? m.view.getBounds() : null;
    const from = { x: current?.x ?? m.fromX, y: current?.y ?? m.fromY ?? m.to.y };
    starts.set(m.tabId, from);
    const gen = (slideGen.get(m.tabId) ?? 0) + 1;
    slideGen.set(m.tabId, gen);
    gens.set(m.tabId, gen);
    // Размер конечный сразу — формула кадра в splitSlidePosition, разбор там же.
    m.view.setBounds(splitSlidePosition(from.x, from.y, m.to, 0));
    m.view.setBorderRadius(SPLIT_PANE_RADIUS); // едут только панели сплита
  }

  const startedAt = performance.now();
  const step = (): void => {
    const frameStartedAt = performance.now();
    const ease = splitSlideEase(frameStartedAt - startedAt, durMs);
    let alive = false;
    for (const m of moves) {
      if (slideGen.get(m.tabId) !== gens.get(m.tabId)) continue; // жест перебит новым
      if (m.view.webContents.isDestroyed()) { slideGen.delete(m.tabId); continue; }
      const from = starts.get(m.tabId)!;
      m.view.setBounds(splitSlidePosition(from.x, from.y, m.to, ease));
      if (ease < 1) alive = true;
      else slideGen.delete(m.tabId);
    }
    // Учитываем время самого setBounds: фиксированная пауза ПОСЛЕ работы растягивала кадры.
    if (alive) setTimeout(step, Math.max(0, FRAME_MS - (performance.now() - frameStartedAt)));
  };
  setTimeout(step, FRAME_MS);
}
