import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { CellSize, DesktopItem } from '../../newtab/desktop';
import { GEN_SIZES, pickGenFacts, wantsGenPhoto, type GenSizeName } from '../../../shared/genWidget';
import { saveGenRecord, deleteGenRecord } from '../../newtab/genStore';
import { GenWidget } from './GenWidget';
import { Tile, WIDGET_FILLS, FILL_SWATCH } from './widgets';
import { RADIUS, TEXT, motion, pad, sp } from '../../styles/system';
import type { GenParseOutcome, GenProgress } from '../../../shared/ipc';

// Сборка своего виджета — ОТДЕЛЬНЫЙ РЕЖИМ стола, а не строчка в боковой панели.
//
// ⚠️ Три решения здесь неслучайны, каждое из живой жалобы:
// 1. Болванка — ОБЫЧНЫЙ ЭЛЕМЕНТ СЕТКИ (см. GEN_GHOST_ID и preview в DesktopScreen): встаёт в
//    первую свободную клетку рядом с остальными плитками и живёт по их правилам. Карточка,
//    висевшая по центру поверх стола, закрывала соседей и читалась как посторонний мусор —
//    человек ждёт ровно того же, что при добавлении любого другого виджета.
// 2. Окно НЕ ЗАКРЫВАЕТСЯ кликом мимо. Боковая панель закрывается — и правильно делает, там
//    нечего терять; здесь за кликом стоит минута ожидания модели и набранный запрос.
// 3. Сборка ДВИЖЕТСЯ, и движется в ритме модели (см. onGenWidgetProgress). Прошлый вариант
//    менял подпись кнопки на «Собираю…» и замирал на десятки секунд — это читалось как зависание.

const DRAFT_ID = 'gen-draft';

/** Id болванки в сетке. Синтетический: в раскладку на диск он не попадает никогда. */
export const GEN_GHOST_ID = 'gen-ghost';

/** Что стол должен нарисовать в болванке. Собирается здесь, рисуется там. */
export interface GenGhost {
  size: CellSize;
  fill?: string;
  busy: boolean;
  stage: GenProgress['stage'];
  chars: number;
  hasDraft: boolean;
}

/** Ширина окна сборки — та же, что у панели настройки: два разных окна одной ширины читаются как одна система. */
const STUDIO_WIDTH = 480;
/** Поле блоков в болванке. 4×5 — заметно крупнее пикселей и мельче «плиток». */
const FIELD_COLS = 4;
const FIELD_ROWS = 5;
const FIELD_CELLS = FIELD_COLS * FIELD_ROWS;
/**
 * Сколько символов модели — один блок. Подобрано так, чтобы на типичном ответе (2–6 тысяч
 * символов) поле успевало собраться несколько раз: движение должно быть заметным, но не рябить.
 */
const CHARS_PER_BLOCK = 22;

const SIZE_LABELS: [GenSizeName, string][] = [
  ['small', 'Малый'],
  ['medium', 'Широкий'],
  ['large', 'Большой'],
];

const STAGE_LABEL: Record<GenProgress['stage'], string> = {
  meta: 'Понимаю запрос',
  html: 'Собираю виджет',
  done: 'Проверяю',
};

interface Turn {
  phrase: string;
  answer: string;
}

export default function GenStudio({
  onGhost, onPlace, onClose, already,
}: {
  /** Состояние болванки уходит столу — рисует её он, в своей сетке. */
  onGhost: (g: GenGhost) => void;
  onPlace: (item: Omit<DesktopItem, 'id'>) => void;
  onClose: () => void;
  already?: (widget: string) => boolean;
}) {
  const [phrase, setPhrase] = useState('');
  const [sizeName, setSizeName] = useState<GenSizeName>('small');
  const [fill, setFill] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Extract<GenParseOutcome, { ok: true }> | null>(null);
  const [progress, setProgress] = useState<GenProgress | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [showCode, setShowCode] = useState(false);
  const busyRef = useRef(false);
  // ⚠️ Тронул ли человек размер сам. Модель предлагает SIZE, но её подсказка слабее выбора:
  // выбрать «Широкий», дождаться сборки и увидеть квадрат — значит зря выбирать вообще.
  const sizeTouched = useRef(false);

  // ⚠️ Размер держит ОДНО состояние, а не «модель предложила» плюс «человек выбрал». Модель
  // задаёт его при сборке, дальше он принадлежит человеку: смена размера обязана менять болванку
  // и не имеет права выбрасывать собранный виджет — за ним минута ожидания.
  const size: CellSize = GEN_SIZES[sizeName];

  // Черновик живёт в хранилище под своим id и убирается за собой при выходе из режима.
  useEffect(() => () => { deleteGenRecord(DRAFT_ID); }, []);

  useEffect(() => window.oblako.onGenWidgetProgress((p) => setProgress(p)), []);

  // ⚠️ Esc закрывает ТОЛЬКО пустую студию. Пока идёт сборка или есть собранный черновик, за
  // Esc стоит потерянная минута ожидания — там он молчит, и выход остаётся явной кнопкой.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (busyRef.current || draft) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, onClose]);

  async function assemble() {
    const p = phrase.trim();
    if (p.length < 3 || busy) return;
    setBusy(true);
    busyRef.current = true;
    setError('');
    setDraft(null);
    setProgress({ stage: 'meta', chars: 0 });
    try {
      const res = await window.oblako.parseGenWidget(p);
      if (!res.ok) {
        const msg = res.reason === 'model-error'
          ? (res.error || 'Модель не ответила. Нужна скачанная локальная модель.')
          : res.reason === 'too-hard'
            ? 'Локальная модель это не осилила — обычно так с играми и всем, где нужна своя логика. Попробуйте что-то проще: счётчик, список, случайный элемент.'
            : 'Не собрал. Попробуйте описать другими словами.';
        setError(msg);
        setTurns((t) => [...t, { phrase: p, answer: msg }]);
        return;
      }
      if (res.kind === 'gen') {
        saveGenRecord(DRAFT_ID, {
          html: res.html,
          facts: pickGenFacts(res.facts),
          mode: res.mode,
          photo: res.assetPhoto || wantsGenPhoto(p, res.html, false),
          phrase: p,
          title: res.title,
          size: res.size,
        });
      }
      // Подсказку модели принимаем ТОЛЬКО если человек размер не выбирал.
      if (!sizeTouched.current) setSizeName(sizeOf(res.size));
      setDraft(res);
      setTurns((t) => [...t, {
        phrase: p,
        answer: res.kind === 'builtin' ? `Это готовый виджет: ${res.widget}` : `Собрал: ${res.title || 'свой виджет'}`,
      }]);
    } catch {
      setError('Не удалось обратиться к модели');
    } finally {
      setBusy(false);
      busyRef.current = false;
      setProgress(null);
    }
  }

  function place() {
    if (!draft) return;
    if (draft.kind === 'builtin') {
      if (already?.(draft.widget)) { setError('Этот виджет уже на столе'); return; }
      onPlace({ kind: 'widget', widget: draft.widget, size, fill });
      onClose();
      return;
    }
    const genId = `g${Date.now().toString(36)}`;
    saveGenRecord(genId, {
      html: draft.html,
      facts: pickGenFacts(draft.facts),
      mode: draft.mode,
      photo: draft.assetPhoto || wantsGenPhoto(phrase, draft.html, false),
      phrase,
      title: draft.title,
      size,
    });
    deleteGenRecord(DRAFT_ID);
    onPlace({ kind: 'widget', widget: 'gen', genId, size, title: draft.title, fill });
    onClose();
  }

  const hasDraft = !!draft && draft.kind === 'gen';
  const draftHtml = draft?.kind === 'gen' ? draft.html : '';
  useEffect(() => {
    onGhost({
      size, fill, busy, hasDraft,
      stage: progress?.stage ?? 'meta',
      chars: progress?.chars ?? 0,
    });
  }, [size.w, size.h, fill, busy, hasDraft, progress, onGhost]);

  return (
    // ⚠️ Панель НЕ перекрывает стол целиком и не ловит клик подложкой: болванка стоит в сетке,
    // и человек должен видеть её вместе с соседями, а не через дырку в затемнении.
    <aside style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 40,
      width: STUDIO_WIDTH, maxWidth: '94%', display: 'flex', flexDirection: 'column',
      background: 'var(--surface-solid)', boxShadow: 'var(--shadow-island)',
      animation: 'oblako-panel-in var(--dur-base) var(--ease-out)',
    }}>
      <>
        <div style={{
          display: 'flex', alignItems: 'center', gap: sp(3), padding: pad(4, 6),
          borderBottom: '1px solid var(--divider)', flex: 'none',
        }}>
          <span style={{ flex: 1, ...TEXT.title }}>Свой виджет</span>
          <button onClick={onClose} title="Закрыть" style={iconBtn}><X size={16} /></button>
        </div>

        <div style={{
          flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: sp(6),
          padding: `${sp(6)}px ${sp(6)}px ${sp(4)}px`,
        }}>
          <Group title="Размер" note="Видно сразу на болванке слева — выбирать вслепую не нужно">
            <Segmented
              value={sizeName}
              options={SIZE_LABELS}
              onChange={(v) => { sizeTouched.current = true; setSizeName(v); }}
              disabled={busy}
            />
          </Group>

          <Group title="Цвет">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
              {WIDGET_FILLS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFill(f.id === 'theme' ? undefined : f.id)}
                  title={f.label}
                  style={{
                    width: SWATCH, height: SWATCH, borderRadius: RADIUS.pill, cursor: 'default', padding: 0,
                    background: FILL_SWATCH[f.id] ?? 'var(--surface-sunken)',
                    border: (fill ?? 'theme') === f.id
                      ? '2.5px solid var(--accent)' : '1px solid var(--divider-strong)',
                    transition: motion.hover('border-color'),
                  }}
                />
              ))}
            </div>
          </Group>

          <Group title="Запрос" note="Опишите словами, что должно быть на плитке. Считает и рисует локальная модель — в сеть виджет не ходит">
            {turns.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
                {turns.map((t, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: sp(1) }}>
                    <span style={{
                      alignSelf: 'flex-end', maxWidth: '85%', padding: pad(2, 3),
                      borderRadius: RADIUS.box, background: 'var(--accent-soft)',
                      ...TEXT.body, color: 'var(--text-strong)',
                    }}>{t.phrase}</span>
                    <span style={{ alignSelf: 'flex-start', maxWidth: '85%', ...TEXT.caption }}>{t.answer}</span>
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              onKeyDown={(e) => {
                // Enter отправляет, Shift+Enter — перенос строки: поле работает как строка чата.
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void assemble(); }
              }}
              rows={2}
              disabled={busy}
              placeholder="Кубик на шесть граней, счётчик отжиманий, фоторамка…"
              style={{
                width: '100%', resize: 'vertical', minHeight: sp(8) * 2,
                padding: pad(2, 3), borderRadius: RADIUS.control,
                border: '1px solid var(--divider-strong)', background: 'var(--surface)',
                ...TEXT.body, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
                opacity: busy ? 0.6 : 1,
              }}
            />
            {error && <div style={{ ...TEXT.body, color: 'var(--danger-500)' }}>{error}</div>}
          </Group>

          {/* ⚠️ Показ кода — не отладка «на время», а постоянная часть окна. Пустая плитка без
              возможности заглянуть внутрь неотличима от сломанной функции: и человеку, и тому,
              кто будет чинить, нужно видеть, что именно написала модель. */}
          {draftHtml && (
            <Group title="Что собрала модель">
              <button type="button" onClick={() => setShowCode((v) => !v)} style={{
                ...TEXT.body, alignSelf: 'flex-start', padding: pad(1, 3), cursor: 'default',
                borderRadius: RADIUS.pill, border: '1px solid var(--divider-strong)',
                background: 'transparent', color: 'var(--text-body)',
                transition: motion.hover('background', 'color'),
              }}>{showCode ? 'Скрыть код' : 'Показать код'}</button>
              {showCode && (
                <pre style={{
                  margin: 0, maxHeight: 260, overflow: 'auto', padding: pad(3),
                  borderRadius: RADIUS.box, background: 'var(--surface-sunken)',
                  border: '1px solid var(--divider)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  fontFamily: 'var(--font-mono), ui-monospace, monospace', fontSize: 'var(--fs-xs)',
                  color: 'var(--text-body)',
                }}>{draftHtml}</pre>
              )}
            </Group>
          )}
        </div>

        <div style={{
          flex: 'none', display: 'flex', gap: sp(2), padding: pad(4, 6),
          borderTop: '1px solid var(--divider)',
        }}>
          <button
            type="button"
            onClick={() => void assemble()}
            disabled={busy || phrase.trim().length < 3}
            style={{
              ...btnBase,
              background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 600,
              opacity: busy || phrase.trim().length < 3 ? 0.5 : 1,
            }}
          >{busy ? 'Собираю…' : draft ? 'Пересобрать' : 'Собрать'}</button>
          {draft && (
            <button
              type="button"
              onClick={place}
              style={{ ...btnBase, background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 600 }}
            >Поставить</button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{
              ...btnBase, background: 'transparent', color: 'var(--text-body)',
              border: '1px solid var(--divider-strong)',
            }}
          >Отмена</button>
        </div>
      </>
    </aside>
  );
}

/**
 * Болванка на столе: пока идёт сборка — падающие блоки, после — настоящая плитка.
 *
 * ⚠️ Блоки считаются от ЧИСЛА СИМВОЛОВ, пришедших от модели, и поле переполняется по кругу.
 * Полосы «сколько осталось» здесь нет и быть не может: длина ответа неизвестна заранее, и
 * любая доля выполнения была бы выдумана. Честная задача этой картинки — показать, что работа
 * ИДЁТ, а не сколько её осталось.
 */
export function GenDraftTile({ ghost, box, overImage }: {
  ghost: GenGhost;
  box: { width: number; height: number };
  overImage: boolean;
}) {
  const { busy, chars, stage, fill, hasDraft } = ghost;
  const filled = useMemo(() => {
    if (!busy) return 0;
    return Math.floor(chars / CHARS_PER_BLOCK) % (FIELD_CELLS + 1);
  }, [busy, chars]);

  if (!busy && hasDraft) {
    return (
      <GenWidget
        size={{ w: 1, h: 1 }} box={box} tiles={[]}
        onOpen={() => { /* черновик: плитка ещё не на столе */ }} city="" genId={DRAFT_ID}
        fill={fill} overImage={overImage}
      />
    );
  }

  return (
    <Tile surface toned fill={fill} overImage={overImage} padding={0}>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          padding: sp(4), gap: sp(2),
        }}>
          <div style={{
            display: 'grid', flex: 1, minHeight: 0, gap: sp(1),
            gridTemplateColumns: `repeat(${FIELD_COLS}, 1fr)`,
            gridTemplateRows: `repeat(${FIELD_ROWS}, 1fr)`,
          }}>
            {Array.from({ length: FIELD_CELLS }, (_, i) => {
              const isFilled = i >= FIELD_CELLS - filled;
              const isNext = i === FIELD_CELLS - filled - 1;
              return (
                <span
                  // ⚠️ Ключ зависит от того, ЗАПОЛНЕНА ли клетка, и только от этого. Кадры
                  // проигрываются заново при ремонте элемента, а ремонт случается ровно там, где
                  // сменился ключ, — то есть у одной новой клетки. Добавь сюда счётчик блоков —
                  // и ключи сменятся у всех сразу, всё поле начнёт падать заново на каждом токене.
                  key={isFilled ? `f${i}` : `e${i}`}
                  style={{
                    borderRadius: RADIUS.tight,
                    background: isFilled
                      ? (i % 3 === 0 ? 'var(--accent)' : 'var(--card-chip)')
                      : 'var(--divider)',
                    opacity: isFilled ? 1 : 0.25,
                    animation: isFilled
                      ? 'oblako-gen-drop var(--dur-base) var(--ease-out)'
                      : busy && isNext
                        ? 'oblako-gen-wait 1.4s var(--ease-standard) infinite'
                        : undefined,
                  }}
                />
              );
            })}
          </div>
          <span style={{ ...TEXT.caption, textAlign: 'center' }}>
            {busy ? STAGE_LABEL[stage] : 'Опишите виджет справа'}
          </span>
        </div>
    </Tile>
  );
}

function sizeOf(size: CellSize): GenSizeName {
  for (const [name, s] of Object.entries(GEN_SIZES) as [GenSizeName, CellSize][]) {
    if (s.w === size.w && s.h === size.h) return name;
  }
  return 'small';
}

function Group({ title, note, children }: {
  title: string; note?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
      <span style={{ ...TEXT.section }}>{title}</span>
      {note && <span style={{ ...TEXT.caption, marginTop: -sp(1) }}>{note}</span>}
      {children}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, disabled }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', gap: 2, padding: 2, background: 'var(--surface-sunken)',
      borderRadius: RADIUS.control, opacity: disabled ? 0.6 : 1,
    }}>
      {options.map(([id, label]) => (
        <button
          key={id}
          disabled={disabled}
          onClick={() => onChange(id)}
          style={{
            flex: 1, padding: `${sp(2)}px 0`, border: 'none', cursor: 'default',
            borderRadius: RADIUS.tight,
            background: value === id ? 'var(--surface)' : 'transparent',
            boxShadow: value === id ? 'var(--shadow-card)' : 'none',
            ...TEXT.body,
            color: value === id ? 'var(--text-strong)' : 'var(--text-muted)',
            fontWeight: value === id ? 600 : 400,
            transition: motion.hover('background', 'color'),
          }}
        >{label}</button>
      ))}
    </div>
  );
}

/** Кружок заливки — тот же размер, что в панели настройки экрана. */
const SWATCH = 26;

const btnBase: React.CSSProperties = {
  padding: pad(2, 4), border: 'none', cursor: 'default', borderRadius: RADIUS.pill,
  ...TEXT.body, transition: motion.hover('background', 'opacity'),
};

const iconBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'default', padding: sp(2),
  borderRadius: RADIUS.control, color: 'var(--text-faint)', display: 'inline-flex',
  transition: motion.hover('background', 'color'),
};
