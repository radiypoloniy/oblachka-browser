import type { SplitPair, SplitPairRegistry } from './SplitPairRegistry';
import { splitOtherPaneId, splitParkSide } from '../shared/splitPark';

// Жест «открыть отдельно» из показанной пары. Вынесен из TabManager: тот уже на храповике
// структуры, а решение замкнутое — не знает про дерево и вью.

export interface SplitParkHost {
  activePair(): SplitPair | undefined;
  tab(id: string): { ephemeral?: boolean; incognito?: boolean } | undefined;
  isPinned(id: string): boolean;
  pairContaining(id: string): SplitPair | undefined;
  splitPairs: SplitPairRegistry;
  replacePanel(panelId: string, newId: string): void;
  onChange(): void;
}

export function parkOpenedInOtherStack(host: SplitParkHost, openerId: string, openedId: string): void {
  const pair = host.activePair();
  const opened = host.tab(openedId);
  const opener = host.tab(openerId);
  const side = splitParkSide({
    shownLeftId: pair?.leftId ?? null,
    shownRightId: pair?.rightId ?? null,
    openerId,
    openedId,
    openedEphemeral: !!opened?.ephemeral,
    openedPinned: host.isPinned(openedId),
    sameProfile: !!opened && !!opener && !!opened.incognito === !!opener.incognito,
    openedIsPanel: !!host.pairContaining(openedId),
  });
  if (!pair || !side || !opened) return;
  host.splitPairs.pushUnder(pair, side, openedId);
  host.onChange();
}

// ПКМ «в другой половине»: страница появляется на соседней панели, прежняя уходит в её стопку.
export function showOpenedOnOtherPane(host: SplitParkHost, openerId: string, openedId: string): void {
  const pair = host.activePair();
  if (!pair || !openedId || openedId === 'hub') return;
  const otherId = splitOtherPaneId(pair.leftId, pair.rightId, openerId);
  if (!otherId || otherId === openedId) return;
  host.replacePanel(otherId, openedId);
}
