import { useEffect, useMemo, useState } from 'react';
import { X, Search, Star, Download, Loader2, Folder, Sparkles } from 'lucide-react';
import type { BookmarkEntry, BookmarkNode, BookmarkFolderProposal, BookmarkImportSource } from '../../shared/ipc';
import { islandPlate, untintedPlateVars } from '../styles/island';
import { panelIsland } from '../styles/system';
import SiteFavicon from './SiteFavicon';
import { EmptyState } from './EmptyState';
import { StarGlyph, SearchGlyph } from './glyphs';

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
  // Дерево держим рядом с плоским списком: колонка папок строится из него, а список — из
  // плоского. Один запрос, два представления — иначе счётчики разошлись бы с содержимым.
  const [tree, setTree] = useState<BookmarkNode[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  // Умная раскладка. 'idle' → 'computing' → 'preview'. ⚠️ Между computing и применением стоит
  // ЯВНОЕ согласие человека: раскладка не применяется сама ни при каком исходе.
  const [organize, setOrganize] = useState<'idle' | 'computing' | 'preview'>('idle');
  const [proposals, setProposals] = useState<BookmarkFolderProposal[]>([]);
  // Папки, от которых человек отказался прямо в предложении: применяем только оставшиеся.
  const [dropped, setDropped] = useState<Set<string>>(new Set());
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
    const roots = await window.oblako.listBookmarkTree();
    const flat: FlatBookmark[] = [];
    const walk = (nodes: BookmarkNode[], folder: string | null): void => {
      for (const n of nodes) {
        if (n.kind === 'folder') walk(n.children ?? [], n.title);
        else flat.push({ ...n, folderTitle: folder });
      }
    };
    walk(roots, null);
    setTree(roots);
    setEntries(flat);
  };

  useEffect(() => { void load(); }, []);
  // Мутация где угодно (например, звезду сняли прямо в омнибоксе, пока эта панель открыта) —
  // перечитываем список.
  useEffect(() => window.oblako.onBookmarksChanged(() => void load()), []);

  const searching = query.trim().length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q));
  }, [entries, query]);

  // Содержимое выбранной папки. null — «Все закладки», то есть весь сейф целиком: раздел это
  // архив, и ответ на «где-то у меня это было» должен находиться без хождения по папкам.
  const visible = useMemo(
    () => (folderId === null ? entries : entries.filter((e) => e.parentId === folderId)),
    [entries, folderId],
  );

  // Быстрый доступ по id — предложение раскладки приходит номерами, а показать надо названия.
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  // Кнопка раскладки нужна, только когда есть что раскладывать: разбираем корень.
  const rootLinkCount = useMemo(() => entries.filter((e) => e.parentId === null).length, [entries]);

  // Плоский перечень папок с отступами и счётчиками. Считается из того же дерева, что и список:
  // второй источник правды здесь означал бы расхождение счётчиков с содержимым.
  const folderNav = useMemo(() => {
    const out: { id: number; title: string; depth: number; count: number }[] = [];
    const walk = (nodes: BookmarkNode[], depth: number): void => {
      for (const n of nodes) {
        if (n.kind !== 'folder') continue;
        // Считаем ТОЛЬКО прямые ссылки: цифра рядом с папкой должна совпадать с тем, что
        // человек увидит, кликнув по ней, — иначе она врёт про вложенные.
        out.push({
          id: n.id, title: n.title, depth,
          count: (n.children ?? []).filter((c) => c.kind === 'link').length,
        });
        walk(n.children ?? [], depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree]);

  async function handleDelete(id: number) {
    await window.oblako.removeBookmark(id);
    void load();
  }

  // ⚠️ Удаление папки уносит ВСЁ её содержимое (CASCADE в схеме) и отменить это нечем —
  // спрашиваем прямо, с числом закладок внутри. Молча тут не делается ничего.
  async function handleDeleteFolder(id: number, title: string, count: number) {
    const what = count > 0 ? ` вместе с ${count} закладками` : '';
    if (!window.confirm(`Удалить папку «${title}»${what}? Это действие нельзя отменить.`)) return;
    if (folderId === id) setFolderId(null);
    await window.oblako.removeBookmark(id);
    void load();
  }

  async function runOrganize() {
    setOrganize('computing');
    setDropped(new Set());
    const result = await window.oblako.suggestBookmarkFolders().catch(() => []);
    setProposals(result);
    setOrganize('preview');
  }

  async function applyOrganize() {
    const keep = proposals.filter((p) => !dropped.has(p.label));
    setOrganize('idle');
    if (keep.length === 0) return;
    await window.oblako.applyBookmarkFolders(keep);
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
      ...panelIsland(),
      ...untintedPlateVars,
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

      {/* Раскладка — та же, что у Истории: узкая навигация слева, список справа. Там слева
          даты, здесь папки; в остальном это одна и та же страница-архив, и разводить их по
          разным формам значило бы заставить человека учить второй интерфейс ради того же
          действия. ⚠️ При поиске колонка папок ПРЯЧЕТСЯ: искать положено по всему сейфу, а не
          внутри выбранной папки, иначе найденное молча зависит от того, что выбрано слева. */}
      {searching ? (
        filtered.length === 0 ? (
          <Empty text="Ничего не найдено" />
        ) : (
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '0 20px 16px' }}>
            {filtered.map((entry) => (
              <BookmarkRow key={entry.id} entry={entry} onDelete={handleDelete} />
            ))}
          </div>
        )
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          <nav style={{
            width: 170, flexShrink: 0, overflowY: 'auto',
            padding: '10px 8px 16px', borderRight: '1px solid var(--divider)',
          }}>
            <FolderNavItem
              label="Все закладки" count={entries.length}
              active={folderId === null} onClick={() => setFolderId(null)} depth={0}
            />
            {folderNav.map((f) => (
              <FolderNavItem
                key={f.id} label={f.title} count={f.count} depth={f.depth}
                active={folderId === f.id} onClick={() => setFolderId(f.id)}
                onDelete={() => void handleDeleteFolder(f.id, f.title, f.count)}
              />
            ))}

            {/* Умная раскладка живёт ЗДЕСЬ, в колонке папок, а не в шапке: она про то, какие
                папки будут, то есть про эту колонку. Кнопки нет, пока раскладывать нечего. */}
            {rootLinkCount >= 4 && (
              <button
                onClick={() => void runOrganize()}
                disabled={organize === 'computing'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                  marginTop: 10, padding: '6px 10px', border: 'none', background: 'none',
                  borderRadius: 'var(--radius-sm)', cursor: 'default',
                  fontSize: 'var(--fs-xs)', color: 'var(--accent)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
              >
                <Sparkles size={12} strokeWidth={2} style={{ flexShrink: 0 }} />
                {organize === 'computing' ? 'Разбираю…' : 'Разложить по папкам'}
              </button>
            )}
          </nav>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '0 20px 16px' }}>
            {organize === 'preview' ? (
              <OrganizePreview
                proposals={proposals} dropped={dropped} setDropped={setDropped}
                byId={byId}
                onApply={() => void applyOrganize()}
                onCancel={() => setOrganize('idle')}
              />
            ) : visible.length === 0 ? (
              <Empty text={folderId === null ? 'Нет закладок' : 'В этой папке пусто'} />
            ) : visible.map((entry) => (
              <BookmarkRow key={entry.id} entry={entry} onDelete={handleDelete} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Предложение раскладки. ⚠️ Ничего ещё не применено: пока человек не нажал «Разложить», в базе
// не изменилось ни строки. Каждую папку можно выкинуть из предложения по отдельности — иначе
// выбор был бы «всё или ничего», и одна неудачная папка отменяла бы девять удачных.
function OrganizePreview({ proposals, dropped, setDropped, byId, onApply, onCancel }: {
  proposals: BookmarkFolderProposal[];
  dropped: Set<string>;
  setDropped: (s: Set<string>) => void;
  byId: Map<number, FlatBookmark>;
  onApply: () => void;
  onCancel: () => void;
}) {
  const keep = proposals.filter((p) => !dropped.has(p.label));
  const total = keep.reduce((n, p) => n + p.ids.length, 0);

  if (proposals.length === 0) {
    return (
      <div style={{ paddingTop: 24 }}>
        <Empty text="Осмысленных папок не нашлось — закладки слишком разные. Это нормальный исход." />
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <button onClick={onCancel} style={GHOST_BTN}>Закрыть</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ paddingTop: 12 }}>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 12 }}>
        Предложение: {keep.length} {keep.length === 1 ? 'папка' : keep.length < 5 ? 'папки' : 'папок'},
        {' '}{total} закладок. Ничего ещё не изменено — папки создадутся только по кнопке ниже.
      </div>

      {proposals.map((p) => {
        const off = dropped.has(p.label);
        return (
          <div key={p.label} style={{
            border: '1px solid var(--divider-strong)', borderRadius: 'var(--radius-sm)',
            marginBottom: 8, overflow: 'hidden', opacity: off ? 0.45 : 1,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', background: 'var(--surface-hover)',
            }}>
              <Folder size={13} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
              <span style={{ flex: 1, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
                {p.label}
              </span>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{p.ids.length}</span>
              <button
                onClick={() => {
                  const next = new Set(dropped);
                  if (off) next.delete(p.label); else next.add(p.label);
                  setDropped(next);
                }}
                style={{ ...GHOST_BTN, padding: '2px 8px', fontSize: 'var(--fs-xs)' }}
              >{off ? 'Вернуть' : 'Не надо'}</button>
            </div>
            <div style={{ padding: '4px 10px 8px' }}>
              {p.ids.map((id) => (
                <div key={id} style={{
                  fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', padding: '2px 0',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {byId.get(id)?.title || byId.get(id)?.url || `#${id}`}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button
          onClick={onApply}
          disabled={keep.length === 0}
          style={{
            padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: 'none',
            background: keep.length ? 'var(--accent)' : 'var(--surface-hover)',
            color: keep.length ? 'var(--on-accent)' : 'var(--text-faint)',
            fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'default',
          }}
        >Разложить</button>
        <button onClick={onCancel} style={GHOST_BTN}>Отмена</button>
      </div>
    </div>
  );
}

const GHOST_BTN: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--divider-strong)', background: 'transparent',
  color: 'var(--text-body)', fontSize: 'var(--fs-sm)', cursor: 'default',
};

// Пустое состояние закладок. ⚠️ Подсказка зависит от того, ПОЧЕМУ пусто: не найдено по запросу,
// пусто в папке или закладок нет вовсе — это три разные ситуации и три разных следующих шага.
function Empty({ text }: { text: string }) {
  const searching = text === 'Ничего не найдено';
  const inFolder = text === 'В этой папке пусто';
  return (
    <EmptyState
      icon={searching ? <SearchGlyph size={22} /> : <StarGlyph size={22} />}
      title={searching ? 'Ничего не нашлось' : inFolder ? 'В этой папке пусто' : 'Закладок пока нет'}
      hint={searching
        ? 'Поиск идёт по названию и адресу — попробуйте другое слово.'
        : inFolder
          ? 'Перетащите сюда закладку из другой папки или добавьте новую звёздочкой в адресной строке.'
          : 'Звёздочка в адресной строке сохранит страницу сюда, а папку под неё браузер предложит сам.'}
    />
  );
}

// Строка навигации по папкам — визуально та же, что строка даты в Истории. Отступ показывает
// вложенность: дерево тут плоское списком, потому что папок у человека десятки, а не тысячи,
// и раскрывающиеся уровни в колонке 170 px читались бы хуже, чем один сплошной перечень.
function FolderNavItem({ label, count, active, onClick, depth, onDelete }: {
  label: string; count: number; active: boolean; onClick: () => void; depth: number;
  /** Нет у «Все закладки» — это не папка, удалять там нечего. */
  onDelete?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
    <button
      onClick={onClick}
      // ПКМ — как у вкладок и групп в сайдбаре: удаление папки живёт в меню, а не кнопкой
      // по наведению. Оно разрушительное, и случайно попасть по нему быть не должно.
      onContextMenu={(e) => { if (onDelete) { e.preventDefault(); setMenu(true); } }}
      onBlur={() => setMenu(false)}
      title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
        padding: '6px 10px', paddingLeft: 10 + depth * 12, marginBottom: 1,
        border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'default',
        background: active ? 'var(--surface-hover)' : 'none',
        fontSize: 'var(--fs-xs)', color: active ? 'var(--text-strong)' : 'var(--text-body)',
        fontWeight: active ? 600 : 400,
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = active ? 'var(--surface-hover)' : 'none'; }}
    >
      <Folder size={12} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--text-faint)' }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span style={{ flexShrink: 0, color: 'var(--text-faint)' }}>{count || ''}</span>
    </button>
    {menu && onDelete && (
      <div style={{
        position: 'absolute', top: '100%', left: 10, zIndex: 50,
        ...islandPlate, borderRadius: 'var(--radius-sm)', overflow: 'hidden', minWidth: 150,
      }}>
        <button
          // onMouseDown, а не onClick: onBlur кнопки-папки успевает закрыть меню раньше клика.
          onMouseDown={() => { setMenu(false); onDelete(); }}
          style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
            border: 'none', background: 'none', cursor: 'default',
            fontSize: 'var(--fs-sm)', color: 'var(--danger-500)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
        >Удалить папку…</button>
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
        display: 'flex', alignItems: 'center', gap: 12,
        // Просторнее и крупнее — тот же шаг, что в строке Истории: это главный список раздела,
        // а он читался как плотная таблица.
        padding: '9px 10px', borderRadius: 'var(--radius-sm)',
        background: hovered ? 'var(--surface-hover)' : 'transparent',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleNavigate}
    >
      {/* Настоящий значок сайта — тот же компонент, что в Истории: закладку узнают по нему
          быстрее, чем прочитывают заголовок. */}
      <SiteFavicon url={entry.url} size={22} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          flex: 1, minWidth: 0,
          fontSize: 'var(--fs-md)', color: 'var(--text-strong)',
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
