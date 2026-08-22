import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { CellSize, DesktopItem } from '../../newtab/desktop';
import {
  GEN_SIZES, type GenSizeName,
} from '../../../shared/genWidget';
import {
  genKindLabel, genKindHint, genKindSize, validateGenSpec,
  type GenSpec, type GenItem,
} from '../../../shared/genSpec';
import { saveGenRecord, deleteGenRecord, loadGenRecord } from '../../newtab/genStore';
import { GenWidget } from './GenWidget';
import { Tile, WIDGET_FILLS, FILL_SWATCH } from './widgets';
import { RADIUS, TEXT, motion, pad, sp } from '../../styles/system';
import type { GenSpecOutcome, GenProgress } from '../../../shared/ipc';

// Сборка своего виджета — отдельный режим стола.
//
// ⚠️ Что здесь изменилось по существу 22.08.2026: модель больше не пишет код, она отдаёт ТИП и
// ДАННЫЕ (см. shared/genSpec.ts). Из этого следует главное свойство этого окна — данные можно
// ПРАВИТЬ РУКАМИ. Раньше единственным способом что-то изменить была пересборка вслепую, потому
// что править было нечего: там лежал HTML, написанный моделью.
//
// ⚠️ Три решения остались от прошлой версии, каждое из живой жалобы:
// 1. Болванка — обычный элемент сетки стола, а не карточка поверх неё.
// 2. Окно не закрывается кликом мимо: за кликом стоит минута ожидания модели.
// 3. Сборка движется в ритме модели (onGenWidgetProgress), а не крутит спиннер.

const DRAFT_ID = 'gen-draft';

/** Ширина окна — та же, что у панели настройки экрана: два окна одной ширины читаются как система. */
const STUDIO_WIDTH = 480;
/** Поле блоков в болванке, пока идёт сборка. */
const FIELD_COLS = 4;
const FIELD_ROWS = 5;
const FIELD_CELLS = FIELD_COLS * FIELD_ROWS;
/** Сколько символов ответа модели — один блок. */
const CHARS_PER_BLOCK = 14;
/** Кружок заливки — тот же размер, что в панели настройки экрана. */
const SWATCH = 26;

export const GEN_GHOST_ID = 'gen-ghost';

export interface GenGhost {
  size: CellSize;
  fill?: string;
  busy: boolean;
  stage: GenProgress['stage'];
  chars: number;
  hasDraft: boolean;
}

const SIZE_LABELS: [GenSizeName, string][] = [
  ['small', 'Малый'],
  ['medium', 'Широкий'],
  ['large', 'Большой'],
];

const STAGE_LABEL: Record<GenProgress['stage'], string> = {
  kind: 'Понимаю запрос',
  data: 'Собираю данные',
  done: 'Проверяю',
};

interface Turn {
  phrase: string;
  answer: string;
}

export default function GenStudio({
  onGhost, onPlace, onClose, editId,
}: {
  onGhost: (g: GenGhost) => void;
  onPlace: (item: Omit<DesktopItem, 'id'>) => void;
  onClose: () => void;
  /**
   * Правка виджета, который УЖЕ стоит на столе.
   *
   * ⚠️ Без неё поменять таймеру время можно было только одним способом: собрать новый виджет и
   * удалить старый. Данные правятся точечно — значит и править их надо на месте, а не заново
   * прогонять модель ради другого числа.
   */
  editId?: string;
}) {
  const [phrase, setPhrase] = useState('');
  const [sizeName, setSizeName] = useState<GenSizeName>('small');
  const [fill, setFill] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [spec, setSpec] = useState<GenSpec | null>(null);
  const [progress, setProgress] = useState<GenProgress | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const busyRef = useRef(false);
  // Спека на момент открытия. ⚠️ Правки уходят в настоящую запись СРАЗУ — только так плитка на
  // столе меняется на глазах. Значит «Отмена» обязана вернуть то, что было, а не просто закрыть.
  const original = useRef<GenSpec | null>(null);
  // ⚠️ Тронул ли человек размер сам. Подсказка типа слабее выбора: выбрать «Широкий», дождаться
  // сборки и увидеть квадрат — значит зря выбирать вообще.
  const sizeTouched = useRef(false);

  const size: CellSize = GEN_SIZES[sizeName];

  useEffect(() => () => { deleteGenRecord(DRAFT_ID); }, []);

  useEffect(() => {
    if (!editId) return;
    const rec = loadGenRecord(editId);
    if (!rec?.spec) return;
    original.current = rec.spec;
    setSpec(rec.spec);
    setPhrase(rec.phrase ?? '');
    if (rec.size) setSizeName(nameForSize(rec.size));
    sizeTouched.current = true;
  }, [editId]);
  useEffect(() => window.oblako.onGenWidgetProgress((p) => setProgress(p)), []);

  // Черновик лежит в хранилище под своим id — болванку рисует та же плитка, что и стол.
  // При правке пишем сразу в настоящую запись: человек должен видеть изменения на своей плитке.
  useEffect(() => {
    if (!spec) return;
    saveGenRecord(editId ?? DRAFT_ID, { spec, html: '', facts: [], phrase, title: spec.title, size });
  }, [spec, phrase, size.w, size.h, editId]);

  useEffect(() => {
    // При правке болванки нет: правится плитка, которая уже стоит на своём месте.
    if (editId) return;
    onGhost({
      size, fill, busy, hasDraft: !!spec,
      stage: progress?.stage ?? 'kind',
      chars: progress?.chars ?? 0,
    });
  }, [size.w, size.h, fill, busy, spec, progress, onGhost, editId]);

  // Esc закрывает только пустую студию: пока идёт сборка или есть черновик, за ним потеря работы.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (busyRef.current || spec) return;
      cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spec, onClose, editId]);

  async function assemble() {
    const p = phrase.trim();
    if (p.length < 3 || busy) return;
    setBusy(true);
    busyRef.current = true;
    setError('');
    setSpec(null);
    setProgress({ stage: 'kind', chars: 0 });
    try {
      const res: GenSpecOutcome = await window.oblako.buildGenWidget(p);
      if (!res.ok) {
        // ⚠️ Если тип назван, а данные под него не собрались — говорим это прямо и называем тип.
        // Человеку это подсказка, что переформулировать, а не глухое «не получилось».
        const msg = res.reason === 'model-error'
          ? (res.error || 'Модель не ответила. Нужна скачанная локальная модель.')
          : res.kind
            ? `Понял как «${genKindLabel(res.kind)}», но не собрал данные. Скажите конкретнее — например, сколько и чего.`
            : 'Не понял, какая это плитка. Попробуйте описать проще: список, счётчик, жребий, таймер, цель, отсчёт до даты, заметка.';
        setError(msg);
        setTurns((t) => [...t, { phrase: p, answer: msg }]);
        return;
      }
      if (!sizeTouched.current) setSizeName(nameForSize(genKindSize(res.spec.kind)));
      setSpec(res.spec);
      setTurns((t) => [...t, { phrase: p, answer: `${genKindLabel(res.spec.kind)}: ${res.spec.title}` }]);
    } catch {
      setError('Не удалось обратиться к модели');
    } finally {
      setBusy(false);
      busyRef.current = false;
      setProgress(null);
    }
  }

  /** Правка данных руками. ⚠️ Проходит через ту же validateGenSpec, что и ответ модели. */
  function patch(next: Partial<GenSpec>) {
    if (!spec) return;
    const merged = validateGenSpec({ ...spec, ...next });
    if (merged) setSpec(merged);
  }

  /** Закрыть, вернув запись к состоянию на момент открытия. */
  function cancel() {
    if (editId && original.current) {
      saveGenRecord(editId, {
        spec: original.current, html: '', facts: [],
        phrase, title: original.current.title, size,
      });
    }
    onClose();
  }

  function place() {
    if (!spec) return;
    // Правка: запись уже обновлена по ходу дела, остаётся закрыть окно.
    if (editId) { onClose(); return; }
    const genId = `g${Date.now().toString(36)}`;
    saveGenRecord(genId, { spec, html: '', facts: [], phrase, title: spec.title, size });
    deleteGenRecord(DRAFT_ID);
    onPlace({ kind: 'widget', widget: 'gen', genId, size, title: spec.title, fill });
    onClose();
  }

  return (
    <aside style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 40,
      width: STUDIO_WIDTH, maxWidth: '94%', display: 'flex', flexDirection: 'column',
      background: 'var(--surface-solid)', boxShadow: 'var(--shadow-island)',
      animation: 'oblako-panel-in var(--dur-base) var(--ease-out)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: sp(3), padding: pad(4, 6),
        borderBottom: '1px solid var(--divider)', flex: 'none',
      }}>
        <span style={{ flex: 1, ...TEXT.title }}>{editId ? 'Правка виджета' : 'Свой виджет'}</span>
        <button onClick={cancel} title="Закрыть" style={iconBtn}><X size={16} /></button>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: sp(6),
        padding: `${sp(6)}px ${sp(6)}px ${sp(4)}px`,
      }}>
        <Group title="Запрос" note="Опишите словами. Локальная модель выберет вид плитки и наполнит её — в сеть виджет не ходит">
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
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void assemble(); } }}
            rows={2}
            disabled={busy}
            placeholder="Что съесть на ужин, отжимания, 100 дней до отпуска…"
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

        {spec && (
          <Group title="Вид плитки">
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: sp(2), padding: pad(2, 3),
              borderRadius: RADIUS.control, background: 'var(--surface-sunken)',
            }}>
              <span style={{ ...TEXT.body, fontWeight: 600, color: 'var(--text-strong)' }}>
                {genKindLabel(spec.kind)}
              </span>
              <span style={{ ...TEXT.caption }}>{genKindHint(spec.kind)}</span>
            </div>
          </Group>
        )}

        <Group title="Размер" note="Видно сразу на болванке — выбирать вслепую не нужно">
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

        {spec && <SpecEditor spec={spec} onPatch={patch} />}
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
            ...btnBase, background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 600,
            opacity: busy || phrase.trim().length < 3 ? 0.5 : 1,
          }}
        >{busy ? 'Собираю…' : spec ? 'Пересобрать' : 'Собрать'}</button>
        {spec && (
          <button
            type="button"
            onClick={place}
            style={{ ...btnBase, background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 600 }}
          >{editId ? 'Готово' : 'Поставить'}</button>
        )}
        <button
          type="button"
          onClick={cancel}
          style={{
            ...btnBase, background: 'transparent', color: 'var(--text-body)',
            border: '1px solid var(--divider-strong)',
          }}
        >Отмена</button>
      </div>
    </aside>
  );
}

/**
 * Правка данных виджета руками.
 *
 * ⚠️ Ради этого блока и менялась архитектура. Пока виджет был разметкой от модели, править было
 * нечего: любая мелочь означала новый прогон и новый результат целиком. Данные правятся точечно
 * и без модели — а значит виджет становится СВОИМ, а не «что дали».
 */
function SpecEditor({ spec, onPatch }: { spec: GenSpec; onPatch: (p: Partial<GenSpec>) => void }) {
  const items = spec.items ?? [];
  const listy = spec.kind === 'list' || spec.kind === 'dice' || spec.kind === 'checklist';
  const subLabel = spec.kind === 'list' ? 'перевод, автор, пояснение' : 'пояснение';

  return (
    <Group title="Что внутри" note="Правится руками — модель для этого больше не нужна">
      <Field label="Заголовок" value={spec.title} onChange={(v) => onPatch({ title: v })} />

      {listy && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: sp(2), alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: sp(1) }}>
                <input
                  value={it.main}
                  onChange={(e) => onPatch({ items: replaceAt(items, i, { ...it, main: e.target.value }) })}
                  style={inputStyle}
                />
                {spec.kind !== 'checklist' && (
                  <input
                    value={it.sub ?? ''}
                    placeholder={subLabel}
                    onChange={(e) => onPatch({ items: replaceAt(items, i, { ...it, sub: e.target.value }) })}
                    style={{ ...inputStyle, ...TEXT.caption, color: 'var(--text-faint)' }}
                  />
                )}
              </div>
              <button
                type="button"
                title="Убрать"
                onClick={() => onPatch({ items: items.filter((_, n) => n !== i) })}
                style={iconBtn}
              ><Trash2 size={14} /></button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onPatch({ items: [...items, { main: 'Новый пункт' }] })}
            style={{
              ...TEXT.body, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center',
              gap: sp(2), padding: pad(1, 3), cursor: 'default', borderRadius: RADIUS.pill,
              border: '1px solid var(--divider-strong)', background: 'transparent',
              color: 'var(--text-body)', transition: motion.hover('background', 'color'),
            }}
          ><Plus size={14} /> Добавить</button>
        </div>
      )}

      {spec.kind === 'counter' && (
        <>
          <Field label="Единица" value={spec.unit ?? ''} onChange={(v) => onPatch({ unit: v })} />
          <NumField label="Шаг" value={spec.step ?? 1} onChange={(v) => onPatch({ step: v })} />
        </>
      )}

      {spec.kind === 'goal' && (
        <>
          <NumField label="Цель" value={spec.target ?? 1} onChange={(v) => onPatch({ target: v })} />
          <Field label="Единица" value={spec.unit ?? ''} onChange={(v) => onPatch({ unit: v })} />
        </>
      )}

      {spec.kind === 'timer' && (
        <NumField
          label="Минут"
          value={Math.round((spec.seconds ?? 1500) / 60)}
          onChange={(v) => onPatch({ seconds: Math.max(1, v) * 60 })}
        />
      )}

      {spec.kind === 'countdown' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: sp(1) }}>
          <span style={{ ...TEXT.caption }}>Дата</span>
          <input
            type="date"
            value={spec.date ?? ''}
            onChange={(e) => onPatch({ date: e.target.value })}
            style={inputStyle}
          />
        </label>
      )}

      {spec.kind === 'note' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: sp(1) }}>
          <span style={{ ...TEXT.caption }}>Текст</span>
          <textarea
            value={spec.text ?? ''}
            rows={3}
            onChange={(e) => onPatch({ text: e.target.value })}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </label>
      )}
    </Group>
  );
}

function replaceAt(items: GenItem[], i: number, next: GenItem): GenItem[] {
  return items.map((x, n) => (n === i ? next : x));
}

/**
 * Болванка на столе: пока идёт сборка — падающие блоки, после — настоящая плитка черновика.
 *
 * ⚠️ Полосы «сколько осталось» здесь нет и быть не может: длина ответа неизвестна заранее.
 * Задача картинки — показать, что работа идёт, а не сколько её осталось.
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
                // ⚠️ Ключ зависит от того, ЗАПОЛНЕНА ли клетка, и только от этого: кадры
                // проигрываются заново при ремонте элемента, а он случается у одной новой
                // клетки. Добавь сюда счётчик — и всё поле начнёт падать на каждом токене.
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

function nameForSize(size: { w: number; h: number }): GenSizeName {
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

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: sp(1) }}>
      <span style={{ ...TEXT.caption }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
    </label>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: sp(1) }}>
      <span style={{ ...TEXT.caption }}>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        style={inputStyle}
      />
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  ...TEXT.body, width: '100%', boxSizing: 'border-box', padding: pad(2, 3),
  borderRadius: RADIUS.control, border: '1px solid var(--divider-strong)',
  background: 'var(--surface)', color: 'var(--text-strong)',
  fontFamily: 'inherit', outline: 'none',
};

const btnBase: React.CSSProperties = {
  padding: pad(2, 4), border: 'none', cursor: 'default', borderRadius: RADIUS.pill,
  ...TEXT.body, transition: motion.hover('background', 'opacity'),
};

const iconBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'default', padding: sp(2),
  borderRadius: RADIUS.control, color: 'var(--text-faint)', display: 'inline-flex',
  transition: motion.hover('background', 'color'),
};
