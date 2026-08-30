import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Trash2, Check } from 'lucide-react';
import { sp, pad, RADIUS, TEXT } from '../../styles/system';
import { islandPlate } from '../../styles/island';
import {
  loadNotebooks, notebookTitle, createNotebook, switchNotebook, deleteNotebook, renameNotebook,
  subscribeNotebook,
} from '../../newtab/notebook';

/**
 * Переключатель блокнотов: имя текущего, список остальных, «Новый».
 *
 * ⚠️ Заведён по живой жалобе: чтобы взяться за другую тему, приходилось УДАЛЯТЬ всё собранное
 * по прежней, и вернуться к ней было уже нельзя. Поэтому главное здесь не переключение, а то,
 * что старый блокнот никуда не девается: «Новый» ничего не стирает.
 *
 * ⚠️ Стоит в шапке источников, а не отдельной полосой: блокнот и есть его источники, и держать
 * его имя в одном месте с ними честнее, чем над всеми тремя колонками.
 */
export function NotebookSwitcher() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(() => loadNotebooks());
  const [editing, setEditing] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeNotebook(() => setState(loadNotebooks())), []);

  // Клик мимо закрывает список. Своя реализация, а не примитив: у настроек выпадающих списков нет.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const index = state.list.findIndex((n) => n.id === state.activeId);
  const current = state.list[index] ?? state.list[0]!;
  const title = notebookTitle(current, Math.max(0, index));

  return (
    <div ref={boxRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      {editing ? (
        <input
          autoFocus defaultValue={current.title || title}
          onBlur={(e) => { renameNotebook(current.id, e.target.value); setEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          style={{
            width: '100%', boxSizing: 'border-box', background: 'var(--surface-sunken)',
            border: '1px solid var(--divider-strong)', borderRadius: RADIUS.control,
            padding: '4px 8px', color: 'var(--text-strong)', fontSize: 'var(--fs-sm)',
            fontWeight: 700, fontFamily: 'inherit', outline: 'none',
          }}
        />
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          onDoubleClick={() => setEditing(true)}
          title="Сменить блокнот · двойной клик — переименовать"
          style={{
            display: 'flex', alignItems: 'center', gap: sp(1), width: '100%',
            border: 'none', background: 'transparent', cursor: 'default', padding: 0,
            color: 'var(--text-strong)', fontSize: 'var(--fs-sm)', fontWeight: 700,
            fontFamily: 'inherit', textAlign: 'left',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <ChevronDown size={14} style={{ flex: 'none', opacity: 0.5, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform var(--dur-fast, .15s)' }} />
        </button>
      )}

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: -4, zIndex: 40,
          minWidth: 260, maxWidth: 340, maxHeight: 340, overflowY: 'auto',
          ...islandPlate, borderRadius: RADIUS.box, background: 'var(--surface-solid)',
          boxShadow: 'var(--shadow-island)', padding: sp(1),
        }}>
          {state.list.map((n, i) => {
            const on = n.id === state.activeId;
            const ready = n.sources.filter((s) => s.status === 'ready').length;
            return (
              <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: sp(1) }}>
                <button
                  onClick={() => { switchNotebook(n.id); setOpen(false); }}
                  style={{
                    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: sp(2),
                    border: 'none', background: 'transparent', cursor: 'default',
                    padding: pad(2, 2), borderRadius: RADIUS.control, textAlign: 'left',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <Check size={13} style={{ flex: 'none', color: on ? 'var(--section-tone)' : 'transparent' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--text-strong)',
                      fontWeight: on ? 600 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{notebookTitle(n, i)}</span>
                    <span style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
                      {ready === 0 ? 'пусто' : `${ready} источн.`}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => deleteNotebook(n.id)}
                  title="Удалить блокнот"
                  style={{
                    flex: 'none', border: 'none', background: 'transparent', cursor: 'default',
                    padding: 5, borderRadius: RADIUS.control, color: 'var(--text-faint)',
                    display: 'inline-flex',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--danger-500)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}

          <div style={{ height: 1, background: 'var(--divider)', margin: `${sp(1)}px 0` }} />
          <button
            onClick={() => { createNotebook(); setOpen(false); }}
            style={{
              display: 'flex', alignItems: 'center', gap: sp(2), width: '100%',
              border: 'none', background: 'transparent', cursor: 'default',
              padding: pad(2, 2), borderRadius: RADIUS.control, textAlign: 'left',
              ...TEXT.body, color: 'var(--section-tone)', fontWeight: 600, fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--section-soft)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Plus size={14} /> Новый блокнот
          </button>
        </div>
      )}
    </div>
  );
}
