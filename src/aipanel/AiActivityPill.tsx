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
 * ⚠️ ЦВЕТ СВЕТОДИОДА — ЭТО УТВЕРЖДЕНИЕ, а не украшение: зелёный `--dot-local` означает «считается
 * здесь, текст никуда не улетает», бирюзовый `--dot-cloud` — «ушло в облако». Тот же язык, что у
 * метки модели в чатах. Пока цвет был зашит зелёным, индикатор врал ровно в том месте, ради
 * которого весь слой маршрутов и заводился.
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

  const dot = state.local ? '--dot-local' : '--dot-cloud';

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
        background: `var(${dot})`,
        boxShadow: `0 0 0 3px color-mix(in srgb, var(${dot}) 22%, transparent)`,
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
        {/* ⚠️ Забытая фоновая работа не должна пропадать за свежей: показываем самую свежую, а
            остальные — числом. Ради этого признака индикатор и заведён. */}
        {state.count > 1 && (
          <span style={{ color: 'var(--text-faint)' }}>{' · и ещё '}{state.count - 1}</span>
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
        {state.count > 1 ? 'Стоп всё' : 'Стоп'}
      </button>
    </div>
  );
}
