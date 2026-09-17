// Прогресс виджета «Карточки». Сами пары — в shared/cards.ts, здесь только коробки и
// активная колода: как у дел, localStorage рядом со столом, без IPC.
import {
  DECK_IDS, type CardBox, type DeckId, isDeckId,
} from '../../shared/cards';

const KEY = 'oblako-desktop-cards';
const EVENT = 'oblako-desktop-cards';

export interface CardsProgress {
  version: 1;
  active: DeckId;
  boxes: Partial<Record<DeckId, Record<string, CardBox>>>;
}

const EMPTY: CardsProgress = { version: 1, active: 'en', boxes: {} };

export function loadCards(): CardsProgress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<CardsProgress>;
    const active = typeof parsed.active === 'string' && isDeckId(parsed.active) ? parsed.active : 'en';
    const boxes: CardsProgress['boxes'] = {};
    if (parsed.boxes && typeof parsed.boxes === 'object') {
      for (const id of DECK_IDS) {
        const src = parsed.boxes[id];
        if (!src || typeof src !== 'object') continue;
        const clean: Record<string, CardBox> = {};
        for (const [k, v] of Object.entries(src)) {
          if (v === 1 || v === 2) clean[k] = v;
        }
        boxes[id] = clean;
      }
    }
    return { version: 1, active, boxes };
  } catch {
    return EMPTY;
  }
}

export function saveCards(progress: CardsProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
    window.dispatchEvent(new Event(EVENT));
  } catch { /* квота — не критично */ }
}

/** Живое применение: панель стола и плитка пишут в один ключ. */
export function subscribeCards(cb: () => void): () => void {
  const onLocal = (): void => cb();
  const onStorage = (e: StorageEvent): void => {
    if (e.key === KEY || e.key === null) cb();
  };
  window.addEventListener(EVENT, onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, onLocal);
    window.removeEventListener('storage', onStorage);
  };
}

export function setActiveDeck(progress: CardsProgress, active: DeckId): CardsProgress {
  const next = { ...progress, active };
  saveCards(next);
  return next;
}

export function setCardBox(progress: CardsProgress, deck: DeckId, id: string, box: CardBox): CardsProgress {
  const prev = progress.boxes[deck] ?? {};
  const next: CardsProgress = {
    ...progress,
    boxes: { ...progress.boxes, [deck]: { ...prev, [id]: box } },
  };
  saveCards(next);
  return next;
}

export function resetDeck(progress: CardsProgress, deck: DeckId): CardsProgress {
  const next: CardsProgress = {
    ...progress,
    boxes: { ...progress.boxes, [deck]: {} },
  };
  saveCards(next);
  return next;
}
