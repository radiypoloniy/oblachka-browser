// Реестр runtime split-пар — чистое состояние без Electron API. TabManager остаётся владельцем
// пользовательского сценария и WebContentsView, а коллекцию больше не правит из разных мест
// через push/filter/присваивание.
export interface SplitPair {
  leftId: string;
  rightId: string;
  activePanel: 'left' | 'right';
  splitRatio: number;
}

export class SplitPairRegistry implements Iterable<SplitPair> {
  #pairs: SplitPair[] = [];

  containing(tabId: string): SplitPair | undefined {
    return this.#pairs.find((pair) => pair.leftId === tabId || pair.rightId === tabId);
  }

  active(activeId: string): SplitPair | undefined {
    return this.containing(activeId);
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
