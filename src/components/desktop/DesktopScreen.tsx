import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { Search, Sparkles, Workflow, Check, Plus, SlidersHorizontal } from 'lucide-react';
import type { TileSite } from '../../../shared/frecency';
import {
  loadDesktop, subscribeDesktop, addItem, type DesktopLayout,
} from '../../newtab/desktop';
import AddSheet from './AddSheet';
import SidePanel from './SidePanel';
import GenStudio, { type GenGhost } from './GenStudio';
import {
  loadNewTabSettings, subscribeNewTabSettings, presetCss, getNewTabCustomImage,
  ensureCustomImageShrunk, isLightBackground, type NewTabSettings,
} from '../../newtab/settings';
import { findMesh, meshCss } from '../../newtab/gradients';
import { GRAIN, noise } from '../../styles/island';

// Полотно зерна собирается ОДИН раз на модуль, а не в рендере: это data-URI на несколько сотен
// символов, и пересобирать его на каждую перерисовку стола незачем — строка всегда одна и та же.
const GRAIN_LAYER: React.CSSProperties = {
  position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
  backgroundImage: noise(GRAIN.tinted),
};

// Фактура печати для ПЛОСКИХ обоев — общее зерно системы, поднятое на слой фона.
const FLAT_GRAIN_LAYER: React.CSSProperties = { ...grain, zIndex: 1 };
import { useDesktopGrid } from './useDesktopGrid';
import { DesktopGrid } from './DesktopGrid';
import { RADIUS, grain } from '../../styles/system';

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
  // Крупная надпись живёт по своим правилам, см. Greeting: на тёмных обоях она почти белая и
  // держит две ступени тени — ближнюю для контакта, дальнюю для глубины.
  '--nt-text-display': 'rgba(255,255,255,0.97)',
  '--nt-shadow-display': '0 1px 2px rgba(0,0,0,0.22), 0 10px 34px rgba(0,0,0,0.26)',
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
  // ⚠️ На светлом фоне надпись НЕ чёрная. Почти-чёрный (0.92) на нежном градиенте читается как
  // чужеродная плашка поверх картинки: контраст такой, будто текст вырезали из другого макета.
  // Глубокие чернила с частичной прозрачностью пропускают фон сквозь себя — надпись садится на
  // градиент, а не лежит на нём. Читаемость при этом остаётся: 0.78 от почти-чёрного на светлом
  // фоне держит контраст выше 7:1, то есть с запасом над AA даже для мелкого текста.
  '--nt-text-display': 'rgba(30,32,44,0.78)',
  // Тени нет вовсе: на светлом она превращается в грязь, а надписи такого кегля она не нужна.
  '--nt-shadow-display': 'none',
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
  const [panelOpen, setPanelOpen] = useState(false);
  // Сборка своего виджета — отдельный режим стола (см. GenStudio): панель на это время уходит,
  // потому что настраивать экран и собирать виджет одновременно не выйдет — оба хотят правый край.
  const [studioOpen, setStudioOpen] = useState(false);
  // Правка виджета, который уже стоит: id записи вместо новой сборки (см. GenStudio).
  const [studioEditId, setStudioEditId] = useState<string | null>(null);
  // Как выглядит болванка прямо сейчас. Живёт здесь, потому что рисует её сетка стола, а не
  // окно сборки: болванка обязана быть такой же плиткой, как соседние, и стоять среди них.
  const [ghost, setGhost] = useState<GenGhost | null>(null);
  // Что сейчас тащат/тянут. Держим отдельно от раскладки: пока жест идёт, на диск ничего не
  // пишем — иначе каждое движение мыши превращалось бы в запись в localStorage.
  // ⚠️ Хранит не только «куда встанет», но и смещение курсора: без него элемент оставался
  // на месте, пока его тащили, — двигалась лишь прозрачность. Именно это и выглядело криво:
  // жест есть, отклика нет.

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
  const light = isLightBackground(settings.background);
  // Геометрия сетки и жесты переноса/растягивания — в useDesktopGrid.
  // ⚠️ Результат хука уезжает в сетку ОДНИМ объектом. Разложить его на двадцать пропсов
  // технически можно, но список пришлось бы держать в синхроне в трёх местах: тут, в сигнатуре
  // сетки и в самом хуке. Здесь это не «мешок всего», а связная модель одного предмета.
  const g = useDesktopGrid({ layout, setLayout, width, editing, studioOpen, studioEditId, ghost, gridRef });

  return (
    <div style={{
      position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'var(--radius-island)',
      ...(light ? LIGHT_PALETTE : DARK_PALETTE),
    } as React.CSSProperties}>
      <Background bg={settings.background} photoUrl={photoUrl} />

      {/* ⚠️ scrollbarGutter: stable — не косметика, а вторая половина починки дрожания (первая
          в computeGrid). Полоса прокрутки отнимает ~15 px ширины, ширина задаёт размер клетки,
          размер клетки задаёт высоту, а высота решает, нужна ли полоса. Замкнутый круг: на
          некоторых размерах окна раскладка колебалась между «с полосой» и «без полосы»
          несколько раз в секунду. Постоянно зарезервированный жёлоб разрывает связь ширины с
          наличием полосы — мерить становится нечего. (Число колонок с шириной больше не
          связано вовсе, но связь «ширина → высота» осталась, значит остаётся и жёлоб.) */}
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
        {/* ⚠️ Приветствие рисуется ЗДЕСЬ. В панели настройка на него была, а на экране его не
            существовало — то есть тумблер ничего не переключал. Это была не пропажа дизайна,
            а недоделка: на springboard-версии стола его просто забыли перенести. */}
        {settings.greeting.show && <Greeting name={settings.greeting.name} />}
        {settings.search.show && <SearchBar onSubmit={onSubmit} />}

        {/* Область сетки: меряем её ширину, а саму сетку центрируем — на широком экране она
            перестаёт расти (см. потолки в computeGrid) и стоит по центру, как springboard. */}
      <DesktopGrid
        g={g} layout={layout} settings={settings} tiles={tiles} editing={editing}
        ghost={ghost} areaRef={areaRef} gridRef={gridRef}
        onSubmit={onSubmit} onOpenApp={onOpenApp}
        setStudioOpen={setStudioOpen} setStudioEditId={setStudioEditId}
      />
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
                borderRadius: RADIUS.pill, border: 'none', cursor: 'default',
                background: 'var(--accent)', color: 'var(--on-accent)',
                fontSize: 'var(--fs-sm)', fontWeight: 600, boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
              }}
            ><Check size={16} /> Готово</button>
          </>
        ) : (
          <>
            {/* ⚠️ ДВЕ кнопки, и это не дубль. «Настройка» (панель) — что показывать и как оно
                выглядит; «Правка» (режим на самом столе) — где что лежит, то есть перетаскивание
                и размеры. Раньше и то и другое пряталось за одной кнопкой, а часть настроек жила
                вообще в отдельном разделе — именно это и было неудобно. */}
            <CornerButton title="Настроить экран" onClick={() => setPanelOpen(true)}>
              <SlidersHorizontal size={18} />
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

      {panelOpen && (
        <SidePanel
          layout={layout}
          onLayout={g.apply}
          editing={editing}
          onEditing={setEditing}
          onClose={() => setPanelOpen(false)}
          onStudio={() => { setPanelOpen(false); setStudioOpen(true); }}
        />
      )}

      {studioOpen && (
        <GenStudio
          editId={studioEditId ?? undefined}
          onGhost={setGhost}
          onPlace={(item) => g.apply(addItem(layout, item))}
          onClose={() => { setStudioOpen(false); setGhost(null); setStudioEditId(null); }}
        />
      )}

      {sheetOpen && (
        <AddSheet
          layout={layout}
          tiles={tiles}
          onAdd={(item) => { g.apply(addItem(layout, item)); setSheetOpen(false); }}
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
        width: 40, height: 40, borderRadius: RADIUS.pill, border: 'none', cursor: 'default',
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
        // ⚠️ Поле — такой же остров, что и карточки виджетов: та же поверхность, тот же радиус,
        // та же тень. Прежнее полупрозрачное «стекло на обоях» осталось от минималистичной
        // вкладки, где карточек не было вовсе, и рядом с белыми плитками читалось как чужое.
        display: 'flex', alignItems: 'center', gap: 12, height: 52, padding: '0 20px',
        borderRadius: 'var(--radius-card)', background: 'var(--surface)',
        border: '1px solid var(--divider)',
        boxShadow: '0 1px 2px rgba(16,20,40,0.10), 0 10px 28px rgba(16,20,40,0.16)',
      }}>
        <Search size={18} style={{ color: 'var(--text-faint)', flex: 'none' }} />
        <input
          className="newtab-search-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Поиск или адрес"
          // ⚠️ autoFocus снят намеренно. На новой вкладке фокусом владеет АДРЕСНАЯ СТРОКА
          // (см. App.tsx): человек открывает вкладку, чтобы сразу печатать, и цель у него одна.
          // Два поля на одном экране, спорящие за фокус, давали неопределённость — фокус зависел
          // от того, успел ли смонтироваться стол раньше, чем спряталась вью страницы.
          // Поле никуда не делось и работает по клику.
          style={{
            flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
            fontSize: 'var(--fs-md)', color: 'var(--text-strong)', fontFamily: 'inherit',
          }}
        />
      </div>
    </form>
  );
}

function Background({ bg, photoUrl }: { bg: NewTabSettings['background']; photoUrl: string | null }) {
  const base: React.CSSProperties = {
    position: 'absolute', inset: 0, zIndex: 0,
    backgroundSize: 'cover',
    // ⚠️ Не 'center': на широком окне вертикальный сюжет режется ровно посередине, и в кадр
    // попадает случайная середина фотографии — на живом снимке это оказалось лицо крупным планом.
    // В пейзаже, городе и почти любом снимке значимое лежит ВЫШЕ середины, а низ — передний план.
    backgroundPosition: 'center 35%',
    backgroundRepeat: 'no-repeat',
    filter: bg.blur > 0 ? `blur(${bg.blur}px)` : undefined,
    transform: bg.blur > 0 ? 'scale(1.06)' : undefined, // прячем размытые края
  };
  // ⚠️ ТОЛЬКО ДЛИННЫЕ СВОЙСТВА, никакого шортката `background`. Это не стиль ради стиля, а
  // починенный баг: пресеты ставились шорткатом, а фото — через backgroundImage. При переключении
  // на фото React сначала обнуляет пропавший шорткат (`style.background = ''`), а он сбрасывает
  // ВСЮ группу, включая backgroundSize; сам же backgroundSize в новом объекте не изменился
  // ('cover' → 'cover'), и React его не переустанавливал. Итог: фото рисовалось в натуральную
  // величину с repeat — на широком окне картинка размножалась плитками (живая жалоба «картинка
  // сломана»). Замер через CDP: computed background-size: auto, background-repeat: repeat.
  const style: React.CSSProperties =
    bg.kind === 'color' ? { ...base, backgroundColor: bg.color, backgroundImage: 'none' }
    : bg.kind === 'custom' ? (() => {
        const url = getNewTabCustomImage();
        return url ? { ...base, backgroundImage: `url("${url}")` } : { ...base, backgroundImage: presetCss('emerald') };
      })()
    : bg.kind === 'photo' ? (photoUrl
        ? { ...base, backgroundImage: `url("${photoUrl}")` }
        : { ...base, backgroundImage: presetCss(bg.preset) })
    : bg.kind === 'mesh' ? (() => {
        const mesh = findMesh(bg.meshId);
        return mesh
          // ⚠️ meshCss, а не compileMeshBackground: сетка обязана следовать теме ровно так же,
          // как превью в настройках и как расчёт isLightBackground. Сырая сетка здесь означала
          // светлые обои под светлым текстом в тёмной теме («Лагуна», «Сумерки»).
          ? { ...base, backgroundImage: meshCss(mesh), backgroundSize: '100% 100%' }
          : { ...base, backgroundImage: presetCss('emerald') };
      })()
    : { ...base, backgroundImage: presetCss(bg.preset) };

  // ⚠️ ЗЕРЕН ЗДЕСЬ ДВА, и это РАЗНЫЕ ЗАДАЧИ, а не дубль — сливать их нельзя.
  //
  //   • ДИЗЕРИНГ (noise/GRAIN из island.ts, сила 0.075) нужен СЕТКЕ: градиент во весь экран идёт
  //     крошечными шагами цвета, и в 8-битном sRGB одна ступень растягивается на десятки
  //     пикселей — получаются полосы. Зерно их разбивает. Сила там подобрана под эту работу:
  //     сильнее — и шум сам станет заметнее полос, которые он лечит.
  //   • ФАКТУРА (grain из system.ts, сила 0.45) нужна ПЛОСКОЙ КРАСКЕ: обои перестали быть
  //     градиентом, полос у них нет вовсе, а ровная краска на весь экран без материала читается
  //     как заливка из макета. Это то же зерно, что на плитках стола и на плакатных плоскостях
  //     страниц, — одно на всю систему.
  //
  // ⚠️ У фотографии нет ни того, ни другого: у снимка своя фактура, и шум поверх неё читается
  // грязью, а не материалом.
  const flatPaint = bg.kind === 'preset' || bg.kind === 'color';
  const grainy = flatPaint || bg.kind === 'mesh';

  return (
    <>
      <div style={style} />
      {grainy && (
        <div style={flatPaint ? FLAT_GRAIN_LAYER : GRAIN_LAYER} />
      )}
      {bg.dim > 0 && <div style={{ position: 'absolute', inset: 0, zIndex: 2, background: `rgba(0,0,0,${bg.dim})` }} />}
    </>
  );
}


// Приветствие над поиском. Текст зависит от времени суток — это единственное, что делает его
// живым; без него это была бы просто строка с именем.
function Greeting({ name }: { name: string }) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  return (
    // ⚠️ Кегль задан clamp по ширине окна, а не токеном: приветствие — единственная НАДПИСЬ на
    // этом экране, а не элемент интерфейса, и жить по шкале интерфейса ему незачем. Токен
    // --fs-xl (22px) делал из него подпись к строке поиска; здесь нужен размер, который держит
    // весь верх экрана. Потолок обязателен — на 2560 px без него надпись перекрыла бы виджеты.
    //
    // ⚠️ Плотный трекинг (--ls-tight) — то, что отличает крупную надпись от просто увеличенного
    // текста: у Golos Text на 56 px межбуквенное расстояние, рассчитанное для 14 px, выглядит
    // разреженным и дешёвым. Вес 700 — потолок оси этого шрифта (400..700), светлее делать
    // нечем и не нужно: объём здесь даёт размер, а не начертание.
    //
    // ⚠️ Тень СВОЯ, а не --nt-shadow. Та рассчитана на мелкий текст поверх обоев и на 56 px
    // выглядит грязным ореолом. Здесь две ступени: ближняя даёт контакт, дальняя — глубину; на
    // светлом фоне обе гасятся до едва заметной (см. LIGHT_PALETTE, там --nt-shadow вовсе none).
    <div style={{
      flex: 'none', marginBottom: 22, textAlign: 'center',
      fontSize: 'clamp(30px, 4.6vw, 60px)',
      // ⚠️ ДИСПЛЕЙНАЯ гарнитура: приветствие — «лицо» продукта, а не элемент интерфейса. Это
      // ровно то место, ради которого третья гарнитура и заводилась (см. DISPLAY в
      // styles/system.ts); в настройки и списки она не заходит никогда.
      fontFamily: 'var(--font-display)',
      fontWeight: 800,
      letterSpacing: '-0.035em',
      lineHeight: 1.02,
      color: 'var(--nt-text-display)',
      textShadow: 'var(--nt-shadow-display)',
    }}>
      {name.trim() ? `${part}, ${name.trim()}` : part}
    </div>
  );
}
