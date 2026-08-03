import { useEffect, useMemo, useState } from 'react';
import { X, Search, Star, Download, Loader2, Folder } from 'lucide-react';
import type { BookmarkEntry, BookmarkNode, BookmarkImportSource } from '../../shared/ipc';
import { islandPlate } from '../styles/island';

// Ссылка вместе с именем папки, в которой лежит — панель плоская, и без этого нельзя понять,
// откуда запись. null — корень.
type FlatBookmark = BookmarkEntry & { folderTitle: string | null };

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
  const [entries, setEntries] = useState<FlatBookmark[]>([]);
  const [query, setQuery] = useState('');
  // Импорт из других браузеров (Feature 2) — открытый дропдаун со списком РЕАЛЬНО найденных на
  // диске источников (см. electron/bookmarkImport/), тот же паттерн, что clearOpen в History.tsx.
  const [importOpen, setImportOpen] = useState(false);
  const [importSources, setImportSources] = useState<BookmarkImportSource[]>([]);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  // ⚠️ Читаем ДЕРЕВО и раскладываем в плоский список ссылок, а не берём корень через
  // listBookmarks(). Иначе закладка, убранная в папку из сайдбара, пропадала бы из этой панели
  // совсем — а она тут архив и поиск по всему, что сохранено. Сами папки строками не рисуем:
  // эта панель отвечает на вопрос «где я это сохранял», а не «как разложено».
  const load = async () => {
    const flat: FlatBookmark[] = [];
    const walk = (nodes: BookmarkNode[], folder: string | null): void => {
      for (const n of nodes) {
        if (n.kind === 'folder') walk(n.children ?? [], n.title);
        else flat.push({ ...n, folderTitle: folder });
      }
    };
    walk(await window.oblako.listBookmarkTree(), null);
    setEntries(flat);
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

  async function toggleImport() {
    if (importOpen) { setImportOpen(false); return; }
    setImportOpen(true);
    setImportMessage(null);
    setImportSources(await window.oblako.listBookmarkImportSources());
  }

  async function handleImport(source: BookmarkImportSource) {
    if (importingId) return; // уже что-то импортируется — второй клик игнорируем
    setImportingId(source.id);
    setImportMessage(null);
    try {
      const result = await window.oblako.runBookmarkImport(source.id);
      setImportMessage(
        result
          ? `${source.label}: добавлено ${result.inserted}, пропущено (уже были) ${result.skipped}`
          : `${source.label}: импорт не удался`,
      );
      void load(); // BOOKMARK_CHANGED тоже перечитает, но не ждём push ради мгновенного отклика
    } finally {
      setImportingId(null);
    }
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
        <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)', color: 'var(--text-strong)', flex: 1 }}>
          Закладки
        </span>
        <button
          onClick={() => void toggleImport()}
          title="Импортировать из другого браузера"
          style={{
            background: importOpen ? 'var(--surface-hover)' : 'none', border: 'none', cursor: 'pointer', padding: 4,
            color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)',
            display: 'flex', alignItems: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = importOpen ? 'var(--surface-hover)' : 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <Download size={15} />
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

      {/* Дропдаун импорта — список реально найденных браузеров (пусто, если ни один Chromium-
          профиль не найден на диске). Позиционирование — тот же приём, что clearOpen в History.tsx. */}
      {importOpen && (
        <div style={{
          position: 'absolute', top: 52, right: 52,
          ...islandPlate,
          borderRadius: 'var(--radius-card)',
          zIndex: 200, overflow: 'hidden', minWidth: 200,
        }}>
          {importSources.length === 0 ? (
            <div style={{ padding: '10px 14px', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
              Ни один браузер не найден
            </div>
          ) : importSources.map((source) => (
            <button
              key={source.id}
              onClick={() => void handleImport(source)}
              disabled={importingId !== null}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                padding: '8px 14px', background: 'none', border: 'none',
                cursor: importingId ? 'default' : 'pointer', fontSize: 'var(--fs-sm)', color: 'var(--text-body)',
              }}
              onMouseEnter={(e) => { if (!importingId) e.currentTarget.style.background = 'var(--surface-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
            >
              {importingId === source.id && <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />}
              {source.label}
            </button>
          ))}
        </div>
      )}

      {importMessage && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 20px', fontSize: 'var(--fs-sm)',
          color: 'var(--text-muted)', flexShrink: 0,
        }}>
          {importMessage}
          <button
            onClick={() => setImportMessage(null)}
            style={{
              marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
              color: 'inherit', display: 'flex', padding: 2,
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}

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
              fontSize: 'var(--fs-sm)', color: 'var(--text-body)',
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
          fontSize: 'var(--fs-sm)', marginTop: 48,
        }}>
          {query ? 'Ничего не найдено' : 'Нет закладок'}
        </div>
      ) : (
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '0 20px 16px' }}>
          {filtered.map((entry) => (
            <BookmarkRow key={entry.id} entry={entry} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function BookmarkRow({ entry, onDelete }: { entry: FlatBookmark; onDelete: (id: number) => void }) {
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
        fontSize: 'var(--fs-xs)', fontWeight: 600,
      }}>
        {domain.charAt(0).toUpperCase() || '?'}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          flex: 1, minWidth: 0,
          fontSize: 'var(--fs-sm)', color: 'var(--text-strong)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {entry.title || entry.url}
        </span>
        {/* Папка — перед доменом: список плоский, и без неё нельзя понять, откуда запись.
            У корневых закладок метки нет вовсе, пустой значок папки только шумел бы. */}
        {entry.folderTitle && (
          <span style={{
            flexShrink: 2, minWidth: 0, display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            <Folder size={11} strokeWidth={2} style={{ flexShrink: 0 }} />
            {entry.folderTitle}
          </span>
        )}
        <span style={{
          flexShrink: 3, minWidth: 0,
          fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
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
