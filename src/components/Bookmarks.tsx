import { useEffect, useMemo, useState } from 'react';
import { X, Search, Star } from 'lucide-react';
import type { BookmarkEntry } from '../../shared/ipc';
import { islandPlate } from '../styles/island';

interface BookmarksProps {
  onClose: () => void;
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// Упрощённая копия History.tsx: без группировки по дням (закладки не хронология, порядок —
// position/id), без Qwen-«умного поиска» — список маленький, фильтр на клиенте достаточен,
// не нужен отдельный IPC-запрос на каждое нажатие.
export default function Bookmarks({ onClose }: BookmarksProps) {
  const [entries, setEntries] = useState<BookmarkEntry[]>([]);
  const [query, setQuery] = useState('');

  const load = async () => {
    setEntries(await window.oblako.listBookmarks());
  };

  useEffect(() => { void load(); }, []);
  // Мутация где угодно (например, звезду сняли прямо в омнибоксе, пока эта панель открыта) —
  // перечитываем список.
  useEffect(() => window.oblako.onBookmarksChanged(() => void load()), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q));
  }, [entries, query]);

  async function handleDelete(id: number) {
    await window.oblako.removeBookmark(id);
    void load();
  }

  return (
    <div style={{
      height: '100%', position: 'relative',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      // Тот же «остров», что у История/Настройки (Sidebar.tsx::asideBase) — совпадает
      // с CONTENT_CORNER_RADIUS обычной вкладки.
      ...islandPlate,
      borderRadius: 'var(--radius-island)',
      boxShadow: 'var(--shadow-island)',
      background: 'var(--surface-solid)',
    }}>
      {/* Заголовок */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '16px 20px 12px',
        borderBottom: '1px solid var(--divider)',
        flexShrink: 0,
      }}>
        <Star size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-strong)', flex: 1 }}>
          Закладки
        </span>
        <button
          onClick={onClose}
          title="Закрыть"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)',
            display: 'flex', alignItems: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Поиск — на всю ширину плиты, клиентский фильтр */}
      <div style={{ padding: '10px 20px', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          ...islandPlate,
          borderRadius: 'var(--radius-sm)', padding: '6px 10px',
        }}>
          <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск в закладках…"
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              fontSize: 13, color: 'var(--text-body)',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 2, color: 'var(--text-muted)', display: 'flex',
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', color: 'var(--text-muted)',
          fontSize: 13, marginTop: 48,
        }}>
          {query ? 'Ничего не найдено' : 'Нет закладок'}
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 16px' }}>
          {filtered.map((entry) => (
            <BookmarkRow key={entry.id} entry={entry} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function BookmarkRow({ entry, onDelete }: { entry: BookmarkEntry; onDelete: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);
  const domain = domainOf(entry.url);

  function handleNavigate() {
    void window.oblako.createTab(entry.url);
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 8px', borderRadius: 'var(--radius-sm)',
        background: hovered ? 'var(--surface-hover)' : 'transparent',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleNavigate}
    >
      {/* Нет хранимых favicon-урлов для закладок (BookmarkEntry их не несёт) — тот же фоллбэк,
          что у HistoryRow: буква домена на плашке. */}
      <span style={{
        width: 20, height: 20, borderRadius: 'var(--radius-sm)', flexShrink: 0,
        background: 'var(--neutral-300)', color: 'var(--text-body)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 600,
      }}>
        {domain.charAt(0).toUpperCase() || '?'}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: 'var(--fs-sm)', color: 'var(--text-strong)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {entry.title || entry.url}
        </span>
        <span style={{
          fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', flexShrink: 3,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {domain}
        </span>
      </div>
      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
          title="Удалить из закладок"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: 3, color: 'var(--text-muted)', display: 'flex',
            borderRadius: 'var(--radius-sm)', flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
