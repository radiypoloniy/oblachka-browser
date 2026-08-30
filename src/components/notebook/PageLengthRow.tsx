import { useEffect, useState } from 'react';
import { sp, pad, RADIUS, TEXT } from '../../styles/system';
import { CapsLabel } from '../settings/kit';
import type { PageLength } from '../../../shared/ipc';

/**
 * Объём страницы — прямо в «Студии», рядом с кнопкой, которая его тратит.
 *
 * ⚠️ Сначала я положил этот выбор в раздел «Модели»: длина ответа — свойство модели, и рядом
 * уже жил вопрос «когда загружать». Рассуждение верное, результат — нет: настройка оказалась в
 * самом низу списка моделей, за каталогом, и человек её просто не нашёл («не могу выбрать объём
 * страницы»). Место настройки решает не её родословная, а то, где о ней вспоминают.
 *
 * ⚠️ Подпись говорит про ВРЕМЯ, а не про знаки: платят им, и удивляет оно.
 */
const STEPS: { id: PageLength; label: string; hint: string }[] = [
  { id: 'short',  label: 'Кратко',   hint: '~4 тыс. знаков · полминуты' },
  { id: 'normal', label: 'Обычно',   hint: '~8 тыс. знаков · минута-полторы' },
  { id: 'long',   label: 'Подробно', hint: 'до 15 тыс. знаков · две-три минуты' },
];

export function PageLengthRow() {
  // ⚠️ Стартуем с 'normal', а не с null: при null контрол не рисовался вовсе, и любой сбой
  // канала превращался в «настройки просто нет» — молча. Значение по умолчанию совпадает с
  // тем, что вернёт main, поэтому подмены на глазах не происходит.
  const [value, setValue] = useState<PageLength>('normal');

  useEffect(() => {
    let alive = true;
    void window.oblako.getPageLength()
      .then((v) => { if (alive) setValue(v); })
      .catch(() => { /* останется значение по умолчанию — контрол виден в любом случае */ });
    return () => { alive = false; };
  }, []);

  const pick = (id: PageLength) => { setValue(id); void window.oblako.setPageLength(id); };
  const hint = STEPS.find((s) => s.id === value)?.hint;

  return (
    <div style={{ marginTop: sp(4) }}>
      <CapsLabel>Объём страницы</CapsLabel>
      <div style={{ display: 'flex', gap: sp(1) }}>
        {STEPS.map((s) => {
          const on = value === s.id;
          return (
            <button key={s.id} onClick={() => pick(s.id)} title={s.hint}
              style={{
                flex: 1, border: '1px solid',
                borderColor: on ? 'transparent' : 'var(--divider-strong)',
                background: on ? 'var(--section-tone)' : 'transparent',
                color: on ? 'var(--section-ink)' : 'var(--text-body)',
                padding: pad(2, 2), borderRadius: RADIUS.control, cursor: 'default',
                fontSize: 'var(--fs-xs)', fontWeight: 600, fontFamily: 'inherit',
              }}>
              {s.label}
            </button>
          );
        })}
      </div>
      <div style={{ ...TEXT.caption, color: 'var(--text-faint)', marginTop: sp(1) }}>{hint}</div>
    </div>
  );
}
