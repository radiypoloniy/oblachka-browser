import { useEffect, useState } from 'react';
import { CHROME_OVERLAY_PX } from '../../../shared/chromeGround';

/**
 * Кнопки окна — свернуть, развернуть-вернуть, закрыть. Рисуем их МЫ, а не Windows.
 *
 * ⚠️ Ради чего это заведено. Пока окно жило с `titleBarOverlay`, кнопки рисовала ОС в полосе,
 * которой нет в веб-раскладке, и красила её ОДНИМ СПЛОШНЫМ ЦВЕТОМ. Следствия были неустранимы в
 * принципе: градиент земли до полосы не доезжал (её приходилось красить отдельно вычисленным
 * «цветом верхней кромки»), затемнение под модалкой её не накрывало, а прозрачности у неё нет
 * (запрос в Electron открыт с 2022 года). Здесь полоса — обычный DOM: градиент идёт насквозь,
 * скрим её накрывает, палитра применяется сама.
 *
 * ⚠️ Цена принята сознательно: пропадает всплывашка Snap Layouts при наведении на разворачивание.
 * Для неё нужен нативный ответ HTMAXBUTTON на WM_NCHITTEST, которого Electron не отдаёт. Всё
 * остальное на месте — перетаскивание к краям, Win+Стрелки, Win+Z, двойной клик по полосе.
 */

/** Ширина кнопки — как у системной в Windows: мышечная память у людей уже под неё. */
const BTN_W = 46;

/**
 * ⚠️ ЗАЛИВКА ПРИ НАВЕДЕНИИ НЕЙТРАЛЬНАЯ ДАЖЕ У ЗАКРЫТИЯ, красным становится только глиф. В Windows
 * кнопка закрытия заливается сплошным красным, но у нас цветовой закон: заливка — язык акцента и
 * означает «выбрано», а красный принадлежит статусу и фона не красит. Сигнал при этом не теряется:
 * из трёх кнопок краснеет ровно одна, и этого достаточно, чтобы не промахнуться.
 */
const HOVER_BG = 'color-mix(in srgb, var(--text-strong) 9%, transparent)';
const ACTIVE_BG = 'color-mix(in srgb, var(--text-strong) 14%, transparent)';
const CLOSE_BG = 'color-mix(in srgb, var(--danger-500) 12%, transparent)';

function Glyph({ d, fill = 'none' }: { d: string; fill?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill={fill} stroke="currentColor" strokeWidth={1.2}>
      <path d={d} />
    </svg>
  );
}

function ControlButton({ label, danger, onClick, children }: {
  label: string; danger?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  const [state, setState] = useState<'rest' | 'hover' | 'active'>('rest');
  const bg = state === 'active' ? ACTIVE_BG : state === 'hover' ? (danger ? CLOSE_BG : HOVER_BG) : 'transparent';
  return (
    <button
      // ⚠️ no-drag обязателен: полоса целиком тянет окно (className="drag" на тулбаре), и без
      // этого нажатие превращалось бы в перетаскивание — кнопки просто не работали бы.
      className="no-drag"
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setState('hover')}
      onMouseLeave={() => setState('rest')}
      onMouseDown={() => setState('active')}
      onMouseUp={() => setState('hover')}
      style={{
        width: BTN_W, height: '100%', flex: 'none',
        border: 'none', background: bg, cursor: 'default', padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: state !== 'rest' && danger ? 'var(--danger-500)' : 'var(--text-body)',
        transition: 'background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)',
      }}
    >
      {children}
    </button>
  );
}

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => window.oblako.onWindowMaximized(setMaximized), []);

  return (
    // ⚠️ АБСОЛЮТНО ОТНОСИТЕЛЬНО ТУЛБАРА, а не участник его потока. Кнопки окна принадлежат РАМКЕ,
    // а не раскладке островов: тулбар прижимает содержимое отступом сверху (--gutter-shell), и в
    // потоке они не достали бы до верхнего края. Живой прогон поймал ровно это — кнопки вышли
    // высотой 11 px вместо 56.
    // ⚠️ Прижаты в САМЫЙ угол, без единого пикселя поля: в угол экрана человек попадает броском
    // курсора, не целясь (угол — бесконечно большая цель). Отступ это свойство убивает.
    <div style={{
      position: 'absolute', top: 0, right: 0, height: CHROME_OVERLAY_PX,
      display: 'flex', alignItems: 'stretch',
    }}>
      <ControlButton label="Свернуть" onClick={() => void window.oblako.minimizeWindow()}>
        <Glyph d="M1 6h10" />
      </ControlButton>
      <ControlButton
        label={maximized ? 'Вернуть размер' : 'Развернуть'}
        onClick={() => void window.oblako.toggleMaximizeWindow()}
      >
        {maximized
          // Два наложенных квадрата — общепринятый глиф «вернуть», его читают без подписи.
          ? <Glyph d="M1.5 4.5h6v6h-6zM3.9 4.5V2.4a.9.9 0 0 1 .9-.9h4.8a.9.9 0 0 1 .9.9v4.8a.9.9 0 0 1-.9.9H7.5" />
          : <Glyph d="M1.5 1.5h9v9h-9z" />}
      </ControlButton>
      <ControlButton label="Закрыть" danger onClick={() => void window.oblako.closeWindow()}>
        <Glyph d="M1.7 1.7l8.6 8.6M10.3 1.7l-8.6 8.6" />
      </ControlButton>
    </div>
  );
}
