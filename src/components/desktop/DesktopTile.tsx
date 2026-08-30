import { useState } from 'react';
import type React from 'react';
import { X, Star, Pencil } from 'lucide-react';
import type { PlacedItem } from '../../newtab/desktop';
import { removeItem, setHero } from '../../newtab/desktop';
import type { NewTabSettings } from '../../newtab/settings';
import type { DesktopLayout } from '../../newtab/desktop';
import type { TileSite } from '../../../shared/frecency';
import { RADIUS } from '../../styles/system';
import { WIDGET_FILLS, fillCss } from './widgets';
import type { useDesktopGrid } from './useDesktopGrid';
import { TileContent } from './TileContent';


/**
 * Одна плитка стола: виджет, приложение или сайт, плюс кнопки режима правки.
 *
 * ⚠️ Перетаскиваемая плитка живёт ОТДЕЛЬНО от сетки: она идёт от места захвата за курсором и
 * не переезжает вместе с расчётом будущей клетки. Иначе жест выглядел бы так, будто плитка
 * дёргается между двумя правдами — курсором и укладчиком.
 */
export function DesktopTile({
  g, item, col, row, w, h, layout, settings, tiles, editing, ghost,
  onSubmit, onOpenApp, setStudioOpen, setStudioEditId,
}: PlacedItem & {
  g: ReturnType<typeof useDesktopGrid>;
  layout: DesktopLayout;
  settings: NewTabSettings;
  tiles: TileSite[];
  editing: boolean;
  ghost: import('./GenStudio').GenGhost | null;
  onSubmit: (text: string) => void;
  onOpenApp?: (appId: string) => void;
  setStudioOpen: (v: boolean) => void;
  setStudioEditId: (v: string | null) => void;
}) {
      // Размер во время жеста уже новый: раскладка считается по preview (см. выше), так
      // что и сам элемент, и расступившиеся соседи двигаются одновременно.
      const live = { w, h };
      const stretching = g.resizing?.id === item.id;
      const box = {
        width: live.w * g.grid.cell + (live.w - 1) * g.grid.gap,
        height: live.h * g.grid.cell + (live.h - 1) * g.grid.gap,
      };
      const dragging = g.drag?.id === item.id;
      // Перетаскиваемый живёт отдельно от сетки: он идёт от места захвата за курсором и
      // НЕ переезжает вместе с расчётом будущей клетки.
      // ⚠️ Локальная переменная, а не g.drag внутри строки: dragging уже доказал, что жест
      // есть и он про ЭТУ плитку, но типам об этом через две проверки не рассказать.
      const d = dragging ? g.drag : null;
      const held = d
        ? `translate3d(${d.originX + d.dx}px, ${d.originY + d.dy}px, 0) scale(1.04)`
        : null;
      const style: React.CSSProperties = {
        position: 'absolute', left: 0, top: 0,
        // ⚠️ Позиция — transform, а не left/top. Смена left/top заставляет браузер
        // пересчитывать раскладку и перерисовывать слой на каждом кадре анимации;
        // transform уходит в композитор и двигает уже готовую текстуру.
        transform: held ?? `translate3d(${col * g.step}px, ${row * g.step}px, 0)`,
        width: box.width, height: box.height,
        zIndex: dragging || g.resizing?.id === item.id ? 5 : 1,
        // Пока элемент в руке — никакого перехода: он обязан быть точно под курсором,
        // иначе тянется следом с задержкой и промахивается мимо места.
        // ⚠️ И никакого перехода, пока МЕНЯЕТСЯ САМА СЕТКА (см. g.metricsChanged). Плавность
        // здесь нужна ровно для правки раскладки — переставили плитку, соседи разъехались.
        // При ресайзе окна клетка меняется на каждом кадре, и те же 220 мс превращались
        // в отставание: контейнер уже нового размера, а плитки ещё едут к нему — со
        // стороны это выглядит так, будто иконки не поспевают за окном.
        transition: dragging || !g.ready || g.metricsChanged ? undefined
          : stretching ? 'transform 220ms var(--ease-out)'
          : 'transform 220ms var(--ease-out), width 180ms var(--ease-out), height 180ms var(--ease-out)',
        filter: dragging ? 'drop-shadow(0 12px 24px rgba(10,12,20,0.35))' : undefined,
        touchAction: editing ? 'none' : undefined,
        // ⚠️ Дрожание вешаем на ВНУТРЕННИЙ слой (см. ниже), а не сюда: анимация transform
        // на этом элементе затёрла бы позиционирующий translate3d.
        willChange: dragging || editing ? 'transform' : undefined,
      };

      const content = (
        <TileContent
          g={g} item={item} settings={settings} tiles={tiles} editing={editing}
          ghost={ghost} box={box} onSubmit={onSubmit} onOpenApp={onOpenApp}
        />
      );

      return (
        <div
          key={item.id}
          // Атрибут нужен диагностике: по нему проверка находит конкретный элемент
          // сетки, не угадывая его по стилям.
          data-desktop-item={item.id}
          style={style}
          onPointerDown={(e) => g.onItemPointerDown(e, item.id)}
        >
          {/* ⚠️ В режиме правки перехватываем указатель ПЕРЕД содержимым: иначе клик по
              кнопке приложения открывал бы его прямо во время перестановки. */}
          {editing && <div style={{ position: 'absolute', inset: 0, zIndex: 2 }} />}
          <div style={{
            width: '100%', height: '100%',
            animation: editing && !dragging ? 'oblako-jiggle 1.6s ease-in-out infinite' : undefined,
            animationDelay: editing ? `${((col + row) % 5) * 90}ms` : undefined,
          }}>{content}</div>

          {editing && (
            <>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => g.apply(removeItem(layout, item.id))}
                title="Убрать с экрана"
                style={{
                  position: 'absolute', top: -8, left: -8, zIndex: 6,
                  width: 22, height: 22, borderRadius: RADIUS.pill, border: 'none', cursor: 'default',
                  background: 'rgba(30,30,34,0.92)', color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
                }}
              ><X size={13} /></button>

              {/* ⚠️ ГЕРОЯ ВЫБИРАЕТ ЧЕЛОВЕК. Набор виджетов у каждого свой: на одном столе
                  главной будет погода, на другом — курс или защита, и решать это за него
                  в коде нельзя. Кнопка — переключатель: повторное нажатие снимает
                  геройство, а назначение нового снимает флаг с прежнего (см. setHero). */}
              {item.kind === 'widget' && (
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => g.apply(setHero(layout, item.id))}
                  title={item.hero ? 'Больше не главный' : 'Сделать главным'}
                  style={{
                    position: 'absolute', top: -8, right: -8, zIndex: 6,
                    width: 22, height: 22, borderRadius: RADIUS.pill, border: 'none', cursor: 'default',
                    background: item.hero ? 'var(--accent)' : 'rgba(30,30,34,0.92)',
                    color: item.hero ? 'var(--on-accent)' : '#fff',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
                  }}
                ><Star size={12} fill={item.hero ? 'currentColor' : 'none'} /></button>
              )}

              {/* ⚠️ Правка СВОЕГО виджета на месте. Без неё поменять таймеру время можно
                  было только пересборкой нового и удалением старого — а данные правятся
                  точечно, ради другого числа гонять модель незачем. */}
              {item.kind === 'widget' && item.widget === 'gen' && item.genId && (
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => { setStudioEditId(item.genId ?? null); setStudioOpen(true); }}
                  title="Изменить виджет"
                  style={{
                    position: 'absolute', bottom: -8, left: -8, zIndex: 6,
                    width: 22, height: 22, borderRadius: RADIUS.pill, border: 'none', cursor: 'default',
                    background: 'rgba(30,30,34,0.92)', color: '#fff',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
                  }}
                ><Pencil size={12} /></button>
              )}

              {/* Выбор заливки — только у виджетов и только в режиме правки: цвет это
                  настройка вида, а не действие, и в обычном режиме кнопке над плиткой
                  делать нечего. Погоду не трогаем — там цвет несёт смысл. */}
              {item.kind === 'widget' && item.widget !== 'weather' && (
                <FillPicker
                  value={item.fill}
                  onPick={(fill) => g.apply({
                    ...layout,
                    items: layout.items.map((it) => (it.id === item.id ? { ...it, fill } : it)),
                  })}
                />
              )}

              {/* Уголок растягивания — только у виджетов: иконка занимает ровно клетку,
                  и «растянутая» иконка была бы просто размытым квадратом. */}
              {item.kind === 'widget' && (
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    g.setResizing({ id: item.id, w, h });
                  }}
                  title="Потяните, чтобы изменить размер"
                  style={{
                    position: 'absolute', right: -6, bottom: -6, zIndex: 6,
                    width: 20, height: 20, borderRadius: RADIUS.pill,
                    background: stretching ? 'var(--accent)' : 'rgba(30,30,34,0.92)',
                    cursor: 'nwse-resize',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transform: stretching ? 'scale(1.15)' : undefined,
                    transition: 'transform var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-standard)',
                  }}
                >
                  <span style={{
                    width: 8, height: 8, borderRight: '2px solid #fff', borderBottom: '2px solid #fff',
                    transform: 'translate(-1px,-1px)',
                  }} />
                </div>
              )}
            </>
          )}
        </div>
      );
}

// Выбор заливки виджета — точка-палитра в углу плитки, раскрывается рядом с ней.
// ⚠️ Хранится ID заливки, а не цвет: «как тема» обязана оставаться живой связью с темой и
// палитрой, а записанный цвет застыл бы навсегда (см. DesktopItem.fill).
function FillPicker({ value, onPick }: { value?: string; onPick: (fill: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="Цвет виджета"
        style={{
          position: 'absolute', left: -6, bottom: -6, zIndex: 6,
          width: 20, height: 20, borderRadius: RADIUS.pill, border: '2px solid #fff',
          background: fillCss(value) ?? 'var(--surface)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.35)', cursor: 'default', padding: 0,
        }}
      />
      {open && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', left: -6, bottom: 20, zIndex: 8,
            display: 'flex', gap: 5, padding: 7, borderRadius: 'var(--radius-card)',
            background: 'var(--surface-solid)', boxShadow: 'var(--shadow-pop)',
          }}
        >
          {WIDGET_FILLS.map((f) => (
            <button
              key={f.id}
              onClick={(e) => { e.stopPropagation(); onPick(f.id === 'theme' ? undefined : f.id); setOpen(false); }}
              title={f.label}
              style={{
                width: 20, height: 20, borderRadius: RADIUS.pill, cursor: 'default', padding: 0,
                background: f.css ?? 'var(--surface)',
                border: (value ?? 'theme') === f.id ? '2px solid var(--accent)' : '1px solid var(--divider-strong)',
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
