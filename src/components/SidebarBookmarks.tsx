import { useEffect, useState } from 'react';
import { ChevronRight, Folder, Star } from 'lucide-react';
import type { BookmarkNode } from '../../shared/ipc';
import { islandPlate } from '../styles/island';

// Режим «Закладки» в сайдбаре — содержимое, которое встаёт на место полосы вкладок.
//
// ⚠️ Раскладка ПОВТОРЯЕТ режим вкладок, а не изобретает свою: сетка иконок вверху (там, где в
// режиме вкладок закреплённые) — папки корня, список ниже (там, где вкладки) — сами закладки.
// Это и есть причина, по которой закладки не поехали ни в поповер, ни в горизонтальный бар:
// сайдбар уже умеет ровно такую форму, и человеку не нужно учить вторую.
//
// ⚠️ Папки корня НЕ дублируются в списке. Они живут в сетке и работают там как переключатель
// уровня; список показывает содержимое выбранной папки. Иначе одна и та же папка была бы на
// экране дважды, и клик по ней означал бы разное в двух местах.
//
// ⚠️ ВЛОЖЕННЫЕ папки раскрываются НА МЕСТЕ, а не уводят вглубь: ровно так же ведут себя группы
// вкладок в этом же сайдбаре (см. SortableGroupBlock). Один визуальный язык на две сущности —
// человеку не нужно догадываться, что папка ведёт себя иначе, чем группа.

interface Props {
  /** Открыть закладку. Что делать с режимом дальше — решает сайдбар (см. onOpened). */
  onOpen: (url: string) => void;
}

// Плоский обход дерева нужен, чтобы найти узел по id, не таская ссылки на родителей.
function findNode(nodes: BookmarkNode[], id: number): BookmarkNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = n.children ? findNode(n.children, id) : null;
    if (hit) return hit;
  }
  return null;
}

export default function SidebarBookmarks({ onOpen }: Props) {
  const [tree, setTree] = useState<BookmarkNode[]>([]);
  // null — корень. Выбранная папка живёт здесь, а не в адресе/сессии: это состояние взгляда,
  // а не данных, и переживать перезапуск ему незачем.
  const [folderId, setFolderId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = async (): Promise<void> => setTree(await window.oblako.listBookmarkTree());
  useEffect(() => { void load(); }, []);
  // Тот же push, что слушает панель закладок: звезда в омнибоксе и импорт меняют базу мимо нас.
  useEffect(() => window.oblako.onBookmarksChanged(() => void load()), []);

  const rootFolders = tree.filter((n) => n.kind === 'folder');
  const current = folderId === null ? null : findNode(tree, folderId);
  // В корне показываем только ссылки: папки корня уже стоят сеткой выше.
  const items = folderId === null ? tree.filter((n) => n.kind === 'link') : (current?.children ?? []);

  // Папка могла исчезнуть (удалили в разделе закладок, пока сайдбар открыт) — не оставляем
  // пустой экран без объяснения, а честно возвращаемся в корень.
  useEffect(() => {
    if (folderId !== null && tree.length > 0 && !findNode(tree, folderId)) setFolderId(null);
  }, [tree, folderId]);

  const toggle = (id: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <>
      {/* Сетка папок корня — на месте закреплённых вкладок. Плашки нет вовсе, когда папок нет:
          пустой прямоугольник читался бы как поломка, а не как «папок пока не завели». */}
      {rootFolders.length > 0 && (
        <div className="no-drag" style={{ ...PLATE, padding: 8, marginBottom: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <FolderCell label="Все закладки" active={folderId === null} onClick={() => setFolderId(null)} all />
            {rootFolders.map((f) => (
              <FolderCell key={f.id} label={f.title} active={folderId === f.id} onClick={() => setFolderId(f.id)} />
            ))}
          </div>
        </div>
      )}

      <div className="no-drag" style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', flex: 1 }}>
        {items.length === 0 && (
          <div style={{ padding: '8px 10px', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
            {tree.length === 0 ? 'Закладок пока нет. Сохраните страницу звездой в адресной строке.' : 'В этой папке пусто.'}
          </div>
        )}
        {items.map((node) => (
          <Row key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggle} onOpen={onOpen} />
        ))}
      </div>
    </>
  );
}

// ── Строка списка ────────────────────────────────────────────────────────────────────────────
// Рекурсивная: вложенная папка раскрывается прямо под собой, детей рисует та же компонента с
// увеличенным depth. Отступ — единственное, что отличает уровень; рамок и линий нет намеренно,
// в 256 px они съедают ширину, ради которой список и вертикальный.
function Row({ node, depth, expanded, onToggle, onOpen }: {
  node: BookmarkNode; depth: number; expanded: Set<number>;
  onToggle: (id: number) => void; onOpen: (url: string) => void;
}) {
  const isFolder = node.kind === 'folder';
  const open = expanded.has(node.id);
  const count = node.children?.length ?? 0;

  return (
    <>
      <button
        className="no-drag"
        onClick={() => (isFolder ? onToggle(node.id) : onOpen(node.url))}
        title={isFolder ? node.title : `${node.title}\n${node.url}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '6px 8px', paddingLeft: 8 + depth * 14,
          border: 'none', background: 'transparent', cursor: 'default',
          borderRadius: 'var(--radius-sm)', textAlign: 'left',
          transition: 'background var(--dur-fast) var(--ease-standard)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {isFolder ? (
          <ChevronRight
            size={12} strokeWidth={2}
            style={{
              flex: 'none', color: 'var(--text-faint)',
              transform: open ? 'rotate(90deg)' : 'none',
              transition: 'transform var(--dur-fast) var(--ease-standard)',
            }}
          />
        ) : (
          <span style={{ width: 12, flex: 'none' }} />
        )}
        <BookmarkIcon node={node} />
        <span style={{
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontSize: 'var(--fs-sm)', color: 'var(--text-body)',
        }}>
          {node.title || node.url}
        </span>
        {isFolder && count > 0 && (
          <span style={{ flex: 'none', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{count}</span>
        )}
      </button>

      {isFolder && open && node.children?.map((child) => (
        <Row key={child.id} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} onOpen={onOpen} />
      ))}
    </>
  );
}

// Значок строки. У ссылки — favicon с самого домена (тот же FaviconService, что в списке
// паролей: ходит только на сам сайт, без сторонних сервисов); пока не приехал или не нашёлся,
// место занимает звезда, чтобы строка не дёргалась при подмене.
function BookmarkIcon({ node }: { node: BookmarkNode }) {
  const [src, setSrc] = useState<string | null>(null);
  const host = (() => { try { return new URL(node.url).hostname; } catch { return ''; } })();

  useEffect(() => {
    if (node.kind !== 'link' || !host) return;
    let alive = true;
    void window.oblako.getFavicon(host).then((d) => { if (alive) setSrc(d); }).catch(() => { /* останется звезда */ });
    return () => { alive = false; };
  }, [host, node.kind]);

  if (node.kind === 'folder') return <Folder size={14} strokeWidth={2} style={{ flex: 'none', color: 'var(--text-muted)' }} />;
  if (src) return <img src={src} alt="" width={14} height={14} style={{ flex: 'none', borderRadius: 3, objectFit: 'contain' }} />;
  return <Star size={14} strokeWidth={2} style={{ flex: 'none', color: 'var(--text-faint)' }} />;
}

// ── Ячейка папки в сетке ─────────────────────────────────────────────────────────────────────
// Та же форма, что у закреплённой вкладки (IconCell в Sidebar.tsx): квадрат со скруглением,
// активный — на белой подложке с тенью. Повторяем её здесь, а не переиспользуем: IconCell
// принимает TabState и умеет про загрузку и сон, а у папки ничего из этого нет.
function FolderCell({ label, active, onClick, all }: {
  label: string; active: boolean; onClick: () => void; all?: boolean;
}) {
  return (
    <button
      className="no-drag"
      onClick={onClick}
      title={label}
      style={{
        border: 'none', cursor: 'default', padding: 5, borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--surface)' : 'transparent',
        boxShadow: active ? 'var(--shadow-card)' : 'none',
        display: 'inline-flex', color: active ? 'var(--text-strong)' : 'var(--text-muted)',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = active ? 'var(--surface)' : 'transparent'; }}
    >
      {all ? <Star size={18} strokeWidth={2} /> : <Folder size={18} strokeWidth={2} />}
    </button>
  );
}

// Плашка — ровно то же, из чего собран innerPlate в Sidebar.tsx (он там приватный): плашки
// внутри острова сайдбара по вложенности card-уровня, а не island-уровня (см. radii.css).
const PLATE: React.CSSProperties = {
  ...islandPlate,
  borderRadius: 'var(--radius-card)',
};
