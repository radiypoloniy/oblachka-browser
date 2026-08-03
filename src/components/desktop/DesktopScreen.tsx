import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { Search, Sparkles, Workflow, Check, Plus, X, LayoutGrid } from 'lucide-react';
import type { TileSite } from '../../../shared/frecency';
import {
  loadDesktop, saveDesktop, subscribeDesktop, computeGrid, layoutItems,
  resizeItem, removeItem, addItem,
  type DesktopLayout,
} from '../../newtab/desktop';
import AddSheet from './AddSheet';
import {
  loadNewTabSettings, subscribeNewTabSettings, presetCss, getNewTabCustomImage,
  ensureCustomImageShrunk, isLightBackground, type NewTabSettings,
} from '../../newtab/settings';
import { APPS, AppIconBadge } from '../aiApps';
import SiteIcon from './SiteIcon';
import { WIDGET_FILLS, WIDGET_RENDERERS, fillCss } from './widgets';

// Рабочий стол новой вкладки — springboard в духе iPad: сетка иконок и виджетов поверх обоев.
// Раскладку считает src/newtab/desktop.ts (там же объяснено, почему элементы хранят порядок, а
// не координаты), здесь — только отрисовка.

interface Props {
  onSubmit: (input: string) => void;
  onOpenAi: () => void;
  onOpenGraph: () => void;
  tiles: TileSite[];
  isLightWindow?: boolean;
  /** Открыть локальное приложение (калькулятор и т.п.) — их слоты живут в AI-панели. */
  onOpenApp: (appId: string) => void;
}

// Палитры текста и «стекла» — те же, что были у минималистичной вкладки: фон бывает и белым
// (по умолчанию), и тёмным, и на белом светлый текст просто не виден.
const DARK_PALETTE: Record<string, string> = {
  '--nt-text': 'rgba(255,255,255,0.96)',
  '--nt-text-soft': 'rgba(255,255,255,0.78)',
  '--nt-shadow': '0 1px 2px rgba(0,0,0,0.28), 0 2px 10px rgba(0,0,0,0.18)',
  '--nt-field': 'rgba(0,0,0,0.30)',
  '--nt-field-border': 'rgba(255,255,255,0.22)',
  '--nt-field-text': '#fff',
  '--nt-plate': 'rgba(0,0,0,0.28)',
  '--nt-plate-border': 'rgba(255,255,255,0.16)',
};

const LIGHT_PALETTE: Record<string, string> = {
  '--nt-text': 'rgba(28,28,32,0.92)',
  '--nt-text-soft': 'rgba(28,28,32,0.60)',
  '--nt-shadow': 'none',
  '--nt-field': 'rgba(255,255,255,0.92)',
  '--nt-field-border': 'rgba(0,0,0,0.10)',
  '--nt-field-text': 'rgba(28,28,32,0.92)',
  '--nt-plate': 'rgba(255,255,255,0.78)',
  '--nt-plate-border': 'rgba(0,0,0,0.07)',
};

export default function DesktopScreen({ onSubmit, onOpenAi, onOpenGraph, tiles, isLightWindow = false, onOpenApp }: Props) {
  const [settings, setSettings] = useState<NewTabSettings>(() => loadNewTabSettings());
  const [layout, setLayout] = useState<DesktopLayout>(() => loadDesktop());
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const areaRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Режим правки. Пока он включён, элементы не открываются по клику: попасть по крестику и
  // случайно уйти на сайт — самая обидная ошибка такого интерфейса.
  const [editing, setEditing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Что сейчас тащат/тянут. Держим отдельно от раскладки: пока жест идёт, на диск ничего не
  // пишем — иначе каждое движение мыши превращалось бы в запись в localStorage.
  // ⚠️ Хранит не только «куда встанет», но и смещение курсора: без него элемент оставался
  // на месте, пока его тащили, — двигалась лишь прозрачность. Именно это и выглядело криво:
  // жест есть, отклика нет.
  const [drag, setDrag] = useState<{
    id: string; overIndex: number;
    startX: number; startY: number; dx: number; dy: number;
    // ⚠️ Позиция элемента В МОМЕНТ ЗАХВАТА. Он рисуется от неё, а не от будущей клетки: место
    // назначения меняется по ходу жеста, и элемент прыгал следом за ним, уезжая из-под курсора.
    originX: number; originY: number;
  } | null>(null);
  const [resizing, setResizing] = useState<{ id: string; w: number; h: number } | null>(null);

  useEffect(() => subscribeNewTabSettings(() => setSettings(loadNewTabSettings())), []);
  useEffect(() => subscribeDesktop(() => setLayout(loadDesktop())), []);

  useEffect(() => {
    if (settings.background.kind === 'custom') ensureCustomImageShrunk();
  }, [settings.background.kind]);

  useEffect(() => {
    if (settings.background.kind !== 'photo') return;
    let alive = true;
    void window.oblako.getNewtabPhoto().then((r) => {
      if (alive && r.ok && r.dataUrl) setPhotoUrl(r.dataUrl);
    }).catch(() => { /* фон — украшение */ });
    return () => { alive = false; };
  }, [settings.background.kind]);

  // Ширина области сетки — от неё считаются колонки и размер клетки.
  //
  // ⚠️ useLayoutEffect, а не useEffect: при обычном эффекте первый кадр успевал нарисоваться с
  // width===0, то есть с минимальными четырьмя колонками и мелкой клеткой — виджеты сваливались
  // в кучу и через мгновение прыгали на места. Здесь замер происходит ДО того, как браузер
  // покажет кадр, и промежуточного состояния не существует.
  //
  // ⚠️ Обновления ResizeObserver прогоняются через requestAnimationFrame: тянущий границу окна
  // человек генерирует десятки событий в секунду, и каждое пересчитывало всю раскладку прямо в
  // обработчике — отсюда рывки при ресайзе.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    let frame = 0;
    const measure = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth(el.clientWidth));
    };
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
  }, []);

  // Правка раскладки: сохраняем сразу — стол это косметика, отдельной кнопки «применить» тут
  // не нужно, а неожиданно потерянная перестановка раздражает сильнее лишней записи.
  const apply = (next: DesktopLayout): void => { setLayout(next); saveDesktop(next); };

  const light = isLightBackground(settings.background);
  const grid = useMemo(() => computeGrid(Math.max(320, width)), [width]);
  // ⚠️ Раскладка считается по ПРЕДПОЛАГАЕМОМУ состоянию: во время перетаскивания элемент уже
  // стоит на новом месте, во время растягивания — уже нового размера. Соседи из-за этого
  // разъезжаются прямо под рукой (у них transition на transform), а не прыгают после отпускания.
  // ⚠️ Раскладка БЕЗ перетаскиваемого элемента — стабильная база для расчёта места вставки.
  //
  // Здесь была настоящая ловушка обратной связи: место считалось по той же раскладке, которую
  // сам расчёт и менял. Элемент вставал на новое место → соседи сдвигались → под курсором
  // оказывалась другая клетка → индекс менялся обратно → и так каждый кадр. Именно это и
  // выглядело как резкая дрожь в конце движения. База, из которой элемент изъят, от индекса не
  // зависит, поэтому колебаться нечему.
  const dragBase = useMemo(
    () => (drag ? layout.items.filter((i) => i.id !== drag.id) : layout.items),
    [layout.items, drag],
  );
  const basePlaced = useMemo(
    () => (drag ? layoutItems(dragBase, grid.cols).placed : null),
    [dragBase, grid.cols, drag],
  );

  const preview = useMemo(() => {
    if (drag) {
      const item = layout.items.find((i) => i.id === drag.id);
      if (!item) return layout;
      const at = Math.max(0, Math.min(dragBase.length, drag.overIndex));
      return { ...layout, items: [...dragBase.slice(0, at), item, ...dragBase.slice(at)] };
    }
    if (resizing) return resizeItem(layout, resizing.id, { w: resizing.w, h: resizing.h });
    return layout;
  }, [layout, drag, resizing, dragBase]);

  const { placed, rows } = useMemo(
    () => layoutItems(preview.items, grid.cols),
    [preview.items, grid.cols],
  );

  // Пока ширина не измерена, сетки нет вовсе: показать её «как получится» и переставить через
  // кадр — это и есть та самая куча при запуске.
  const ready = width > 0;
  const step = grid.cell + grid.gap;
  const appById = useMemo(() => new Map(APPS.map((a) => [a.id, a])), []);

  // Индекс места, куда встанет перетаскиваемый элемент. Считаем по клетке под курсором, а не по
  // пересечению с соседями: сетка резиновая, а клетка — единственная величина, одинаково
  // понятная и человеку, и укладчику.
  // Индекс вставки СРЕДИ ОСТАВШИХСЯ элементов (см. dragBase выше). Возвращает позицию в
  // списке без перетаскиваемого — именно её ждёт preview.
  const indexAtPoint = (clientX: number, clientY: number): number => {
    const box = gridRef.current?.getBoundingClientRect();
    const base = basePlaced;
    if (!box || !base) return dragBase.length;
    const col = Math.max(0, Math.min(grid.cols - 1, Math.floor((clientX - box.left) / step)));
    const row = Math.max(0, Math.floor((clientY - box.top) / step));
    const hit = base.find((p) => col >= p.col && col < p.col + p.w && row >= p.row && row < p.row + p.h);
    if (hit) {
      const idx = dragBase.findIndex((i) => i.id === hit.item.id);
      // Правая половина занятой клетки — «после неё», левая — «перед». ⚠️ Порог с запасом
      // (55/45), а не ровно посередине: на границе половин дрожание вернулось бы уже из-за
      // сотых долей пикселя при движении мыши.
      const half = (clientX - box.left) - (hit.col * step) > (hit.w * step) * 0.55;
      return half ? idx + 1 : idx;
    }
    const below = base.find((p) => p.row > row);
    return below ? dragBase.findIndex((i) => i.id === below.item.id) : dragBase.length;
  };

  const onItemPointerDown = (e: React.PointerEvent, id: string): void => {
    if (!editing || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const at = placed.find((p) => p.item.id === id);
    setDrag({
      id, overIndex: layout.items.findIndex((i) => i.id === id),
      startX: e.clientX, startY: e.clientY, dx: 0, dy: 0,
      originX: (at?.col ?? 0) * step, originY: (at?.row ?? 0) * step,
    });
  };

  const onGridPointerMove = (e: React.PointerEvent): void => {
    if (drag) {
      setDrag({
        ...drag,
        overIndex: indexAtPoint(e.clientX, e.clientY),
        dx: e.clientX - drag.startX,
        dy: e.clientY - drag.startY,
      });
      return;
    }
    if (!resizing) return;
    const box = gridRef.current?.getBoundingClientRect();
    const item = placed.find((p) => p.item.id === resizing.id);
    if (!box || !item) return;
    // Тянем от левого-верхнего угла элемента: сколько клеток укладывается до курсора.
    const w = Math.max(1, Math.min(grid.cols, Math.round((e.clientX - box.left - item.col * step) / step)));
    const h = Math.max(1, Math.min(4, Math.round((e.clientY - box.top - item.row * step) / step)));
    if (w !== resizing.w || h !== resizing.h) setResizing({ ...resizing, w, h });
  };

  const onGridPointerUp = (): void => {
    // Применяем ровно ту раскладку, которую человек видел под рукой: пересчитывать её заново
    // другим способом — верный путь к «отпустил, а встало не туда».
    if (drag) { apply(preview); setDrag(null); }
    if (resizing) { apply(resizeItem(layout, resizing.id, { w: resizing.w, h: resizing.h })); setResizing(null); }
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'var(--radius-island)',
      ...(light ? LIGHT_PALETTE : DARK_PALETTE),
    } as React.CSSProperties}>
      <Background bg={settings.background} photoUrl={photoUrl} />

      {/* ⚠️ scrollbarGutter: stable — не косметика, а вторая половина починки дрожания (первая
          в computeGrid). Полоса прокрутки отнимает ~15 px ширины, ширина задаёт число колонок,
          число колонок задаёт высоту, а высота решает, нужна ли полоса. Замкнутый круг: на
          некоторых размерах окна раскладка колебалась между «с полосой» и «без полосы»
          несколько раз в секунду. Постоянно зарезервированный жёлоб разрывает связь ширины с
          наличием полосы — мерить становится нечего. */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 2, overflowY: 'auto', scrollbarGutter: 'stable',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '28px 24px 40px',
      }}>
        {/* ⚠️ Содержимое центрируется по вертикали ЧЕРЕЗ auto-поля, а не justify-content: center.
            На большом экране стол занимал верхнюю треть, и низ выглядел брошенным; но обычное
            центрирование во flex при переполнении срезает ВЕРХ содержимого — прокрутить к нему
            уже нельзя. Auto-поля в переполненном контейнере схлопываются в ноль, и список
            остаётся целым. */}
        <div style={{ marginTop: 'auto', flex: 'none' }} />
        {settings.search.show && <SearchBar onSubmit={onSubmit} />}

        {/* Область сетки: меряем её ширину, а саму сетку центрируем — на широком экране она
            перестаёт расти (см. потолки в computeGrid) и стоит по центру, как springboard. */}
        <div ref={areaRef} style={{ width: '100%', maxWidth: 1320, marginTop: settings.search.show ? 26 : 0 }}>
          <div
            ref={gridRef}
            onPointerMove={onGridPointerMove}
            onPointerUp={onGridPointerUp}
            onPointerCancel={onGridPointerUp}
            style={{
              position: 'relative', margin: '0 auto',
              width: grid.width, height: rows * step - grid.gap,
              // В режиме правки курсор над сеткой сообщает, что элементы можно двигать.
              cursor: editing ? (drag ? 'grabbing' : 'grab') : undefined,
            }}
          >
            {/* ⚠️ Подсветки будущего места здесь НЕТ намеренно. Она сбивала: на экране
                одновременно оказывались элемент под курсором, контур цели и разъехавшиеся
                соседи — три сигнала об одном и том же. Расступившиеся соседи показывают исход
                однозначно, как на домашнем экране iPad. */}

            {ready && placed.map(({ item, col, row, w, h }) => {
              // Размер во время жеста уже новый: раскладка считается по preview (см. выше), так
              // что и сам элемент, и расступившиеся соседи двигаются одновременно.
              const live = { w, h };
              const stretching = resizing?.id === item.id;
              const box = {
                width: live.w * grid.cell + (live.w - 1) * grid.gap,
                height: live.h * grid.cell + (live.h - 1) * grid.gap,
              };
              const dragging = drag?.id === item.id;
              // Перетаскиваемый живёт отдельно от сетки: он идёт от места захвата за курсором и
              // НЕ переезжает вместе с расчётом будущей клетки.
              const held = dragging
                ? `translate3d(${drag.originX + drag.dx}px, ${drag.originY + drag.dy}px, 0) scale(1.04)`
                : null;
              const style: React.CSSProperties = {
                position: 'absolute', left: 0, top: 0,
                // ⚠️ Позиция — transform, а не left/top. Смена left/top заставляет браузер
                // пересчитывать раскладку и перерисовывать слой на каждом кадре анимации;
                // transform уходит в композитор и двигает уже готовую текстуру.
                transform: held ?? `translate3d(${col * step}px, ${row * step}px, 0)`,
                width: box.width, height: box.height,
                zIndex: dragging || resizing?.id === item.id ? 5 : 1,
                // Пока элемент в руке — никакого перехода: он обязан быть точно под курсором,
                // иначе тянется следом с задержкой и промахивается мимо места.
                transition: dragging || !ready ? undefined
                  : stretching ? 'transform 220ms var(--ease-out)'
                  : 'transform 220ms var(--ease-out), width 180ms var(--ease-out), height 180ms var(--ease-out)',
                filter: dragging ? 'drop-shadow(0 12px 24px rgba(10,12,20,0.35))' : undefined,
                touchAction: editing ? 'none' : undefined,
                // ⚠️ Дрожание вешаем на ВНУТРЕННИЙ слой (см. ниже), а не сюда: анимация transform
                // на этом элементе затёрла бы позиционирующий translate3d.
                willChange: dragging || editing ? 'transform' : undefined,
              };

              const content = item.kind === 'widget' ? (() => {
                const Render = WIDGET_RENDERERS[item.widget ?? ''];
                return Render ? (
                  // ⚠️ Погода заливку НЕ получает намеренно: там цвет означает время суток и
                  // саму погоду (ночью тёмная, в грозу свинцовая), и подмена его на выбранный
                  // стёрла бы единственный виджет, где цвет — сообщение, а не оформление.
                  <Render size={item.size} box={box} tiles={tiles} onOpen={onSubmit}
                    city={settings.weather.city}
                    fill={item.widget === 'weather' ? undefined : item.fill} />
                ) : null;
              })() : item.kind === 'app' ? (() => {
                const app = appById.get(item.appId ?? '');
                if (!app) return null;
                const iconSize = Math.round(grid.cell * 0.72);
                return (
                  <button
                    onClick={() => { if (!editing) onOpenApp(app.id); }}
                    title={app.label}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      width: '100%', height: '100%', padding: 0, border: 'none',
                      background: 'transparent', cursor: 'default',
                    }}
                  >
                    <AppIconBadge app={app} size={iconSize} iconSize={Math.round(iconSize * 0.56)} shadow />
                    <span style={{
                      maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      fontSize: 'var(--fs-xs)', fontWeight: 500,
                      color: 'var(--nt-text)', textShadow: 'var(--nt-shadow)',
                    }}>{app.label}</span>
                  </button>
                );
              })() : (
                <SiteIcon
                  url={item.url ?? ''}
                  title={item.title ?? ''}
                  size={Math.round(grid.cell * 0.72)}
                  onOpen={(url) => { if (!editing) onSubmit(url); }}
                  labelColor="var(--nt-text)"
                  labelShadow="var(--nt-shadow)"
                />
              );

              return (
                <div
                  key={item.id}
                  // Атрибут нужен диагностике: по нему проверка находит конкретный элемент
                  // сетки, не угадывая его по стилям.
                  data-desktop-item={item.id}
                  style={style}
                  onPointerDown={(e) => onItemPointerDown(e, item.id)}
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
                        onClick={() => apply(removeItem(layout, item.id))}
                        title="Убрать с экрана"
                        style={{
                          position: 'absolute', top: -8, left: -8, zIndex: 6,
                          width: 22, height: 22, borderRadius: 999, border: 'none', cursor: 'default',
                          background: 'rgba(30,30,34,0.92)', color: '#fff',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
                        }}
                      ><X size={13} /></button>

                      {/* Выбор заливки — только у виджетов и только в режиме правки: цвет это
                          настройка вида, а не действие, и в обычном режиме кнопке над плиткой
                          делать нечего. Погоду не трогаем — там цвет несёт смысл. */}
                      {item.kind === 'widget' && item.widget !== 'weather' && (
                        <FillPicker
                          value={item.fill}
                          onPick={(fill) => apply({
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
                            setResizing({ id: item.id, w, h });
                          }}
                          title="Потяните, чтобы изменить размер"
                          style={{
                            position: 'absolute', right: -6, bottom: -6, zIndex: 6,
                            width: 20, height: 20, borderRadius: 999,
                            background: stretching ? 'var(--accent)' : 'rgba(30,30,34,0.92)',
                            cursor: 'nwse-resize',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transform: stretching ? 'scale(1.15)' : undefined,
                            transition: 'transform 120ms var(--ease-out), background 120ms var(--ease-standard)',
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
            })}
          </div>
        </div>
        <div style={{ marginBottom: 'auto', flex: 'none' }} />
      </div>

      {/* Управление. В режиме правки набор кнопок другой: добавить и «Готово» — остальное
          сейчас неуместно, человек занят одним делом. */}
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 30, display: 'flex', gap: 8 }}>
        {editing ? (
          <>
            <CornerButton title="Добавить виджет, приложение или сайт" onClick={() => setSheetOpen(true)}>
              <Plus size={18} />
            </CornerButton>
            <button
              onClick={() => { setEditing(false); setSheetOpen(false); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, height: 40, padding: '0 16px',
                borderRadius: 999, border: 'none', cursor: 'default',
                background: 'var(--accent)', color: 'var(--on-accent)',
                fontSize: 'var(--fs-sm)', fontWeight: 600, boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
              }}
            ><Check size={16} /> Готово</button>
          </>
        ) : (
          <>
            <CornerButton title="Настроить экран" onClick={() => setEditing(true)}>
              <LayoutGrid size={18} />
            </CornerButton>
            {!isLightWindow && (
              <>
                <CornerButton title="Граф-воркспейс" onClick={onOpenGraph}><Workflow size={18} /></CornerButton>
                <CornerButton title="AI-режим" onClick={onOpenAi}><Sparkles size={18} /></CornerButton>
              </>
            )}
          </>
        )}
      </div>

      {sheetOpen && (
        <AddSheet
          layout={layout}
          onAdd={(item) => { apply(addItem(layout, item)); setSheetOpen(false); }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}

function CornerButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 40, height: 40, borderRadius: 999, border: 'none', cursor: 'default',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--nt-plate)', backdropFilter: 'blur(12px)',
        color: 'var(--nt-text)', boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
      }}
    >{children}</button>
  );
}

function SearchBar({ onSubmit }: { onSubmit: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); const v = value.trim(); if (v) { onSubmit(v); setValue(''); } }}
      style={{ width: '100%', maxWidth: 560, flex: 'none' }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, height: 48, padding: '0 18px',
        borderRadius: 999, background: 'var(--nt-field)', backdropFilter: 'blur(16px)',
        border: '1px solid var(--nt-field-border)', boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
      }}>
        <Search size={17} style={{ color: 'var(--nt-field-text)', opacity: 0.75, flex: 'none' }} />
        <input
          className="newtab-search-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Поиск или адрес"
          autoFocus
          style={{
            flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
            fontSize: 'var(--fs-md)', color: 'var(--nt-field-text)',
          }}
        />
      </div>
    </form>
  );
}

function Background({ bg, photoUrl }: { bg: NewTabSettings['background']; photoUrl: string | null }) {
  const base: React.CSSProperties = {
    position: 'absolute', inset: 0, zIndex: 0,
    backgroundSize: 'cover', backgroundPosition: 'center',
    filter: bg.blur > 0 ? `blur(${bg.blur}px)` : undefined,
    transform: bg.blur > 0 ? 'scale(1.06)' : undefined, // прячем размытые края
  };
  const style: React.CSSProperties =
    bg.kind === 'color' ? { ...base, background: bg.color }
    : bg.kind === 'custom' ? (() => {
        const url = getNewTabCustomImage();
        return url ? { ...base, backgroundImage: `url("${url}")` } : { ...base, background: presetCss('aurora') };
      })()
    : bg.kind === 'photo' ? (photoUrl
        ? { ...base, backgroundImage: `url("${photoUrl}")` }
        : { ...base, background: presetCss(bg.preset) })
    : { ...base, background: presetCss(bg.preset) };

  return (
    <>
      <div style={style} />
      {bg.dim > 0 && <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: `rgba(0,0,0,${bg.dim})` }} />}
    </>
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
          width: 20, height: 20, borderRadius: 999, border: '2px solid #fff',
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
                width: 20, height: 20, borderRadius: 999, cursor: 'default', padding: 0,
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
