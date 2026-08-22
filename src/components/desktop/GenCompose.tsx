import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DesktopItem, DesktopLayout } from '../../newtab/desktop';
import { listGenLibrary, subscribeGenStore } from '../../newtab/genStore';
import { RADIUS, TEXT, motion, pad, sp } from '../../styles/system';

// Полка собранных виджетов: поставить обратно на стол или забыть.
//
// ⚠️ Сборки здесь больше нет — она ушла в отдельный режим стола (GenStudio). В узкой колонке
// виджет собирался вслепую: превью не показывало ни настоящего размера, ни соседей.
// Пересборки здесь тоже нет: она означает новый прогон модели, и смотреть на него человек
// должен там же, где собирал, — в студии, с болванкой и ходом сборки.

export function GenShelf({
  layout,
  onPlace,
  onForget,
}: {
  layout: DesktopLayout;
  onPlace: (item: Omit<DesktopItem, 'id'>) => void;
  onForget: (genId: string) => void;
}) {
  const [lib, setLib] = useState(listGenLibrary);
  useEffect(() => subscribeGenStore(() => setLib(listGenLibrary())), []);
  if (lib.length === 0) return null;
  const onDesk = new Set(layout.items.map((i) => i.genId).filter((x): x is string => !!x));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2), paddingTop: sp(1) }}>
      {lib.map((it) => {
        const placed = onDesk.has(it.id);
        return (
          <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
            <span style={{
              flex: 1, minWidth: 0, ...TEXT.body,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              opacity: placed ? 0.5 : 1,
            }}>{it.title}</span>
            {placed
              ? <span style={{ ...TEXT.caption, flex: 'none' }}>на столе</span>
              : (
                <button
                  type="button"
                  onClick={() => onPlace({
                    kind: 'widget', widget: 'gen', genId: it.id, size: it.size, title: it.title,
                  })}
                  style={ghostBtn}
                >На стол</button>
              )}
            <button type="button" onClick={() => onForget(it.id)} title="Забыть" style={ghostBtn}>×</button>
          </div>
        );
      })}
    </div>
  );
}

const ghostBtn: CSSProperties = {
  ...TEXT.caption, flex: 'none', padding: pad(1, 2), cursor: 'default',
  border: '1px solid var(--divider-strong)', borderRadius: RADIUS.pill,
  background: 'transparent', color: 'var(--text-body)',
  transition: motion.hover('background', 'color'),
};
