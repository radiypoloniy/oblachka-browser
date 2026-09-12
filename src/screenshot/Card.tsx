// Карточка снимка — правый нижний угол контента. Жест не меняется: Ctrl+S, Esc, автоскрытие.

import type { CSSProperties, ReactElement, Ref } from 'react';
import { Copy, FolderOpen, X, Check, Pencil } from 'lucide-react';
import { islandPlate } from '../styles/island';

export const CARD_WIDTH = 320;
export const SHADOW_MARGIN = 24;
const PREVIEW_MAX_H = 190;

const iconBtn: CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--text-muted)',
  padding: 6, borderRadius: 'var(--radius-sm)', cursor: 'default',
  display: 'inline-flex', alignItems: 'center', flex: 'none',
};

const saveBtn: CSSProperties = {
  border: 'none', background: 'var(--accent)', color: 'var(--on-accent)',
  padding: '6px 10px', borderRadius: 'var(--radius-sm)', cursor: 'default',
  display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none',
  fontSize: 'var(--fs-sm)', fontWeight: 500, fontFamily: 'inherit',
};

export function ShotCard(props: {
  shot: string;
  saved: string | null;
  failed: boolean;
  copied: boolean;
  life: { ms: number; at: number } | null;
  onCopy: () => void;
  onSave: () => void;
  onEdit: () => void;
  onClose: () => void;
  onReveal: (file: string) => void;
  onHover: (over: boolean) => void;
  cardRef: Ref<HTMLDivElement>;
}): ReactElement {
  const status = props.failed ? 'Не удалось сохранить'
    : props.saved ? 'Сохранено в «Загрузки»'
    : props.copied ? 'Скопировано'
    : '';
  const done = !!props.saved || props.copied;

  return (
    <div
      style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}
      onMouseEnter={() => props.onHover(true)}
      onMouseLeave={() => props.onHover(false)}
    >
      <div ref={props.cardRef} className="oblako-shot-card" style={{
        width: CARD_WIDTH, ...islandPlate,
        borderRadius: 'var(--radius-card)', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {props.life && (
          <div style={{ height: 2, background: 'var(--divider)', flex: 'none' }}>
            <div
              key={props.life.at}
              className="oblako-shot-life"
              style={{ height: '100%', background: 'var(--text-faint)', opacity: 0.45,
                animationDuration: `${props.life.ms}ms` }}
            />
          </div>
        )}
        <div style={{ padding: 10, paddingBottom: 0 }}>
          <img src={props.shot} alt="" style={{
            display: 'block', width: '100%', maxHeight: PREVIEW_MAX_H,
            objectFit: 'contain', objectPosition: 'center',
          }} />
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
        }}>
          <span style={{
            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 'var(--fs-xs)', color: props.failed ? 'var(--text)' : 'var(--text-muted)',
          }}>
            {done && (
              <span style={{
                width: 15, height: 15, borderRadius: 'var(--radius-pill)', flex: 'none',
                display: 'grid', placeItems: 'center',
                background: 'var(--success-500)', color: 'var(--app-bg)',
              }}><Check size={9} strokeWidth={3.5} /></span>
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{status}</span>
          </span>

          {props.saved ? (
            <button onClick={() => props.onReveal(props.saved!)} title="Показать в папке" style={iconBtn}>
              <FolderOpen size={15} />
            </button>
          ) : (
            <>
              <button onClick={props.onCopy} title="Копировать" style={iconBtn}>
                <Copy size={15} />
              </button>
              <button onClick={props.onEdit} title="Редактировать" style={iconBtn}>
                <Pencil size={15} />
              </button>
              <button onClick={props.onSave} style={saveBtn}>
                Сохранить
                <span style={{ opacity: 0.75, fontSize: 'var(--fs-xs)' }}>Ctrl+S</span>
              </button>
            </>
          )}
          <button onClick={props.onClose} title="Закрыть (Esc)" style={iconBtn}>
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
