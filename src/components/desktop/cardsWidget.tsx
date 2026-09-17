import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CAPS, DISPLAY, RADIUS, TEXT, motion, pad, sp } from '../../styles/system';
import { fromCell } from '../../../shared/tileBudget';
import {
  DECKS, DECK_IDS, applyAnswer, cardsMode, choiceOptions, reviewQueue, shuffle,
  type CardPair, type DeckId,
} from '../../../shared/cards';
import { loadCards, resetDeck, setActiveDeck, setCardBox, subscribeCards, type CardsProgress } from '../../newtab/cardsStore';
import { Tile, type WidgetProps } from './widgets';

// Виджет «Карточки». Плитка — скатерть, на ней бумажный лист.
// 2×2 — знание (не знаю / знаю, перевод смотреть не обязательно). 4×2 — выбор перевода.
// Язык выбирают по имени: на плитке и в «Настройка экрана», не кругом кодов.

const PAPER = 'var(--on-poster-light)';
const PAPER_INK = 'var(--on-poster-dark)';
const PAPER_MUTE = 'color-mix(in srgb, var(--on-poster-dark) 55%, transparent)';
const PAPER_SHADOW = 'var(--inner-light), 0 8px 20px color-mix(in srgb, var(--shadow-tint) 16%, transparent)';

export function CardsWidget({ size, cell, fill, overImage, hero }: WidgetProps) {
  const [progress, setProgress] = useState<CardsProgress>(loadCards);
  const [queue, setQueue] = useState<CardPair[]>(() => {
    const boot = loadCards();
    return shuffle(reviewQueue(DECKS[boot.active].cards, boot.boxes[boot.active]));
  });
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [lock, setLock] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const delayRef = useRef(0);
  const mode = cardsMode(size);
  const deck = DECKS[progress.active];
  const boxes = progress.boxes[progress.active];
  const active = progress.active;

  useEffect(() => () => window.clearTimeout(delayRef.current), []);
  useEffect(() => subscribeCards(() => setProgress(loadCards())), []);
  useEffect(() => {
    const p = loadCards();
    window.clearTimeout(delayRef.current);
    setQueue(shuffle(reviewQueue(DECKS[p.active].cards, p.boxes[p.active])));
    setIndex(0);
    setFlipped(false);
    setLock(false);
    setWrong(null);
    setPicking(false);
  }, [active]);

  const later = (ms: number, fn: () => void): void => {
    window.clearTimeout(delayRef.current);
    delayRef.current = window.setTimeout(() => { setLock(false); fn(); }, ms);
  };

  const answer = (card: CardPair, know: boolean): void => {
    setProgress(setCardBox(progress, progress.active, card.id, applyAnswer(know)));
    setFlipped(false);
    setWrong(null);
    setIndex((i) => i + 1);
  };

  const pickDeck = (id: DeckId): void => {
    if (id === progress.active) { setPicking(false); return; }
    setProgress(setActiveDeck(progress, id));
  };

  const restart = (): void => {
    const next = resetDeck(progress, progress.active);
    setProgress(next);
    window.clearTimeout(delayRef.current);
    setQueue(shuffle(DECKS[progress.active].cards));
    setIndex(0);
    setFlipped(false);
    setLock(false);
    setWrong(null);
  };

  const card = queue[index];
  const known = deck.cards.length - reviewQueue(deck.cards, boxes).length;
  const padPx = fromCell(12, cell, 10);

  return (
    <Tile surface toned overImage={overImage} hero={hero} fill={fill} padding={padPx}>
      <Hud
        left={card && !picking ? `ещё ${queue.length - index}` : ''}
        right={!picking ? `${known}/${deck.cards.length}` : ''}
        title={deck.title}
        picking={picking}
        onPick={() => setPicking((v) => !v)}
      />
      {picking ? (
        <LangPicker active={progress.active} onPick={pickDeck} />
      ) : !card ? (
        <Done known={known} total={deck.cards.length} onAgain={restart} />
      ) : mode === 'choice' ? (
        <ChoiceView
          key={card.id}
          card={card}
          deck={deck.cards}
          cell={cell}
          lock={lock}
          wrong={wrong}
          onPick={(opt) => {
            if (lock) return;
            const ok = opt === card.back;
            setLock(true);
            if (!ok) setWrong(opt);
            later(ok ? 380 : 700, () => answer(card, ok));
          }}
        />
      ) : (
        <ReviewView
          card={card}
          deckId={progress.active}
          cell={cell}
          flipped={flipped}
          lock={lock}
          onFlip={() => { if (!lock && !flipped) setFlipped(true); }}
          onUnknown={() => {
            if (lock) return;
            if (!flipped) {
              setFlipped(true);
              setLock(true);
              later(700, () => answer(card, false));
              return;
            }
            answer(card, false);
          }}
          onKnown={() => { if (!lock) answer(card, true); }}
        />
      )}
    </Tile>
  );
}

function Hud({ left, right, title, picking, onPick }: {
  left: string; right: string; title: string; picking: boolean;
  onPick: () => void;
}) {
  return (
    <div style={{
      flex: 'none', display: 'grid', gridTemplateColumns: '1fr auto 1fr',
      alignItems: 'baseline', gap: sp(2), minHeight: 18, ...TEXT.caption, color: 'inherit', fontWeight: 600, opacity: 0.7,
    }}>
      <span>{left}</span>
      <button
        type="button"
        title="Выбрать язык"
        onClick={(e) => { e.stopPropagation(); onPick(); }}
        style={{
          border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer',
          font: 'inherit', fontWeight: 700, padding: 0, opacity: picking ? 1 : 0.9,
        }}
      >{title}</button>
      <span style={{
        fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', textAlign: 'right',
      }}>{right}</span>
    </div>
  );
}

function LangPicker({ active, onPick }: { active: DeckId; onPick: (id: DeckId) => void }) {
  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: sp(2),
    }}>
      {DECK_IDS.map((id) => {
        const on = id === active;
        return (
          <button
            key={id}
            type="button"
            onClick={(e) => { e.stopPropagation(); onPick(id); }}
            style={{
              ...paperBox, minWidth: 0, minHeight: 0, cursor: 'pointer', border: 0, font: 'inherit',
              ...TEXT.body, color: PAPER_INK, fontWeight: on ? 700 : 600,
              boxShadow: on ? PAPER_SHADOW : 'none',
              opacity: on ? 1 : 0.78,
            }}
          >{DECKS[id].title}</button>
        );
      })}
    </div>
  );
}

function Done({ known, total, onAgain }: { known: number; total: number; onAgain: () => void }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: sp(2), textAlign: 'center',
    }}>
      <div style={{ ...DISPLAY, fontSize: 48, fontWeight: 800, letterSpacing: '-0.04em' }}>{known}</div>
      <div style={{ fontWeight: 600, opacity: 0.8 }}>из {total}</div>
      <button type="button" onClick={(e) => { e.stopPropagation(); onAgain(); }} style={paperBtn()}>
        Ещё круг
      </button>
    </div>
  );
}

function ReviewView({ card, deckId, cell, flipped, lock, onFlip, onUnknown, onKnown }: {
  card: CardPair; deckId: DeckId; cell: number; flipped: boolean; lock: boolean;
  onFlip: () => void; onUnknown: () => void; onKnown: () => void;
}) {
  const word = fromCell(28, cell, 20);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: sp(2) }}>
      <div
        onClick={onFlip}
        style={{ flex: 1, minHeight: 0, position: 'relative', perspective: 900, cursor: 'pointer' }}
      >
        <div style={{ ...stackStyle, inset: '10px 0 8px 22px', transform: 'rotate(5deg)', opacity: 0.7 }} />
        <div style={{ ...stackStyle, inset: '12px 22px 6px 0', transform: 'rotate(-4deg)', opacity: 0.45 }} />
        <div style={{
          position: 'absolute', inset: '2px 10px 0', transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : 'none',
          transition: motion.state('transform'),
        }}>
          <PaperFace lang={deckId} text={card.front} size={word} />
          <PaperFace lang="ru" text={card.back} size={fromCell(22, cell, 16)} back />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: sp(2), flex: 'none' }}>
        <button type="button" onClick={(e) => { e.stopPropagation(); onUnknown(); }} style={ghostBtn()}>
          Не знаю
        </button>
        <button
          type="button"
          disabled={lock}
          onClick={(e) => { e.stopPropagation(); onKnown(); }}
          style={{ ...paperBtn(), opacity: lock ? 0.38 : 1 }}
        >
          Знаю
        </button>
      </div>
    </div>
  );
}

function ChoiceView({ card, deck, cell, lock, wrong, onPick }: {
  card: CardPair; deck: CardPair[]; cell: number; lock: boolean; wrong: string | null;
  onPick: (opt: string) => void;
}) {
  const [options] = useState(() => choiceOptions(card, deck));
  const word = fromCell(26, cell, 18);
  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: sp(3),
    }}>
      <div style={{ ...paperBox, flexDirection: 'column', gap: sp(2), minWidth: 0, minHeight: 0 }}>
        <LangMark text={card.id.slice(0, 2)} />
        <div style={{ ...DISPLAY, fontSize: word, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.12, color: PAPER_INK }}>
          {card.front}
        </div>
      </div>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: sp(2) }}>
        {options.map((opt) => {
          const isWrong = wrong === opt;
          const dim = lock && opt !== card.back && !isWrong;
          return (
            <button
              key={opt}
              type="button"
              disabled={lock}
              onClick={(e) => { e.stopPropagation(); onPick(opt); }}
              style={{
                ...paperBox, flex: 1, minHeight: 0, cursor: lock ? 'default' : 'pointer',
                border: 0, font: 'inherit', fontWeight: 600, fontSize: fromCell(15, cell, 13),
                color: PAPER_INK, opacity: dim ? 0.38 : 1,
                transform: isWrong ? 'translateX(-4px)' : undefined,
                transition: motion.hover('opacity', 'transform'),
              }}
            >{opt}</button>
          );
        })}
      </div>
    </div>
  );
}

function PaperFace({ lang, text, size, back }: { lang: string; text: string; size: number; back?: boolean }) {
  return (
    <div style={{
      ...paperBox,
      position: 'absolute', inset: 0, flexDirection: 'column', gap: sp(2), padding: pad(4, 3),
      backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
      transform: back ? 'rotateY(180deg)' : undefined,
    }}>
      <LangMark text={lang} />
      <div style={{ ...DISPLAY, fontSize: size, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.12, color: PAPER_INK }}>
        {text}
      </div>
    </div>
  );
}

function LangMark({ text }: { text: string }) {
  return (
    <div style={{ ...CAPS, color: PAPER_MUTE }}>{text}</div>
  );
}

const paperBox: CSSProperties = {
  background: PAPER, color: PAPER_INK, borderRadius: RADIUS.box,
  boxShadow: PAPER_SHADOW, display: 'flex', alignItems: 'center', justifyContent: 'center',
  textAlign: 'center', padding: `${sp(2)}px ${sp(3)}px`,
};

const stackStyle: CSSProperties = {
  position: 'absolute', borderRadius: RADIUS.box, background: PAPER, boxShadow: PAPER_SHADOW,
  pointerEvents: 'none',
};

function paperBtn(): CSSProperties {
  return {
    border: 0, cursor: 'pointer', font: 'inherit', ...TEXT.body, fontWeight: 600,
    height: 36, padding: `0 ${sp(4)}px`, borderRadius: RADIUS.pill,
    background: PAPER, color: PAPER_INK, boxShadow: PAPER_SHADOW,
  };
}

function ghostBtn(): CSSProperties {
  return {
    border: 0, cursor: 'pointer', font: 'inherit', ...TEXT.body, fontWeight: 600,
    height: 36, borderRadius: RADIUS.pill,
    background: 'color-mix(in srgb, currentColor 12%, transparent)', color: 'inherit',
  };
}
