import { useEffect, useState } from 'react';
import { RADIUS } from '../styles/system';
import type { AiActivityState } from '../../shared/ipc';

/**
 * «ИИ сейчас работает» — светодиод, что именно идёт, и кнопка остановки.
 *
 * ⚠️ Живёт В ПАНЕЛИ, а не только на экране, где работу заказали. Причина из жалобы: человек
 * закрыл Студию, генерация продолжалась фоном, и узнать об этом было неоткуда — браузер просто
 * «жрал процессор сам по себе». Панель открыта чаще любого другого AI-экрана, поэтому признак
 * занятости живёт здесь.
 *
 * ⚠️ Зелёный — `--dot-local`, тот же, которым помечена модель «на этой машине». Это не выбор
 * оттенка по вкусу: цвет уже означает ровно это — работа идёт локально, ничего не улетает.
 *
 * ⚠️ «Стоп» СЛОВОМ, а не крестиком. Крестик рядом с индикатором читается как «скрыть
 * индикатор», а не «прервать работу», и цена ошибки здесь несимметрична.
 */
export function AiActivityPill() {
  const [state, setState] = useState<AiActivityState | null>(null);

  useEffect(() => {
    void window.aiPanel.aiActivity().then(setState);
    return window.aiPanel.onAiActivity(setState);
  }, []);

  if (!state) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      margin: '8px var(--pad-island) 0',
      padding: '6px 6px 6px 10px',
      borderRadius: RADIUS.pill,
      background: 'var(--surface-sunken)',
      border: '1px solid var(--divider)',
      flexShrink: 0,
    }}>
      <span className="oblako-led" style={{
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
        background: 'var(--dot-local)',
        boxShadow: '0 0 0 3px color-mix(in srgb, var(--dot-local) 22%, transparent)',
      }} />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-body)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {state.label}
        {/* Число знаков — единственный честный признак движения: сколько всего их будет,
            не знает никто, модель останавливается сама. */}
        {state.chars > 0 && (
          <span style={{ color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>
            {' · '}{state.chars.toLocaleString('ru-RU')} зн.
          </span>
        )}
      </span>
      <button
        onClick={() => void window.aiPanel.cancelAi()}
        style={{
          flexShrink: 0, border: 'none', borderRadius: RADIUS.pill, cursor: 'pointer',
          padding: '4px 10px', fontSize: 'var(--fs-xs)', fontWeight: 600,
          background: 'var(--surface-solid)', color: 'var(--text-strong)',
          fontFamily: 'inherit',
        }}
      >
        Стоп
      </button>
    </div>
  );
}
