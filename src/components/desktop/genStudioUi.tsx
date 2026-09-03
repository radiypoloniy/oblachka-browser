// Мелкие детали студии виджета: группа, переключатель, поля ввода и общие стили кнопок.
//
// ⚠️ Живут ОТДЕЛЬНО от GenStudio.tsx и GenSpecEditor.tsx потому, что нужны обоим: пока они
// лежали в файле студии, редактор спеки нельзя было из неё вынести, не заведя круговой импорт.
// Своей логики здесь нет вовсе — только вёрстка, поэтому и место у них общее.
//
// ⚠️ Числа берутся из дизайн-системы (src/styles/system.ts) и только из неё — правило проекта.
import type React from 'react';
import { RADIUS, TEXT, motion, pad, sp } from '../../styles/system';
import { X } from 'lucide-react';
import { WIDGET_FILLS, FILL_SWATCH } from './widgets';
import { ModelChip } from '../ai/ModelChip';

/** Кружок заливки — тот же размер, что в панели настройки экрана. */
const SWATCH = 26;

export function Group({ title, note, children }: {
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

export function Segmented<T extends string>({ value, options, onChange, disabled }: {
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

export function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: sp(1) }}>
      <span style={{ ...TEXT.caption }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
    </label>
  );
}

export function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
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

export const inputStyle: React.CSSProperties = {
  ...TEXT.body, width: '100%', boxSizing: 'border-box', padding: pad(2, 3),
  borderRadius: RADIUS.control, border: '1px solid var(--divider-strong)',
  background: 'var(--surface)', color: 'var(--text-strong)',
  fontFamily: 'inherit', outline: 'none',
};

export const btnBase: React.CSSProperties = {
  padding: pad(2, 4), border: 'none', cursor: 'default', borderRadius: RADIUS.pill,
  ...TEXT.body, transition: motion.hover('background', 'opacity'),
};

export const iconBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'default', padding: sp(2),
  borderRadius: RADIUS.control, color: 'var(--text-faint)', display: 'inline-flex',
  transition: motion.hover('background', 'color'),
};

/**
 * Что за плитка получилась.
 *
 * ⚠️ Одна карточка на оба яруса генератора: человеку важен ИСХОД, а не то, каталогом собран
 * виджет или свободной разметкой (см. shared/genFree.ts). `hint` появляется только там, где
 * исход что-то меняет в дальнейших действиях, — у разметки нет полей, и это надо сказать.
 */
export function KindCard({ title, note, hint }: { title: string; note: string; hint?: string }) {
  return (
    <Group title="Вид плитки" note={hint}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: sp(2), padding: pad(2, 3),
        borderRadius: RADIUS.control, background: 'var(--surface-sunken)',
      }}>
        <span style={{ ...TEXT.body, fontWeight: 600, color: 'var(--text-strong)' }}>{title}</span>
        <span style={{ ...TEXT.caption }}>{note}</span>
      </div>
    </Group>
  );
}

/** Заливка плитки. Набор общий со столом (WIDGET_FILLS) — своего у студии быть не должно. */
export function FillPicker({ fill, onPick }: {
  fill: string | undefined;
  onPick: (fill: string | undefined) => void;
}) {
  return (
    <Group title="Цвет">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
        {WIDGET_FILLS.map((f) => (
          <button
            key={f.id}
            onClick={() => onPick(f.id === 'theme' ? undefined : f.id)}
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
  );
}

/**
 * Подвал студии: собрать, поставить, отмена.
 *
 * ⚠️ Кнопка постановки живёт под `placeLabel !== null`, а не под своим флагом: пока черновика
 * нет, ставить на стол нечего, и показывать неработающую кнопку — обещать несуществующее.
 */
export function StudioFooter({ assembleLabel, canAssemble, placeLabel, onAssemble, onPlace, onCancel }: {
  assembleLabel: string;
  canAssemble: boolean;
  placeLabel: string | null;
  onAssemble: () => void;
  onPlace: () => void;
  onCancel: () => void;
}) {
  const accent: React.CSSProperties = {
    ...btnBase, background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 600,
  };
  return (
    <div style={{
      flex: 'none', display: 'flex', gap: sp(2), padding: pad(4, 6),
      borderTop: '1px solid var(--divider)',
    }}>
      <button
        type="button"
        onClick={onAssemble}
        disabled={!canAssemble}
        style={{ ...accent, opacity: canAssemble ? 1 : 0.5 }}
      >{assembleLabel}</button>
      {placeLabel !== null && (
        <button type="button" onClick={onPlace} style={accent}>{placeLabel}</button>
      )}
      <button
        type="button"
        onClick={onCancel}
        style={{
          ...btnBase, background: 'transparent', color: 'var(--text-body)',
          border: '1px solid var(--divider-strong)',
        }}
      >Отмена</button>
    </div>
  );
}

/**
 * Переписка со студией: что просили и что вышло.
 *
 * ⚠️ История нужна ровно затем, что сборка редко удаётся с первого раза, а причина отказа
 * («понял как список, но не собрал данные») — это подсказка, ЧТО переформулировать. Стереть её
 * следующей попыткой значило бы отнять у человека единственную обратную связь.
 */
export function TurnLog({ turns }: { turns: { phrase: string; answer: string }[] }) {
  if (turns.length === 0) return null;
  return (
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
  );
}

/**
 * Шапка студии: чем собираем и как закрыть.
 *
 * ⚠️ Метка модели стоит ЗДЕСЬ, а не только в настройках, потому что от неё зависит не скорость и
 * не цена, а ЧТО ПОЛУЧИТСЯ: локальная модель выбирает тип из каталога, облачная пишет разметку
 * (ярус 2, см. shared/genFree.ts). Уводить человека в настройки за ответом на вопрос «а кто
 * рисует эту плитку» — значит прятать развилку от того, кто на неё смотрит.
 *
 * ⚠️ Метка та же самая, что у чата и блокнота (ModelChip), и роль ей передана своя — «Генератор
 * виджетов». Своего переключателя у студии нет намеренно: он завёл бы второе место, где живёт
 * маршрут роли, и они бы разъехались.
 */
export function StudioHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: sp(3), padding: pad(4, 6),
      borderBottom: '1px solid var(--divider)', flex: 'none',
    }}>
      <span style={{ flex: 1, ...TEXT.title }}>{title}</span>
      <ModelChip role="widgets" align="right" drop="down" />
      <button onClick={onClose} title="Закрыть" style={iconBtn}><X size={16} /></button>
    </div>
  );
}
