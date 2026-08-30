import type React from 'react';
import type { DesktopLayout } from '../../newtab/desktop';
import type { NewTabSettings } from '../../newtab/settings';
import type { TileSite } from '../../../shared/frecency';
import type { useDesktopGrid } from './useDesktopGrid';
import { DesktopTile } from './DesktopTile';
import type { GenGhost } from './GenStudio';


/**
 * Сетка стола: плитки, болванка сборки, контур цели и ручка растягивания.
 *
 * ⚠️ Вся геометрия и все жесты приходят готовыми из useDesktopGrid — здесь только отрисовка.
 * Разделение держит правило, ради которого хук и написан: раскладка считается по
 * ПРЕДПОЛАГАЕМОМУ состоянию, и отрисовка не имеет права считать её как-то иначе.
 */
export function DesktopGrid({
  g, layout, settings, tiles, editing, ghost, areaRef, gridRef,
  onSubmit, onOpenApp, setStudioOpen, setStudioEditId,
}: {
  g: ReturnType<typeof useDesktopGrid>;
  layout: DesktopLayout;
  settings: NewTabSettings;
  tiles: TileSite[];
  editing: boolean;
  ghost: GenGhost | null;
  areaRef: React.RefObject<HTMLDivElement>;
  gridRef: React.RefObject<HTMLDivElement>;
  onSubmit: (text: string) => void;
  onOpenApp?: (appId: string) => void;
  setStudioOpen: (v: boolean) => void;
  setStudioEditId: (v: string | null) => void;
}) {
  return (
  <div ref={areaRef} style={{ width: '100%', maxWidth: 1320, marginTop: settings.search.show ? 26 : 0 }}>
    <div
      ref={gridRef}
      onPointerMove={g.onGridPointerMove}
      onPointerUp={g.onGridPointerUp}
      onPointerCancel={g.onGridPointerUp}
      style={{
        position: 'relative', margin: '0 auto',
        // ⚠️ В режиме правки снизу добавляется ПУСТАЯ строка. Дыры теперь законны, и без
        // запасной строки положить плитку ниже последней было бы физически некуда —
        // сетка кончалась ровно на последнем элементе.
        width: g.grid.width, height: g.gridRows * g.step - g.grid.gap,
        // В режиме правки курсор над сеткой сообщает, что элементы можно двигать.
        cursor: editing ? (g.drag ? 'grabbing' : 'grab') : undefined,
      }}
    >
      {/* ⚠️ Клетки видны ТОЛЬКО в режиме правки. Раньше жест был вслепую: элемент ехал за
          курсором, соседи расступались, но КУДА он встанет и по какой сетке — человек
          достраивал в уме. Пунктирные клетки отвечают на это прямо, а вне правки исчезают:
          на обычном экране решётка поверх обоев была бы шумом. */}
      {editing && Array.from({ length: g.gridRows * g.grid.cols }).map((_, i) => (
        <div
          key={`cell-${i}`}
          style={{
            position: 'absolute', left: 0, top: 0, pointerEvents: 'none',
            width: g.grid.cell, height: g.grid.cell, borderRadius: 'var(--radius-card)',
            transform: `translate3d(${(i % g.grid.cols) * g.step}px, ${Math.floor(i / g.grid.cols) * g.step}px, 0)`,
            border: '1.5px dashed var(--nt-plate-border)',
            background: 'var(--nt-plate)',
            opacity: 0.5,
          }}
        />
      ))}

      {/* ⚠️ Подсветка будущего места ВЕРНУЛАСЬ, и вот почему. Раньше её убрали как третий
          лишний сигнал: исход показывали расступившиеся соседи. На координатах соседи не
          расступаются вовсе (перенос одного элемента больше никого не касается) — и без
          контура жест снова стал бы вслепую. Контура нет, когда встать нельзя: это и есть
          ответ «сюда не влезет», данный ДО отпускания, а не после. */}
      {g.drag && g.dropOk && (
        <div style={{
          position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 4,
          transform: `translate3d(${g.dropCell.col * g.step}px, ${g.dropCell.row * g.step}px, 0)`,
          width: g.dropCell.w * g.grid.cell + (g.dropCell.w - 1) * g.grid.gap,
          height: g.dropCell.h * g.grid.cell + (g.dropCell.h - 1) * g.grid.gap,
          borderRadius: 'var(--radius-card)',
          border: '2px solid var(--accent)',
          background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
          transition: 'transform var(--dur-fast) var(--ease-out)',
        }} />
      )}

      {g.ready && g.placed.map((p) => (
        <DesktopTile
          key={p.item.id} {...p} g={g} layout={layout} settings={settings} tiles={tiles} ghost={ghost}
          editing={editing} onSubmit={onSubmit} onOpenApp={onOpenApp}
          setStudioOpen={setStudioOpen} setStudioEditId={setStudioEditId}
        />
      ))}
    </div>
  </div>
  );
}

