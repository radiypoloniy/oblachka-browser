import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Search, Trash2, Clock } from 'lucide-react';
import type { HistoryEntry, HistoryClearPeriod } from '../../shared/ipc';

interface HistoryProps {
  onClose: () => void;
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} д назад`;
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

const CLEAR_OPTIONS: { label: string; value: HistoryClearPeriod }[] = [
  { label: 'За последний час',    value: 'hour' },
  { label: 'За сегодня',          value: 'day'  },
  { label: 'За неделю',           value: 'week' },
  { label: 'За всё время',        value: 'all'  },
];

export default function History({ onClose }: HistoryProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [clearOpen, setClearOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const result = query.trim()
      ? await window.oblako.searchHistory(query)
      : await window.oblako.getHistory();
    setEntries(result);
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  async function handleDelete(id: number) {
    await window.oblako.deleteHistoryEntry(id);
    void load();
  }

  async function handleClear(period: HistoryClearPeriod) {
    await window.oblako.clearHistory(period);
    setClearOpen(false);
    void load();
  }

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'var(--app-bg)',
      display: 'flex', flexDirection: 'column',
      zIndex: 100,
    }}>
      {/* Заголовок */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '16px 20px 12px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <Clock size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-strong)', flex: 1 }}>
          История посещений
        </span>
        <button
          onClick={() => setClearOpen((v) => !v)}
          title="Очистить историю"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)',
            display: 'flex', alignItems: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <Trash2 size={15} />
        </button>
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

      {/* Дропдаун очистки */}
      {clearOpen && (
        <div style={{
          position: 'absolute', top: 52, right: 16,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-md)',
          zIndex: 200, overflow: 'hidden', minWidth: 180,
        }}>
          {CLEAR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => void handleClear(opt.value)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 14px', background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 13, color: 'var(--text-body)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Поиск */}
      <div style={{ padding: '10px 20px', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', padding: '6px 10px',
        }}>
          <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск в истории…"
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

      {/* Список */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 16px' }}
        onClick={() => { if (clearOpen) setClearOpen(false); }}
      >
        {entries.length === 0 ? (
          <div style={{
            textAlign: 'center', color: 'var(--text-muted)',
            fontSize: 13, marginTop: 48,
          }}>
            {query ? 'Ничего не найдено' : 'История пуста'}
          </div>
        ) : (
          entries.map((entry) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}

function HistoryRow({ entry, onDelete }: { entry: HistoryEntry; onDelete: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);

  function handleNavigate() {
    void window.oblako.createTab(entry.url);
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 8px', borderRadius: 'var(--radius-sm)',
        background: hovered ? 'var(--surface-hover)' : 'transparent',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleNavigate}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, color: 'var(--text-strong)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {entry.title || entry.url}
        </div>
        <div style={{
          fontSize: 11, color: 'var(--text-muted)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          marginTop: 1,
        }}>
          {entry.url}
        </div>
      </div>
      <div style={{
        fontSize: 11, color: 'var(--text-muted)',
        flexShrink: 0, whiteSpace: 'nowrap',
      }}>
        {formatRelativeTime(entry.lastVisit)}
      </div>
      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
          title="Удалить из истории"
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
