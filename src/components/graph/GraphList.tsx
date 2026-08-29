import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { GraphMeta } from '../../../shared/graph';

/**
 * Левая панель холста: список воркспейсов, переименование по месту, удаление и возврат из графа.
 * Разметка перенесена из GraphCanvas дословно.
 */
export default function GraphList({
  list, currentId, openGraph, renamingId, renameDraft,
  setRenamingId, setRenameDraft, onBack, onNewGraph, commitRename, deleteWorkspace,
}: {
  list: GraphMeta[];
  currentId: number | null;
  openGraph: (graphId: number) => Promise<void>;
  renamingId: number | null;
  renameDraft: string;
  setRenamingId: Dispatch<SetStateAction<number | null>>;
  setRenameDraft: Dispatch<SetStateAction<string>>;
  onBack: () => void;
  /** «+» — новый холст: выбор схемы показывает сам GraphCanvas. */
  onNewGraph: () => void;
  /** Записать имя из renameDraft. Живёт снаружи: пишет в базу и перечитывает список. */
  commitRename: () => void;
  deleteWorkspace: (graphId: number) => void;
}) {
  return (
  <aside
    style={{
      width: 208, flex: 'none', display: 'flex', flexDirection: 'column',
      // Тот же рецепт, что у навигации настроек (Settings.tsx): прозрачный рейл на плите
      // страницы и разделитель --divider-strong. Своей серой заливки он иметь не должен.
      borderRight: '1px solid var(--divider-strong)',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 12px 8px' }}>
      <button
        type="button"
        onClick={onBack}
        title="Выйти из графов — к новой вкладке"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 26, height: 26, flex: 'none',
          background: 'none', border: 0, padding: 0,
          borderRadius: '50%', color: 'var(--text-body)', cursor: 'pointer',
        }}
      >
        <ArrowLeft size={16} />
      </button>
      <span
        style={{
          fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)',
          letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase', color: 'var(--text-muted)',
        }}
      >
        Графы
      </span>
      <button
        type="button"
        onClick={() => onNewGraph()}
        title="Новый воркспейс"
        style={{
          marginLeft: 'auto', display: 'inline-flex', background: 'none', border: 0,
          padding: 4, borderRadius: '50%', color: 'var(--text-body)', cursor: 'pointer',
        }}
      >
        <Plus size={15} />
      </button>
    </div>

    <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {list.map((meta) => (
        <div
          key={meta.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            background: meta.id === currentId ? 'var(--surface)' : 'transparent',
            boxShadow: meta.id === currentId ? 'var(--shadow-card)' : 'none',
            color: meta.id === currentId ? 'var(--text-strong)' : 'var(--text-body)',
            fontSize: 'var(--fs-sm)',
            fontWeight: meta.id === currentId ? 'var(--fw-semibold)' : 'var(--fw-regular)',
          }}
          onClick={() => { if (meta.id !== currentId) void openGraph(meta.id); }}
        >
          {renamingId === meta.id ? (
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename();
                if (e.key === 'Escape') setRenamingId(null);
              }}
              style={{
                flex: 1, minWidth: 0, background: 'var(--surface-sunken)',
                border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', padding: '3px 6px',
                color: 'var(--text-strong)', font: 'inherit',
                fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)', outline: 'none',
              }}
            />
          ) : (
            <span
              // Двойной клик — привычный способ переименования списка; кнопка-карандаш
              // рядом нужна, чтобы способ вообще было видно.
              onDoubleClick={(e) => {
                e.stopPropagation();
                setRenameDraft(meta.title);
                setRenamingId(meta.id);
              }}
              style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {meta.title}
            </span>
          )}
          {renamingId !== meta.id && (
            <button
              type="button"
              title="Переименовать"
              onClick={(e) => {
                e.stopPropagation();
                setRenameDraft(meta.title);
                setRenamingId(meta.id);
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26, flex: 'none',
                background: 'none', border: 0, padding: 0,
                borderRadius: '50%', color: 'var(--text-faint)', cursor: 'pointer',
              }}
            >
              <Pencil size={13} />
            </button>
          )}
          <button
            type="button"
            title="Удалить воркспейс"
            onClick={(e) => { e.stopPropagation(); void deleteWorkspace(meta.id); }}
            // Цель клика 26×26, а не по размеру иконки: с прежними 17 пикселями в
            // корзину приходилось целиться, и промах читался как «кнопка не работает».
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, flex: 'none',
              background: 'none', border: 0, padding: 0,
              borderRadius: '50%', color: 'var(--text-faint)', cursor: 'pointer',
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  </aside>
  );
}
