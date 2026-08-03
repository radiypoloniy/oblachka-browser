import { useEffect, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, closestCenter, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, ChevronRight, Folder, FolderPlus, Pencil, Star, X } from 'lucide-react';
import type { BookmarkNode } from '../../shared/ipc';
import { islandPlate } from '../styles/island';
import FolderGlyph from './FolderGlyph';

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
  const [renameId, setRenameId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  // Оптимистичный порядок — тот же приём, что у вкладок в Sidebar.tsx: список встаёт на место
  // сразу, не дожидаясь ответа main, иначе после отпускания он на кадр прыгает обратно.
  const [localOrder, setLocalOrder] = useState<number[] | null>(null);
  const orderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async (): Promise<void> => setTree(await window.oblako.listBookmarkTree());
  useEffect(() => { void load(); }, []);
  // Тот же push, что слушает панель закладок: звезда в омнибоксе и импорт меняют базу мимо нас.
  useEffect(() => window.oblako.onBookmarksChanged(() => void load()), []);
  useEffect(() => () => { if (orderTimer.current) clearTimeout(orderTimer.current); }, []);

  const rootFolders = tree.filter((n) => n.kind === 'folder');
  const current = folderId === null ? null : findNode(tree, folderId);
  // В корне показываем только ссылки: папки корня уже стоят сеткой выше.
  const base = folderId === null ? tree.filter((n) => n.kind === 'link') : (current?.children ?? []);
  const items = localOrder
    ? localOrder.map((id) => base.find((n) => n.id === id)).filter((n): n is BookmarkNode => !!n)
    : base;

  // Папка могла исчезнуть (удалили в разделе закладок, пока сайдбар открыт) — не оставляем
  // пустой экран без объяснения, а честно возвращаемся в корень.
  useEffect(() => {
    if (folderId !== null && tree.length > 0 && !findNode(tree, folderId)) setFolderId(null);
  }, [tree, folderId]);
  // Оптимистичный порядок снимаем, как только состав уровня изменился: он описывал ДРУГОЙ набор.
  useEffect(() => { setLocalOrder(null); }, [folderId]);

  const toggle = (id: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const createFolder = async (title: string): Promise<void> => {
    setCreating(false);
    if (!title.trim()) return;
    // Папка создаётся на ТЕКУЩЕМ уровне: находясь внутри папки, «+» логично делает вложенную,
    // а не подкидывает её в корень за спиной у человека.
    await window.oblako.createBookmarkFolder(title.trim(), folderId);
  };

  const removeNode = async (node: BookmarkNode): Promise<void> => {
    // ⚠️ Удаление папки уносит ВСЁ содержимое (ON DELETE CASCADE в схеме), и отменить это
    // нечем — спрашиваем. У пустой папки и у ссылки спрашивать не о чем.
    const inside = node.children?.length ?? 0;
    if (inside > 0 && !window.confirm(`Удалить папку «${node.title}» вместе с содержимым (${inside})?`)) return;
    await window.oblako.removeBookmark(node.id);
  };

  const onDragEnd = (e: DragEndEvent): void => {
    setDragId(null);
    const { active, over } = e;
    if (!over) return;
    const id = Number(active.id);

    // Дроп на ячейку папки в сетке — перенос на другой уровень. ⚠️ Это ЕДИНСТВЕННЫЙ способ
    // сменить уровень перетаскиванием, и намеренно: строка папки в списке одновременно и
    // сортируемая, и потенциальная цель, так что дроп на неё нельзя однозначно прочитать —
    // «встать перед ней» и «положить внутрь» выглядели бы одинаково.
    const cell = String(over.id);
    if (cell.startsWith(CELL_PREFIX)) {
      const target = cell.slice(CELL_PREFIX.length);
      const parentId = target === 'root' ? null : Number(target);
      if (parentId === id) return; // папку саму в себя — молча мимо, схему этим не тревожим
      void window.oblako.moveBookmark(id, parentId);
      return;
    }

    // Иначе — перестановка внутри уровня.
    const overId = Number(over.id);
    if (id === overId) return;
    const ids = items.map((n) => n.id);
    const from = ids.indexOf(id);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    setLocalOrder(next);
    if (orderTimer.current) clearTimeout(orderTimer.current);
    orderTimer.current = setTimeout(() => { setLocalOrder(null); orderTimer.current = null; }, 3000);
    void window.oblako.reorderBookmarks(folderId, next);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const dragNode = dragId === null ? null : findNode(tree, dragId);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => setDragId(Number(e.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragId(null)}
    >
      {/* Сетка папок корня — на месте закреплённых вкладок. Показывается, даже когда папок нет:
          иначе «+» негде было бы разместить, а первую папку нечем создать.
          ⚠️ У каждой ячейки ЕСТЬ ПОДПИСЬ. Раньше здесь стояли одинаковые контурные значки без
          имён — по такой сетке нельзя ответить даже на вопрос «что это за папки», не то что
          выбрать нужную. Раскладка — как на домашнем экране: значок и подпись под ним. */}
      <div className="no-drag" style={{ ...PLATE, padding: 8, marginBottom: 10 }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, alignItems: 'start',
        }}>
          <FolderCell id="root" label="Все" active={folderId === null} onClick={() => setFolderId(null)} all />
          {rootFolders.map((f) => (
            <FolderCell key={f.id} id={String(f.id)} label={f.title}
              active={folderId === f.id} onClick={() => setFolderId(f.id)} />
          ))}
          <button
            className="no-drag"
            onClick={() => setCreating(true)}
            title={folderId === null ? 'Новая папка' : 'Новая папка внутри текущей'}
            style={{
              border: 'none', cursor: 'default', padding: '6px 2px 4px', borderRadius: 'var(--radius-sm)',
              background: 'transparent', color: 'var(--text-faint)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{
              width: 40, height: 40, borderRadius: 11, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center',
              border: '1.5px dashed var(--divider-strong)',
            }}>
              <FolderPlus size={17} strokeWidth={2} />
            </span>
            <span style={{ fontSize: 'var(--fs-xs)', lineHeight: 1.1 }}>Новая</span>
          </button>
        </div>
        {creating && <NameInput placeholder="Название папки" onDone={(v) => void createFolder(v)} onCancel={() => setCreating(false)} />}
      </div>

      <div className="no-drag" style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', flex: 1 }}>
        {items.length === 0 && (
          <div style={{ padding: '8px 10px', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
            {tree.length === 0 ? 'Закладок пока нет. Сохраните страницу звездой в адресной строке.' : 'Здесь пусто.'}
          </div>
        )}
        <SortableContext items={items.map((n) => n.id)} strategy={verticalListSortingStrategy}>
          {items.map((node) => (
            <SortableRow key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggle}
              onOpen={onOpen} renameId={renameId} setRenameId={setRenameId} onRemove={removeNode} />
          ))}
        </SortableContext>
      </div>

      {/* Призрак — как у вкладок: оригинал гасится, за курсором едет копия строки. */}
      <DragOverlay>
        {dragNode && (
          <div style={{
            ...PLATE, padding: '6px 10px', opacity: 0.95,
            display: 'flex', alignItems: 'center', gap: 8, boxShadow: 'var(--shadow-card)',
          }}>
            <BookmarkIcon node={dragNode} />
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', whiteSpace: 'nowrap' }}>
              {dragNode.title || dragNode.url}
            </span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// Префикс id ячеек сетки — чтобы отличить дроп «в папку» от дропа «перед строкой»: у строк id
// это голое число (того же вида, что в SortableContext), пересечься они не должны.
const CELL_PREFIX = 'bmfolder:';

// ── Строка списка ────────────────────────────────────────────────────────────────────────────
// Рекурсивная: вложенная папка раскрывается прямо под собой, детей рисует та же компонента с
// увеличенным depth. Отступ — единственное, что отличает уровень; рамок и линий нет намеренно,
// в 256 px они съедают ширину, ради которой список и вертикальный.
// ⚠️ Сортируется ТОЛЬКО верхний уровень списка: раскрытые дети рисуются вне SortableContext.
// Иначе перестановка «через уровень» означала бы неявную смену родителя — жест, который человек
// не заказывал, а отменить его нечем.
function SortableRow(props: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.node.id,
    disabled: props.renameId === props.node.id, // переименование не должно превращаться в драг
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0 : 1 }}
      {...attributes}
      {...listeners}
    >
      <Row {...props} />
    </div>
  );
}

interface RowProps {
  node: BookmarkNode; depth: number; expanded: Set<number>;
  onToggle: (id: number) => void; onOpen: (url: string) => void;
  renameId: number | null; setRenameId: (id: number | null) => void;
  onRemove: (node: BookmarkNode) => void;
}

function Row({ node, depth, expanded, onToggle, onOpen, renameId, setRenameId, onRemove }: RowProps) {
  const isFolder = node.kind === 'folder';
  const open = expanded.has(node.id);
  const count = node.children?.length ?? 0;
  const [hover, setHover] = useState(false);

  if (renameId === node.id) {
    return (
      <div style={{ paddingLeft: 8 + depth * 14 }}>
        <NameInput
          initial={node.title}
          placeholder="Название"
          onDone={(v) => { setRenameId(null); if (v.trim() && v !== node.title) void window.oblako.renameBookmark(node.id, v.trim()); }}
          onCancel={() => setRenameId(null)}
        />
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '6px 8px', paddingLeft: 8 + depth * 14,
          borderRadius: 'var(--radius-sm)',
          background: hover ? 'var(--surface-hover)' : 'transparent',
          transition: 'background var(--dur-fast) var(--ease-standard)',
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <button
          className="no-drag"
          onClick={() => (isFolder ? onToggle(node.id) : onOpen(node.url))}
          title={isFolder ? node.title : `${node.title}\n${node.url}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0,
            border: 'none', background: 'transparent', cursor: 'default', padding: 0, textAlign: 'left',
          }}
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
        </button>

        {/* Действия по наведению — как в строках загрузок: постоянно висящие кнопки в полосе
            256 px съели бы место у самих названий, ради которых список и существует.
            ⚠️ Слот ФИКСИРОВАННОЙ ширины, а счётчик и кнопки подменяются ПРОЗРАЧНОСТЬЮ, а не
            появлением в разметке. Иначе наведение меняет ширину строки: заголовок ужимается,
            длинное название переобрезается по многоточию, и строка на глазах дёргается — тем
            сильнее, чем ближе курсор к границе. Раскладка на наведение меняться не должна
            вообще, поэтому место под кнопки занято всегда. */}
        <span style={{
          position: 'relative', flex: 'none', width: 40, height: 18,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end',
        }}>
          <span style={{
            position: 'absolute', inset: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end',
            fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', pointerEvents: 'none',
            opacity: hover ? 0 : 1, transition: 'opacity var(--dur-fast) var(--ease-standard)',
          }}>
            {isFolder && count > 0 ? count : ''}
          </span>
          <span style={{
            position: 'absolute', inset: 0, display: 'inline-flex', alignItems: 'center',
            justifyContent: 'flex-end', gap: 2,
            opacity: hover ? 1 : 0, transition: 'opacity var(--dur-fast) var(--ease-standard)',
            pointerEvents: hover ? 'auto' : 'none',
          }}>
            <RowBtn title="Переименовать" onClick={() => setRenameId(node.id)}><Pencil size={12} strokeWidth={2} /></RowBtn>
            <RowBtn title="Удалить" onClick={() => onRemove(node)}><X size={13} strokeWidth={2} /></RowBtn>
          </span>
        </span>
      </div>

      {isFolder && open && node.children?.map((child) => (
        <Row key={child.id} {...{ node: child, depth: depth + 1, expanded, onToggle, onOpen, renameId, setRenameId, onRemove }} />
      ))}
    </>
  );
}

function RowBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="no-drag"
      title={title}
      // ⚠️ stopPropagation обязателен: строка целиком — ручка перетаскивания (listeners висят
      // на обёртке), и без этого нажатие на кнопку начинало бы драг вместо действия.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        flex: 'none', border: 'none', background: 'transparent', cursor: 'default',
        padding: 3, borderRadius: 4, color: 'var(--text-faint)', display: 'inline-flex',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-body)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; }}
    >{children}</button>
  );
}

// Поле ввода имени — общее на создание папки и переименование. Enter подтверждает, Escape
// отменяет, потеря фокуса тоже подтверждает: человек уже отвёл взгляд, терять введённое обидно.
function NameInput({ initial = '', placeholder, onDone, onCancel }: {
  initial?: string; placeholder: string; onDone: (v: string) => void; onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
      <input
        autoFocus
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onDone(v);
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={() => onDone(v)}
        style={{
          flex: 1, minWidth: 0, border: '1px solid var(--divider-strong)', outline: 'none',
          borderRadius: 'var(--radius-sm)', padding: '4px 7px', background: 'var(--surface)',
          color: 'var(--text-strong)', fontSize: 'var(--fs-sm)', fontFamily: 'inherit',
        }}
      />
      <RowBtn title="Готово" onClick={() => onDone(v)}><Check size={13} strokeWidth={2} /></RowBtn>
    </div>
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
// ⚠️ Ячейка — ещё и ЦЕЛЬ ДРОПА: перенести закладку на другой уровень можно только сюда.
// «Все закладки» при этом означает «вынуть из папки в корень» — без неё закладка, однажды
// положенная в папку, осталась бы там навсегда.
function FolderCell({ id, label, active, onClick, all }: {
  id: string; label: string; active: boolean; onClick: () => void; all?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: CELL_PREFIX + id });
  return (
    <button
      ref={setNodeRef}
      className="no-drag"
      onClick={onClick}
      title={all ? 'Все закладки (перетащите сюда, чтобы вынуть из папки)' : label}
      style={{
        border: 'none', cursor: 'default', padding: '6px 2px 4px', borderRadius: 'var(--radius-sm)',
        background: isOver ? 'var(--accent-soft)' : active ? 'var(--surface)' : 'transparent',
        boxShadow: isOver ? 'inset 0 0 0 1.5px var(--accent)' : active ? 'var(--shadow-card)' : 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0,
        color: isOver ? 'var(--accent)' : active ? 'var(--text-strong)' : 'var(--text-muted)',
        transition: 'background var(--dur-fast) var(--ease-standard)',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = active ? 'var(--surface)' : 'transparent'; }}
    >
      {all ? (
        // «Все закладки» — не папка, и значок у неё другой намеренно: это не место, а «показать
        // всё». Тот же приём, что у пункта «Все закладки» в колонке раздела.
        <span style={{
          width: 40, height: 40, borderRadius: 11, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(180deg, hsl(42 92% 62%), hsl(36 88% 50%))',
          color: '#fff', boxShadow: 'var(--appicon-shadow)',
        }}>
          <Star size={20} strokeWidth={2.2} fill="currentColor" />
        </span>
      ) : (
        <FolderGlyph title={label} size={40} />
      )}
      <span style={{
        maxWidth: '100%', fontSize: 'var(--fs-xs)', lineHeight: 1.1,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{label}</span>
    </button>
  );
}

// Плашка — ровно то же, из чего собран innerPlate в Sidebar.tsx (он там приватный): плашки
// внутри острова сайдбара по вложенности card-уровня, а не island-уровня (см. radii.css).
const PLATE: React.CSSProperties = {
  ...islandPlate,
  borderRadius: 'var(--radius-card)',
};
