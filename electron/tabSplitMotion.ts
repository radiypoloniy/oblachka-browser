// Проезд split-панели в свой слот. TabManager остаётся владельцем tabMap и поколений жеста:
// applySplitBounds не должен ставить едущую вью на место посреди движения. Здесь только таймер
// и кадры — без дерева, без session.json, без второго владельца вкладок.

import type { WebContentsView } from 'electron';
import { SPLIT_PANE_RADIUS, splitSlideEase, splitSlidePosition, type Rect } from '../shared/layout';

// Вынесено из умолчания параметра, потому что по этой же длительности гаснет выселенная
// панель при замене — она обязана дожить ровно до конца проезда, и разъедься эти два числа,
// в слоте мелькнула бы пустота.
export const PANEL_SLIDE_MS = 240;

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
  for (const m of moves) {
    const gen = (slideGen.get(m.tabId) ?? 0) + 1;
    slideGen.set(m.tabId, gen);
    gens.set(m.tabId, gen);
    // Размер конечный сразу — формула кадра в splitSlidePosition, разбор там же.
    m.view.setBounds(splitSlidePosition(m.fromX, m.fromY ?? m.to.y, m.to, 0));
    m.view.setBorderRadius(SPLIT_PANE_RADIUS); // едут только панели сплита
  }

  const startedAt = Date.now();
  const step = (): void => {
    const ease = splitSlideEase(Date.now() - startedAt, durMs);
    let alive = false;
    for (const m of moves) {
      if (slideGen.get(m.tabId) !== gens.get(m.tabId)) continue; // жест перебит новым
      if (m.view.webContents.isDestroyed()) { slideGen.delete(m.tabId); continue; }
      m.view.setBounds(splitSlidePosition(m.fromX, m.fromY ?? m.to.y, m.to, ease));
      if (ease < 1) alive = true;
      else slideGen.delete(m.tabId);
    }
    if (alive) setTimeout(step, 16);
  };
  setTimeout(step, 16);
}
