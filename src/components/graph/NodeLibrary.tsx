import { ChevronLeft, Plus } from 'lucide-react';
import { NODE_KINDS, type GraphNodeKind } from '../../../shared/graph';
import { NODE_GROUPS, NodeIcon, toneColor } from './nodeVisual';
import { RADIUS, sp } from '../../styles/system';

// Библиотека узлов: что можно положить на холст.
//
// ⚠️ Панель слева, а не полоса сверху. Прежние восемнадцать кнопок стояли одной строкой над
// холстом: на узком окне они переносились в три ряда и съедали высоту содержимого — то есть
// цена росла ровно тогда, когда места и так мало. Вертикальный список этого не делает вовсе,
// а группы («Откуда — Обработка — Проверка — Артефакты — Итог») читаются сверху вниз как
// порядок работы.
//
// ⚠️ Плавает НАД холстом, а не отнимает у него ширину: холст бесконечный, и панель, сдвигающая
// его край, каждый раз ломала бы уже собранную человеком раскладку.

/** Кнопка раскрытия свёрнутой библиотеки. */
export function LibraryHandle({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Библиотека узлов"
      style={{
        position: 'absolute', left: sp(3), top: sp(3), zIndex: 4,
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '9px 14px 9px 11px', borderRadius: RADIUS.pill,
        background: 'var(--surface-island)', border: '1px solid var(--divider)',
        boxShadow: 'var(--shadow-island, 0 6px 20px -10px rgba(0,0,0,.3))',
        color: 'var(--text-body)', cursor: 'pointer', font: 'inherit',
        fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)',
        fontWeight: 'var(--fw-medium)',
      }}
    >
      <Plus size={15} />
      Добавить узел
    </button>
  );
}

export default function NodeLibrary({ onAdd, onClose }: {
  onAdd: (kind: GraphNodeKind) => void;
  onClose: () => void;
}) {
  return (
    <aside
      style={{
        position: 'absolute', left: sp(3), top: sp(3), bottom: sp(3), zIndex: 4,
        width: 186, boxSizing: 'border-box', overflowY: 'auto',
        padding: `${sp(3)}px ${sp(3)}px ${sp(4)}px`,
        background: 'var(--surface-island)', border: '1px solid var(--divider)',
        // Радиус СОДЕРЖИМОГО: панель лежит на холсте графа, а не в хроме окна.
        borderRadius: RADIUS.content,
        boxShadow: 'var(--shadow-island, 0 6px 20px -10px rgba(0,0,0,.3))',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: sp(2) }}>
        <span
          style={{
            flex: 1, fontSize: 'var(--fs-xs)', letterSpacing: 'var(--ls-caps)',
            textTransform: 'uppercase', color: 'var(--text-faint)',
          }}
        >
          Библиотека
        </span>
        <button
          type="button" onClick={onClose} title="Свернуть библиотеку"
          style={{
            display: 'inline-flex', width: 20, height: 20, alignItems: 'center',
            justifyContent: 'center', padding: 0, background: 'none', border: 0,
            borderRadius: '50%', color: 'var(--text-faint)', cursor: 'pointer',
          }}
        >
          <ChevronLeft size={15} />
        </button>
      </div>

      {NODE_GROUPS.map((group) => (
        <div key={group.title} style={{ marginBottom: sp(2) }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              margin: `0 0 ${sp(1)}px 2px`,
              fontSize: 'var(--fs-xs)', letterSpacing: 'var(--ls-caps)',
              textTransform: 'uppercase', color: 'var(--text-faint)',
            }}
          >
            {/* Метка тона: то, ЧЕМ будет покрашен узел, видно ещё до того, как его положили. */}
            <span
              style={{
                width: 8, height: 8, flex: 'none',
                borderRadius: RADIUS.tight, background: toneColor(group.tone),
              }}
            />
            {group.title}
          </div>
          {group.kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => onAdd(kind)}
              title={NODE_KINDS[kind].hint}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                boxSizing: 'border-box', textAlign: 'left',
                background: 'var(--surface-sunken)', border: '1px solid var(--divider)',
                borderRadius: RADIUS.control, padding: '7px 9px', marginBottom: 4,
                cursor: 'pointer', color: 'var(--text-body)', font: 'inherit',
                fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)',
                fontWeight: 'var(--fw-medium)',
              }}
            >
              <NodeIcon kind={kind} size={15} />
              <span
                style={{
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                }}
              >
                {NODE_KINDS[kind].label}
              </span>
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}
