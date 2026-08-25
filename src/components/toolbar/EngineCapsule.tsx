import type React from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { SEARCH_ENGINES, getSearchEngine } from '../../../shared/searchEngines';
import type { SearchEngineId } from '../../../shared/searchEngines';
import { glyph } from '../../styles/system';
import type { CapsuleMode } from './useOmniboxGeometry';

/**
 * Капсула выбора поисковика внутри омнибокса — и её меню.
 *
 * ⚠️ Только на хабе: на обычной странице в строке стоит адрес, и менять там поисковик не к чему.
 *
 * ⚠️ Схлопывается по тому же принципу, что VPN-пилюля: на дефолтном окне омнибокс узкий, полное
 * имя движка туда не влезает и вылезает за скруглённый край пилюли — поэтому ниже порога
 * показывается только первая буква, а на совсем узком капсула убирается вовсе (приоритет у поля
 * ввода, см. useOmniboxGeometry).
 *
 * ⚠️ Меню — ПОРТАЛ в body, та же техника, что у дропдауна подсказок: внутри омнибокса оно было бы
 * обрезано его же `overflow`. Прозрачный оверлей на весь экран закрывает по клику мимо.
 */
export function EngineCapsule({ mode, engineId, open, onToggle, onPick, btnRef }: {
  mode: CapsuleMode;
  engineId: SearchEngineId;
  open: boolean;
  onToggle: () => void;
  onPick: (id: SearchEngineId) => void;
  btnRef: RefObject<HTMLButtonElement>;
}): React.ReactElement | null {
  if (mode === 'hidden') return null;
  const engine = getSearchEngine(engineId);

  return (
    <>
      <button
        ref={btnRef}
        title={`Поисковик: ${engine.name}`}
        onClick={onToggle}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none',
          border: 'none', cursor: 'default', padding: mode === 'full' ? '4px 8px' : '4px 6px',
          borderRadius: 'var(--radius-sm)', background: 'var(--surface-hover)',
          color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        {mode === 'full' ? engine.name : engine.name.charAt(0)}
        <ChevronDown {...glyph(12)} />
      </button>
      {open && <EngineMenu btnRef={btnRef} engineId={engineId} onPick={onPick} onClose={onToggle} />}
    </>
  );
}

function EngineMenu({ btnRef, engineId, onPick, onClose }: {
  btnRef: RefObject<HTMLButtonElement>;
  engineId: SearchEngineId;
  onPick: (id: SearchEngineId) => void;
  onClose: () => void;
}): React.ReactElement | null {
  // Прямоугольник читается в момент отрисовки: меню живёт ровно столько, сколько открыто, и
  // подписываться на его переезд незачем — при ресайзе оно закрывается вместе с кликом мимо.
  const rect = btnRef.current?.getBoundingClientRect();
  if (!rect) return null;

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9000 }} />
      <div style={{
        position: 'fixed', top: rect.bottom + 6, left: rect.right - 140,
        width: 140, zIndex: 9001,
        background: 'var(--surface-solid)',
        borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-pop)',
        border: '1px solid var(--glass-edge)',
        overflow: 'hidden', padding: 4,
      }}>
        {SEARCH_ENGINES.map((engine) => {
          const current = engine.id === engineId;
          return (
            <div
              key={engine.id}
              onClick={() => onPick(engine.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 10px', borderRadius: 'var(--radius-sm)', cursor: 'default',
                fontSize: 'var(--fs-sm)',
                color: current ? 'var(--text-strong)' : 'var(--text-body)',
                fontWeight: current ? 600 : 400,
                background: current ? 'var(--surface-sunken)' : 'transparent',
              }}
              onMouseEnter={(e) => { if (!current) e.currentTarget.style.background = 'var(--surface-hover)'; }}
              onMouseLeave={(e) => { if (!current) e.currentTarget.style.background = 'transparent'; }}
            >
              {engine.name}
            </div>
          );
        })}
      </div>
    </>,
    document.body,
  );
}
