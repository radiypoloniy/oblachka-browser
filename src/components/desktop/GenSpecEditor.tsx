import { Plus, Trash2 } from 'lucide-react';
import { genSourceLabel, type GenItem, type GenSpec } from '../../../shared/genSpec';
import { RADIUS, TEXT, motion, pad, sp } from '../../styles/system';
import { Field, Group, NumField, iconBtn, inputStyle } from './genStudioUi';

// Правка данных собранного виджета — руками, без модели.
//
// ⚠️ Отдельный файл, а не блок внутри GenStudio.tsx, и причина не в размере. Редактор существует
// РОВНО ДЛЯ ЯРУСА 1 (спека под грамматикой): у виджета, написанного облаком разметкой, полей нет
// и быть не может — там правится только просьба и пересборка (см. shared/genFree.ts). Два ответа
// с разной судьбой в интерфейсе — два файла.

/**
 * Правка данных виджета руками.
 *
 * ⚠️ Ради этого блока и менялась архитектура. Пока виджет был разметкой от модели, править было
 * нечего: любая мелочь означала новый прогон и новый результат целиком. Данные правятся точечно
 * и без модели — а значит виджет становится СВОИМ, а не «что дали».
 */
export function SpecEditor({ spec, onPatch }: { spec: GenSpec; onPatch: (p: Partial<GenSpec>) => void }) {
  const items = spec.items ?? [];
  const listy = spec.kind === 'list' || spec.kind === 'dice' || spec.kind === 'checklist'
    || spec.kind === 'zones';
  const subLabel = spec.kind === 'list' ? 'перевод, автор, пояснение'
    : spec.kind === 'zones' ? 'название города' : 'пояснение';

  return (
    <Group title="Что внутри" note="Правится руками — модель для этого больше не нужна">
      <Field label="Заголовок" value={spec.title} onChange={(v) => onPatch({ title: v })} />

      {spec.kind === 'dice' && typeof spec.from === 'number' && (
        <>
          <NumField label="От" value={spec.from} onChange={(v) => onPatch({ from: v })} />
          <NumField label="До" value={spec.to ?? spec.from + 1} onChange={(v) => onPatch({ to: v })} />
        </>
      )}

      {listy && !(spec.kind === 'dice' && typeof spec.from === 'number') && (
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
            onClick={() => onPatch({
              items: [...items, { main: spec.kind === 'zones' ? 'Europe/Moscow' : 'Новый пункт' }],
            })}
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

      {(spec.kind === 'feed' || spec.kind === 'stat') && spec.source === 'web' && (
        <>
          <Field label="Ссылка" value={spec.url ?? ''} onChange={(v) => onPatch({ url: v })} />
          {spec.kind === 'stat' && (
            <>
              <Field label="Путь в ответе" value={spec.path ?? ''} onChange={(v) => onPatch({ path: v })} />
              <Field label="Единица" value={spec.unit ?? ''} onChange={(v) => onPatch({ unit: v })} />
            </>
          )}
          {spec.kind === 'feed' && (
            <NumField label="Строк" value={spec.rows ?? 5} onChange={(v) => onPatch({ rows: v })} />
          )}
        </>
      )}

      {(spec.kind === 'feed' || spec.kind === 'stat') && spec.source !== 'web' && (
        <div style={{ ...TEXT.caption }}>Источник: {genSourceLabel(spec.source ?? 'history')}</div>
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
