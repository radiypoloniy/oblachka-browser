import { useEffect, useMemo, useRef, useState } from 'react';
import type { CellSize, DesktopItem } from '../../newtab/desktop';
import {
  GEN_SIZES, GEN_FACT_IDS, type GenSizeName,
} from '../../../shared/genWidget';
import { useFreeTier } from './useFreeTier';
import {
  genKindLabel, genKindHint, genKindSize, validateGenSpec, type GenSpec,
} from '../../../shared/genSpec';
import { saveGenRecord, deleteGenRecord, loadGenRecord } from '../../newtab/genStore';
import { GenWidget } from './GenWidget';
import { Tile } from './widgets';
import { SpecEditor } from './GenSpecEditor';
import {
  FillPicker, Group, KindCard, Segmented, StudioFooter, StudioHeader, TurnLog, inputStyle,
} from './genStudioUi';
import { RADIUS, TEXT, pad, sp } from '../../styles/system';
import type { GenSpecOutcome, GenProgress } from '../../../shared/ipc';
import { CELL_REF } from '../../../shared/tileBudget';

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

/**
 * Чем соберётся виджет — словами под полем запроса.
 *
 * ⚠️ Разные слова не для красоты: от яруса зависит, ЧЕГО просить. Каталог типов понимает «список,
 * счётчик, таймер», свободная разметка нарисует и то, чего в каталоге нет (см. shared/genFree.ts).
 */
const ASK_NOTE = {
  free: 'Опишите словами. Облачная модель нарисует плитку сама — в сеть готовый виджет не ходит, данные о браузере ему отдаёт браузер',
  spec: 'Опишите словами. Локальная модель выберет вид плитки и наполнит её — в сеть виджет не ходит',
};

const STAGE_LABEL: Record<GenProgress['stage'], string> = {
  kind: 'Понимаю запрос',
  data: 'Собираю данные',
  done: 'Проверяю',
  // Ярус 2: один прогон, и он сразу пишет вёрстку — «понимаю запрос» здесь было бы неправдой.
  free: 'Рисую виджет',
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
  const [link, setLink] = useState('');
  const [sizeName, setSizeName] = useState<GenSizeName>('small');
  const [fill, setFill] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [spec, setSpec] = useState<GenSpec | null>(null);
  /**
   * Разметка яруса 2 (shared/genFree.ts). ⚠️ Отдельное состояние, а не спека с полем html: у этих
   * двух исходов разная судьба в интерфейсе — у спеки есть редактор полей, у разметки его нет и
   * быть не может. Одновременно они не живут: сборка начинается со сброса обоих.
   */
  const [freeHtml, setFreeHtml] = useState<string | null>(null);
  const [progress, setProgress] = useState<GenProgress | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const busyRef = useRef(false);
  // Спека на момент открытия. ⚠️ Правки уходят в настоящую запись СРАЗУ — только так плитка на
  // столе меняется на глазах. Значит «Отмена» обязана вернуть то, что было, а не просто закрыть.
  const original = useRef<GenSpec | null>(null);
  const originalHtml = useRef<string | null>(null);
  // ⚠️ Тронул ли человек размер сам. Подсказка типа слабее выбора: выбрать «Широкий», дождаться
  // сборки и увидеть квадрат — значит зря выбирать вообще.
  const sizeTouched = useRef(false);

  const size: CellSize = GEN_SIZES[sizeName];
  const draft = !!spec || !!freeHtml;

  const freeTier = useFreeTier();

  useEffect(() => () => { deleteGenRecord(DRAFT_ID); }, []);

  useEffect(() => {
    if (!editId) return;
    const rec = loadGenRecord(editId);
    if (!rec) return;
    setPhrase(rec.phrase ?? '');
    if (rec.size) setSizeName(nameForSize(rec.size));
    sizeTouched.current = true;
    // ⚠️ Виджет яруса 2 открывается на правку ТОЛЬКО ради пересборки: править в нём нечего —
    // там разметка, а не поля. Молча показать пустую студию было бы хуже: человек решил бы,
    // что его виджет потерялся.
    if (!rec.spec) {
      if (!rec.html) return;
      originalHtml.current = rec.html;
      setFreeHtml(rec.html);
      return;
    }
    original.current = rec.spec;
    setSpec(rec.spec);
    setLink(rec.spec.url ?? '');
  }, [editId]);
  useEffect(() => window.oblako.onGenWidgetProgress((p) => setProgress(p)), []);

  // Черновик лежит в хранилище под своим id — болванку рисует та же плитка, что и стол.
  // При правке пишем сразу в настоящую запись: человек должен видеть изменения на своей плитке.
  // ⚠️ Оба яруса пишутся ОДНИМ эффектом: запись у них одна, и разъехавшись, они однажды сохранят
  // спеку поверх разметки. У яруса 2 факты запрашиваются ВСЕ ТРИ — свободная разметка не
  // объявляет, какими пользуется, а собрать три счётчика дешевле, чем разбирать чужой код.
  useEffect(() => {
    if (spec) {
      saveGenRecord(editId ?? DRAFT_ID, { spec, html: '', facts: [], phrase, title: spec.title, size });
    } else if (freeHtml) {
      saveGenRecord(editId ?? DRAFT_ID, {
        html: freeHtml, facts: [...GEN_FACT_IDS], mode: 'html',
        phrase, title: freeTitle(phrase), size,
      });
    }
  }, [spec, freeHtml, phrase, size.w, size.h, editId]);

  useEffect(() => {
    // При правке болванки нет: правится плитка, которая уже стоит на своём месте.
    if (editId) return;
    onGhost({
      size, fill, busy, hasDraft: draft,
      stage: progress?.stage ?? 'kind',
      chars: progress?.chars ?? 0,
    });
  }, [size.w, size.h, fill, busy, draft, progress, onGhost, editId]);

  // Esc закрывает только пустую студию: пока идёт сборка или есть черновик, за ним потеря работы.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (busyRef.current || draft) return;
      cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft, onClose, editId]);

  async function assemble() {
    const p = phrase.trim();
    // Со ссылкой фраза не обязательна: что показывать, решает то, что по ней лежит.
    if ((p.length < 3 && !link.trim()) || busy) return;
    setBusy(true);
    busyRef.current = true;
    setError('');
    setSpec(null);
    setFreeHtml(null);
    setProgress({ stage: freeTier && !link.trim() ? 'free' : 'kind', chars: 0 });
    try {
      const res: GenSpecOutcome = await window.oblako.buildGenWidget(p, link.trim() || undefined, size);
      if (!res.ok) {
        // ⚠️ Если тип назван, а данные под него не собрались — говорим это прямо и называем тип.
        // Человеку это подсказка, что переформулировать, а не глухое «не получилось».
        const msg = res.reason === 'model-error'
          ? (res.error || 'Модель не ответила. Нужна скачанная локальная модель.')
          : res.reason === 'link'
          // ⚠️ Отказ по ссылке говорит ПРО ССЫЛКУ, а не про модель: чаще всего человек дал
          // адрес обычной страницы, и ему нужно знать, что искать вместо неё.
          ? (res.error || 'По этой ссылке виджет не собрать')
          : res.kind
            ? `Понял как «${genKindLabel(res.kind)}», но не собрал данные. Скажите конкретнее — например, сколько и чего.`
            : 'Не понял, какая это плитка. Попробуйте описать проще: список, счётчик, жребий, таймер, цель, отсчёт до даты, заметка.';
        setError(msg);
        setTurns((t) => [...t, { phrase: p, answer: msg }]);
        return;
      }
      // Ярус 2: пришла разметка. ⚠️ Размер НЕ переставляем даже без выбора человека — вёрстку
      // модель писала под тот размер, который стоял в момент просьбы (он уехал в промпт).
      if (res.free) {
        setFreeHtml(res.html);
        setTurns((t) => [...t, { phrase: p, answer: `Виджет написан разметкой: ${res.html.length} знаков` }]);
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
    // Тот же откат для яруса 2: пересобрали, не понравилось — на столе обязан остаться прежний.
    if (editId && originalHtml.current) {
      saveGenRecord(editId, {
        html: originalHtml.current, facts: [...GEN_FACT_IDS], mode: 'html',
        phrase, title: freeTitle(phrase), size,
      });
    }
    onClose();
  }

  function place() {
    if (!draft) return;
    // Правка: запись уже обновлена по ходу дела, остаётся закрыть окно.
    if (editId) { onClose(); return; }
    const genId = `g${Date.now().toString(36)}`;
    const title = spec ? spec.title : freeTitle(phrase);
    saveGenRecord(genId, spec
      ? { spec, html: '', facts: [], phrase, title, size }
      : { html: freeHtml ?? '', facts: [...GEN_FACT_IDS], mode: 'html', phrase, title, size });
    deleteGenRecord(DRAFT_ID);
    onPlace({ kind: 'widget', widget: 'gen', genId, size, title, fill });
    onClose();
  }

  return (
    <aside style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 40,
      width: STUDIO_WIDTH, maxWidth: '94%', display: 'flex', flexDirection: 'column',
      background: 'var(--surface-solid)', boxShadow: 'var(--shadow-island)',
      animation: 'oblako-panel-in var(--dur-base) var(--ease-out)',
    }}>
      <StudioHeader title={editId ? 'Правка виджета' : 'Свой виджет'} onClose={cancel} />

      <div style={{
        flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: sp(6),
        padding: `${sp(6)}px ${sp(6)}px ${sp(4)}px`,
      }}>
        {/* ⚠️ Подпись говорит, ЧЕМ соберётся виджет, потому что от этого зависит, чего просить:
            каталог типов понимает «список, счётчик, таймер», а свободная разметка нарисует и то,
            чего в каталоге нет. Обещать одно, а делать другое — худший вариант из трёх. */}
        <Group title="Запрос" note={freeTier ? ASK_NOTE.free : ASK_NOTE.spec}>
          <TurnLog turns={turns} />
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

        {/* ⚠️ Ссылку даёт ЧЕЛОВЕК, и это не мелочь интерфейса. Модель адресов не знает и,
            если её попросить, выдумает правдоподобный — ровно как выдумывала историю
            посещений. Здесь она вступает уже после того, как хост сходил по ссылке. */}
        <Group
          title="Ссылка (не обязательно)"
          note="Адрес RSS-ленты или JSON-ответа. Запрос идёт из браузера — значит через VPN, без ваших кук. Обычную страницу разобрать нельзя: она меняется от любой перевёрстки"
        >
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            disabled={busy}
            placeholder="https://example.com/rss"
            style={{ ...inputStyle, opacity: busy ? 0.6 : 1 }}
          />
        </Group>

        {/* ⚠️ Ярусы РАЗНЫЕ, а карточка одна: человеку важно, что за плитка вышла, а не каким
            путём она собралась. Разница видна словами внутри — «Своя вёрстка» против названия
            типа из каталога — и тем, что у разметки нет редактора полей ниже. */}
        {spec && <KindCard title={genKindLabel(spec.kind)} note={genKindHint(spec.kind)} />}
        {freeHtml && (
          <KindCard
            title="Своя вёрстка"
            note={`${freeHtml.length} знаков разметки`}
            hint="Разметку писала модель — полей у такого виджета нет. Не то, что хотели, — перескажите просьбу и пересоберите"
          />
        )}

        <Group title="Размер" note="Видно сразу на болванке — выбирать вслепую не нужно">
          <Segmented
            value={sizeName}
            options={SIZE_LABELS}
            onChange={(v) => { sizeTouched.current = true; setSizeName(v); }}
            disabled={busy}
          />
        </Group>

        <FillPicker fill={fill} onPick={setFill} />

        {spec && <SpecEditor spec={spec} onPatch={patch} />}
      </div>

      <StudioFooter
        assembleLabel={busy ? 'Собираю…' : draft ? 'Пересобрать' : 'Собрать'}
        canAssemble={!busy && (phrase.trim().length >= 3 || !!link.trim())}
        placeLabel={draft ? (editId ? 'Готово' : 'Поставить') : null}
        onAssemble={() => void assemble()}
        onPlace={place}
        onCancel={cancel}
      />
    </aside>
  );
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
        size={{ w: 1, h: 1 }} box={box} cell={Math.round(Math.min(CELL_REF, box.width))} tiles={[]}
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

/**
 * Имя виджета яруса 2 — из фразы человека.
 *
 * ⚠️ У спеки заголовок даёт модель, а здесь его просто нет: заголовок плитки модель рисует
 * ВНУТРИ разметки (<p data-caption>), и вытаскивать его оттуда разбором значило бы завести
 * четвёртое место, которое читает чужой HTML. Фраза человека честнее и всегда на месте.
 */
function freeTitle(phrase: string): string {
  const t = phrase.trim().replace(/\s+/g, ' ').slice(0, 28);
  return t || 'Виджет';
}

function nameForSize(size: { w: number; h: number }): GenSizeName {
  for (const [name, s] of Object.entries(GEN_SIZES) as [GenSizeName, CellSize][]) {
    if (s.w === size.w && s.h === size.h) return name;
  }
  return 'small';
}
