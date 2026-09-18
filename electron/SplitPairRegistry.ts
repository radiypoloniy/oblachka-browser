// Реестр runtime split-пар — чистое состояние без Electron API. TabManager остаётся владельцем
// пользовательского сценария и WebContentsView, а коллекцию больше не правит из разных мест
// через push/filter/присваивание.
export interface SplitPair {
  leftId: string;
  rightId: string;
  activePanel: 'left' | 'right';
  splitRatio: number;
  leftStack: string[];
  rightStack: string[];
  leftGroupId: string | null;
  rightGroupId: string | null;
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
    if (panelId !== pair.leftId && panelId !== pair.rightId) return null;
    this.forget(newId);
    if (panelId === pair.leftId) {
      pair.leftStack = [panelId, ...pair.leftStack.filter((id) => id !== panelId)];
      pair.leftId = newId;
      return 'left';
    }
    if (panelId === pair.rightId) {
      pair.rightStack = [panelId, ...pair.rightStack.filter((id) => id !== panelId)];
      pair.rightId = newId;
      return 'right';
    }
    return null;
  }

  forget(tabId: string): void {
    for (const pair of this.#pairs) {
      pair.leftStack = pair.leftStack.filter((id) => id !== tabId);
      pair.rightStack = pair.rightStack.filter((id) => id !== tabId);
    }
  }

  // Положить вкладку ПОД текущую страницу половины, не меняя то, что на экране.
  // ⚠️ Это не replacePanel: вытеснять черновик ради ссылки как раз то, чего жест «открыть
  // отдельно» из пары делать не должен. Потолок 100 — как у leftStackKeys в сейве.
  pushUnder(pair: SplitPair, side: 'left' | 'right', tabId: string): boolean {
    if (!this.#pairs.includes(pair)) return false;
    if (tabId === pair.leftId || tabId === pair.rightId) return false;
    this.forget(tabId);
    const stack = side === 'left' ? pair.leftStack : pair.rightStack;
    stack.unshift(tabId);
    if (stack.length > 100) stack.length = 100;
    return true;
  }

  underCount(tabId: string): number {
    const pair = this.containing(tabId);
    if (!pair) return 0;
    if (tabId === pair.leftId) return pair.leftStack.length;
    if (tabId === pair.rightId) return pair.rightStack.length;
    return 0;
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
    [pair.leftStack, pair.rightStack] = [pair.rightStack, pair.leftStack];
    [pair.leftGroupId, pair.rightGroupId] = [pair.rightGroupId, pair.leftGroupId];
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
