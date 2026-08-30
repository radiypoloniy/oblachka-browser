import { Play, Square } from 'lucide-react';
import { RADIUS, sp } from '../../styles/system';

// Полоса прогона: посчитать всё, что происходит сейчас, остановить.
//
// ⚠️ Внизу по центру, а не в углу шапки. После того как человек разложил граф, взгляд у него
// внизу холста — там, где он только что тянул связь, — а кнопка запуска сидела в верхней
// строке рядом с восемнадцатью кнопками узлов, то есть в самом занятом месте экрана.
//
// ⚠️ Полоса говорит, ЧТО именно считается, а не только «идёт». Прежний вид отвечал одним битом:
// кнопка гасла и появлялась «Остановить». В графе из десяти узлов этого мало — непонятно,
// движется ли прогон вообще.

export default function RunBar({ running, nowTitle, queued, canRun, onRun, onStop }: {
  running: boolean;
  /** Название узла, который считается прямо сейчас. Пусто — прогон ещё раскачивается. */
  nowTitle: string | null;
  /** Сколько узлов ждёт своей очереди. */
  queued: number;
  canRun: boolean;
  onRun: () => void;
  onStop: () => void;
}) {
  const status = running
    ? [nowTitle ? `Считается: ${nowTitle}` : 'Готовится', queued > 0 ? `ещё ${queued} в очереди` : '']
      .filter(Boolean).join(' · ')
    : '';

  return (
    <div
      style={{
        position: 'absolute', left: '50%', transform: 'translateX(-50%)',
        bottom: sp(4), zIndex: 4,
        display: 'flex', alignItems: 'center', gap: sp(3), maxWidth: 'calc(100% - 48px)',
        padding: `5px 5px 5px ${sp(4)}px`,
        background: 'var(--surface-island)', border: '1px solid var(--divider)',
        borderRadius: RADIUS.pill,
        boxShadow: 'var(--shadow-island, 0 6px 20px -10px rgba(0,0,0,.3))',
      }}
    >
      {status && (
        <span
          style={{
            fontSize: 'var(--fs-xs)', letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase',
            color: 'var(--text-muted)', minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {status}
        </span>
      )}

      {running ? (
        <button
          type="button"
          onClick={onStop}
          title="Текущий узел досчитается — прервать генерацию модели нельзя"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none',
            background: 'var(--surface-sunken)', border: '1px solid var(--divider)',
            borderRadius: RADIUS.pill, padding: '7px 15px', cursor: 'pointer',
            color: 'var(--text-body)', font: 'inherit',
            fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)',
          }}
        >
          <Square size={13} />
          Остановить
        </button>
      ) : (
        <button
          type="button"
          onClick={onRun}
          disabled={!canRun}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none',
            background: canRun ? 'var(--accent)' : 'var(--surface-sunken)',
            color: canRun ? 'var(--text-on-accent)' : 'var(--text-muted)',
            border: 0, borderRadius: RADIUS.pill, padding: '7px 17px',
            cursor: canRun ? 'pointer' : 'default', font: 'inherit',
            fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <Play size={14} />
          Посчитать всё
        </button>
      )}
    </div>
  );
}
