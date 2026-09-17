// Реестр runtime split-пар — чистое состояние без Electron API. TabManager остаётся владельцем
// пользовательского сценария и WebContentsView, а коллекцию больше не правит из разных мест
// через push/filter/присваивание.
export interface SplitPair {
  leftId: string;
  rightId: string;
  activePanel: 'left' | 'right';
  splitRatio: number;
}

export interface SplitExitPlan {
  pair: SplitPair;
  shown: boolean;
  leftId: string;
  rightId: string;
  stayId: string;
  hideId: string;
}

export class SplitPairRegistry implements Iterable<SplitPair> {
  #pairs: SplitPair[] = [];

  containing(tabId: string): SplitPair | undefined {
    return this.#pairs.find((pair) => pair.leftId === tabId || pair.rightId === tabId);
  }

  active(activeId: string): SplitPair | undefined {
    return this.containing(activeId);
  }

  // План выхода не мутирует реестр: владелец сначала разворачивает узел дерева, затем удаляет
  // пару и только потом меняет видимость WebContentsView. Для припаркованной пары stay/hide
  // вычисляются так же, но визуальных действий вызывающий не делает.
  planExit(tabId: string, activeId: string, keepId?: string): SplitExitPlan | null {
    const pair = this.containing(tabId);
    if (!pair) return null;
    const { leftId, rightId, activePanel } = pair;
    const stayId = keepId ?? (activePanel === 'left' ? leftId : rightId);
    return {
      pair,
      shown: pair === this.active(activeId),
      leftId,
      rightId,
      stayId,
      hideId: stayId === leftId ? rightId : leftId,
    };
  }

  sideOf(tabId: string): 'left' | 'right' | null {
    const pair = this.containing(tabId);
    if (!pair) return null;
    return tabId === pair.leftId ? 'left' : 'right';
  }

  visibleTabIds(tabId: string): Set<string> {
    const pair = this.containing(tabId);
    return pair ? new Set([pair.leftId, pair.rightId]) : new Set([tabId]);
  }

  add(pair: SplitPair): void {
    this.#pairs.push(pair);
  }

  remove(pair: SplitPair): boolean {
    const index = this.#pairs.indexOf(pair);
    if (index === -1) return false;
    this.#pairs.splice(index, 1);
    return true;
  }

  replacePanel(pair: SplitPair, panelId: string, newId: string): 'left' | 'right' | null {
    if (!this.#pairs.includes(pair)) return null;
    if (panelId === pair.leftId) {
      pair.leftId = newId;
      return 'left';
    }
    if (panelId === pair.rightId) {
      pair.rightId = newId;
      return 'right';
    }
    return null;
  }

  setRatio(pair: SplitPair, ratio: number): boolean {
    if (!this.#pairs.includes(pair)) return false;
    pair.splitRatio = ratio;
    return true;
  }

  focus(pair: SplitPair, side: 'left' | 'right'): string | null {
    if (!this.#pairs.includes(pair)) return null;
    pair.activePanel = side;
    return side === 'left' ? pair.leftId : pair.rightId;
  }

  swap(pair: SplitPair): boolean {
    if (!this.#pairs.includes(pair)) return false;
    [pair.leftId, pair.rightId] = [pair.rightId, pair.leftId];
    pair.activePanel = pair.activePanel === 'left' ? 'right' : 'left';
    return true;
  }

  replace(pairs: readonly SplitPair[]): void {
    this.#pairs = [...pairs];
  }

  [Symbol.iterator](): Iterator<SplitPair> {
    return this.#pairs[Symbol.iterator]();
  }

  // Сохраняет прежний диагностический JSON в #debugCheckSplitInvariant.
  toJSON(): SplitPair[] {
    return [...this.#pairs];
  }
}
