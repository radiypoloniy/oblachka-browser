import { useState } from 'react';
import { PanelLeft, Plus, Settings, X, Cloud, Columns2 } from 'lucide-react';
import type { TabState } from '../../shared/ipc';

interface SidebarProps {
  tabs: TabState[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  onTabMenu: (id: string) => void;
  onSplit: (id: string) => void;  // войти в split с этой вкладкой как правой панелью
  onExitSplit: () => void;        // схлопнуть split, обе вкладки остаются открытыми
}

function FaviconTile({ tab, size = 16 }: { tab: TabState; size?: number }) {
  if (tab.isHub) {
    return (
      <span style={{
        width: size + 6, height: size + 6, borderRadius: 'var(--radius-sm)',
        background: 'var(--accent)', display: 'inline-flex', flex: 'none',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Cloud size={size} color="#fff" />
      </span>
    );
  }
  if (tab.faviconUrl) {
    return (
      <img src={tab.faviconUrl} width={size + 6} height={size + 6}
        style={{ borderRadius: 'var(--radius-sm)', flex: 'none', objectFit: 'cover' }}
        alt="" />
    );
  }
  let host = '?';
  try { host = new URL(tab.url).hostname.replace('www.', '')[0]?.toUpperCase() ?? '?'; }
  catch { /* about:blank и т.п. */ }
  return (
    <span style={{
      width: size + 6, height: size + 6, borderRadius: 'var(--radius-sm)',
      background: 'var(--neutral-300)', color: 'var(--text-body)', flex: 'none',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 600,
    }}>{host}</span>
  );
}

function TabRow({ tab, active, onClick, onClose, onContextMenu, onSplit, onExitSplit }: {
  tab: TabState; active: boolean; onClick: () => void; onClose: () => void;
  onContextMenu: () => void; onSplit?: () => void; onExitSplit?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const inSplit = tab.splitSide !== null;
  // Три визуальных состояния:
  //   active       → полная подсветка (surface + shadow + bold)
  //   inSplit      → лёгкая подсветка (surface-hover без shadow) — «припаркован»
  //   иначе        → прозрачный / hover при наведении
  const bg = active ? 'var(--surface)'
    : inSplit ? 'var(--surface-hover)'
    : hovered  ? 'var(--surface-hover)'
    : 'transparent';

  return (
    <div
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(); }}
      onMouseDown={(e) => {
        // Средний клик = закрыть (только незакреплённые — закреплённые защищены).
        if (e.button === 1) { e.preventDefault(); if (!tab.isHub && !tab.isPinned) onClose(); }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
        borderRadius: 'var(--radius-sm)', cursor: 'default',
        background: bg,
        boxShadow: active ? 'var(--shadow-card)' : 'none',
        color: active ? 'var(--text-strong)' : 'var(--text-body)',
        transition: 'background var(--dur-fast) var(--ease-standard)',
      }}
    >
      <FaviconTile tab={tab} />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', fontWeight: active ? 600 : 500,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{tab.title || tab.url || 'Загрузка…'}</span>

      {tab.isLoading && (
        <span style={{
          width: 12, height: 12, flex: 'none', borderRadius: '50%',
          border: '2px solid var(--divider-strong)', borderTopColor: 'var(--accent)',
          animation: 'oblako-spin 0.7s linear infinite',
        }} />
      )}

      {/* Индикатор split — кнопка «выйти из split» (обе вкладки остаются) */}
      {inSplit && onExitSplit && (
        <button
          className="no-drag"
          onClick={(e) => { e.stopPropagation(); onExitSplit(); }}
          title="Выйти из split (обе вкладки останутся)"
          style={{
            border: 'none', background: 'transparent', cursor: 'default',
            padding: 2, borderRadius: 4, display: 'inline-flex',
            color: 'var(--accent)', flex: 'none',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        ><Columns2 size={12} /></button>
      )}

      {/* Кнопка входа в split — при наведении на обычную неактивную вкладку */}
      {hovered && !tab.isHub && !tab.isPinned && !inSplit && !active && onSplit && (
        <button
          className="no-drag"
          onClick={(e) => { e.stopPropagation(); onSplit(); }}
          title="Открыть рядом"
          style={{
            border: 'none', background: 'transparent', cursor: 'default',
            padding: 2, borderRadius: 4, display: 'inline-flex',
            color: 'var(--text-faint)', flex: 'none',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        ><Columns2 size={14} /></button>
      )}

      {/* Кнопка закрытия — всегда видима для незакреплённых вкладок */}
      {!tab.isHub && !tab.isPinned && (
        <button
          className="no-drag"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Закрыть вкладку"
          style={{
            border: 'none', background: 'transparent', cursor: 'default',
            padding: 2, borderRadius: 4, display: 'inline-flex',
            color: 'var(--text-faint)', flex: 'none',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-sunken)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        ><X size={14} /></button>
      )}
    </div>
  );
}

// Базовые стили aside — одинаковы для обоих режимов.
const asideBase: React.CSSProperties = {
  flex: 'none', height: '100%', display: 'flex', flexDirection: 'column',
  background: 'var(--surface-island)',
  backdropFilter: 'var(--glass-filter)', WebkitBackdropFilter: 'var(--glass-filter)',
  boxShadow: 'inset -1px 0 0 var(--glass-edge)',
  overflow: 'hidden',
};

export default function Sidebar({ tabs, activeId, onSelect, onClose, onNewTab, onTabMenu, onSplit, onExitSplit }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  const hub = tabs.filter((t) => t.isHub);
  const pinned = tabs.filter((t) => t.isPinned && !t.isHub);
  const open = tabs.filter((t) => !t.isHub && !t.isPinned);

  // ── Свёрнутый режим: узкая полоса иконок ──
  if (collapsed) {
    return (
      <aside className="drag" style={{ ...asideBase, width: 56, alignItems: 'center', padding: '12px 0 14px' }}>

        {/* Логотип + кнопка развернуть */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, paddingBottom: 14 }}>
          <span style={{
            width: 24, height: 24, borderRadius: 7, background: 'var(--accent)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Cloud size={15} color="#fff" />
          </span>
          <button
            className="no-drag"
            onClick={() => setCollapsed(false)}
            title="Развернуть панель"
            style={{ ...iconBtn, transform: 'scaleX(-1)' }}
          >
            <PanelLeft size={17} />
          </button>
        </div>

        {/* Хаб + кнопка новой вкладки */}
        <div className="no-drag" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
          {hub.map((t) => (
            <button key={t.id} onClick={() => onSelect(t.id)} title={t.title}
              style={{
                border: 'none', cursor: 'default', padding: 4,
                borderRadius: 'var(--radius-sm)',
                background: activeId === t.id ? 'var(--surface)' : 'transparent',
                boxShadow: activeId === t.id ? 'var(--shadow-card)' : 'none',
              }}>
              <FaviconTile tab={t} size={18} />
            </button>
          ))}
          <button onClick={onNewTab} title="Новая вкладка"
            style={{
              width: 26, height: 26, borderRadius: 'var(--radius-sm)',
              border: '1px dashed var(--divider-strong)', background: 'transparent',
              cursor: 'default', display: 'inline-flex', alignItems: 'center',
              justifyContent: 'center', color: 'var(--text-faint)',
            }}>
            <Plus size={16} />
          </button>
        </div>

        {/* Закреплённые вкладки */}
        {pinned.length > 0 && (
          <div className="no-drag" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingBottom: 8, paddingTop: 4, borderBottom: '1px solid var(--divider-strong)', width: '100%' }}>
            {pinned.map((t) => (
              <button key={t.id} onClick={() => onSelect(t.id)}
                onContextMenu={(e) => { e.preventDefault(); onTabMenu(t.id); }}
                title={t.title}
                style={{
                  border: 'none', cursor: 'default', padding: 5,
                  borderRadius: 'var(--radius-sm)',
                  background: activeId === t.id ? 'var(--surface)' : 'transparent',
                  boxShadow: activeId === t.id ? 'var(--shadow-card)' : 'none',
                }}
                onMouseEnter={(e) => { if (activeId !== t.id) e.currentTarget.style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { if (activeId !== t.id) e.currentTarget.style.background = 'transparent'; }}
              >
                <FaviconTile tab={t} size={18} />
              </button>
            ))}
          </div>
        )}

        {/* Открытые вкладки — только favicon */}
        <div className="no-drag" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, overflowY: 'auto', flex: 1, paddingTop: 4 }}>
          {open.map((t) => (
            <button key={t.id} onClick={() => onSelect(t.id)} title={t.title}
              onContextMenu={(e) => { e.preventDefault(); onTabMenu(t.id); }}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onClose(t.id); } }}
              style={{
                border: 'none', cursor: 'default', padding: 5,
                borderRadius: 'var(--radius-sm)',
                background: activeId === t.id ? 'var(--surface)' : 'transparent',
                boxShadow: activeId === t.id ? 'var(--shadow-card)' : 'none',
              }}
              onMouseEnter={(e) => { if (activeId !== t.id) e.currentTarget.style.background = 'var(--surface-hover)'; }}
              onMouseLeave={(e) => { if (activeId !== t.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <FaviconTile tab={t} size={18} />
            </button>
          ))}
        </div>

        {/* Низ: настройки + аватар */}
        <div className="no-drag" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <button title="Настройки" style={iconBtn}><Settings size={17} /></button>
          <span style={{
            width: 28, height: 28, borderRadius: '50%', flex: 'none',
            background: 'linear-gradient(135deg, var(--accent), var(--accent-warm))',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 12, fontWeight: 600,
          }}>А</span>
        </div>
      </aside>
    );
  }

  // ── Развёрнутый режим ──
  return (
    <aside className="drag" style={{ ...asideBase, width: 256, padding: '12px 12px 14px' }}>

      {/* Шапка: логотип + кнопка свернуть */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px 14px' }}>
        <span style={{
          width: 24, height: 24, borderRadius: 7, background: 'var(--accent)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}><Cloud size={15} color="#fff" /></span>
        <span style={{ fontWeight: 700, fontSize: 'var(--fs-md)', color: 'var(--text-strong)' }}>Oblako</span>
        <div style={{ flex: 1 }} />
        <button className="no-drag" onClick={() => setCollapsed(true)} title="Свернуть панель" style={iconBtn}>
          <PanelLeft size={17} />
        </button>
      </div>

      {/* Хаб + кнопка новой вкладки */}
      <div className="no-drag" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 4px 14px' }}>
        {hub.map((t) => (
          <button key={t.id} onClick={() => onSelect(t.id)} title={t.title}
            style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 0 }}>
            <FaviconTile tab={t} size={20} />
          </button>
        ))}
        <button onClick={onNewTab} title="Новая вкладка"
          style={{
            width: 26, height: 26, borderRadius: 'var(--radius-sm)', flex: 'none',
            border: '1px dashed var(--divider-strong)', background: 'transparent',
            cursor: 'default', display: 'inline-flex', alignItems: 'center',
            justifyContent: 'center', color: 'var(--text-faint)',
          }}><Plus size={16} /></button>
      </div>

      {/* Закреплённые вкладки */}
      {pinned.length > 0 && (
        <>
          <div style={eyebrow}>Закреплённые</div>
          <div className="no-drag" style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 8, borderBottom: '1px solid var(--divider-strong)' }}>
            {pinned.map((t) => (
              <TabRow key={t.id} tab={t} active={activeId === t.id}
                onClick={() => onSelect(t.id)}
                onClose={() => onClose(t.id)}
                onContextMenu={() => onTabMenu(t.id)}
                onExitSplit={onExitSplit} />
            ))}
          </div>
        </>
      )}

      <div style={eyebrow}>Открытые вкладки</div>

      <div className="no-drag" style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', flex: 1 }}>
        {open.length === 0 && (
          <div style={{ padding: '8px 10px', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
            Пока пусто. Введите адрес в строке сверху.
          </div>
        )}
        {open.map((t) => (
          <TabRow key={t.id} tab={t} active={activeId === t.id}
            onClick={() => onSelect(t.id)}
            onClose={() => onClose(t.id)}
            onContextMenu={() => onTabMenu(t.id)}
            onSplit={() => onSplit(t.id)}
            onExitSplit={onExitSplit} />
        ))}
      </div>

      <button className="no-drag" onClick={onNewTab} style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 8,
        padding: '9px 12px', border: 'none', cursor: 'default',
        borderRadius: 'var(--radius-sm)', background: 'transparent',
        fontWeight: 500, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)',
      }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
        <Plus size={16} /> Новая вкладка
      </button>

      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, padding: '8px 8px 2px' }}>
        <span style={{
          width: 28, height: 28, borderRadius: '50%', flex: 'none',
          background: 'linear-gradient(135deg, var(--accent), var(--accent-warm))',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 12, fontWeight: 600,
        }}>А</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>Антон</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>Oblako Pro</div>
        </div>
        <button className="no-drag" title="Настройки" style={iconBtn}><Settings size={17} /></button>
      </div>
    </aside>
  );
}

const iconBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'default', padding: 6,
  borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', display: 'inline-flex',
};
const eyebrow: React.CSSProperties = {
  fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
  textTransform: 'uppercase', color: 'var(--text-faint)', padding: '0 10px 6px',
};
