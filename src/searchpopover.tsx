// Поповер быстрого поиска (Ctrl+E) — отдельная WebContentsView поверх страницы
// (см. electron/SearchPopoverManager.ts). Суть: сначала запрос, цель — потом.
//
// Цель выбирается чипами, первой стоит текущий сайт (electron/SearchTargets.ts). Бэнг «!ключ»
// в самой строке — по-прежнему рабочий путь и главный запасной выход, когда нужной цели в
// полосе нет: main разбирает его на каждый ввод и присылает готовую цель (QuickQueryResult),
// а поповер лишь показывает её. Своего парсера здесь намеренно нет — разъехавшийся разбор в
// двух местах ровно тот класс багов, который проект уже ловил на дропдауне подсказок.
//
// Раскладка — ТРИ отдельных острова (строка / цели / находки), а не один плотный прямоугольник:
// поповер живёт поверх произвольной страницы, и воздух между блоками — единственное, что
// отделяет его от чужой вёрстки под ним. Каждый остров собран по общему рецепту дизайн-системы
// (см. islandCard ниже), размеры взяты «на палец», а не «на пиксель»: это поиск, в него целятся
// мышью и читают краем глаза.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Search, CornerDownLeft, Clock, Star, PanelTop, Globe, ChevronDown, ChevronUp, type LucideIcon } from 'lucide-react';
import './styles/global.css';
import type { SearchTarget, QuickHit, QuickQueryResult } from '../shared/ipc';
import { installOverlayReveal } from './overlayReveal';
import { OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics';
import { RADIUS } from './styles/system';

interface ShowPayload { targets: SearchTarget[]; prefill: string }

declare global {
  interface Window {
    searchPopover: {
      onShow: (cb: (p: ShowPayload) => void) => () => void
      run: (query: string, target: SearchTarget, sameTab: boolean) => void
      query: (text: string) => Promise<QuickQueryResult>
      open: (hit: QuickHit) => void
      resize: (height: number) => void
      close: () => void
    }
  }
}

// Держать в синхроне с SearchPopoverManager.ts — ширина и базовая высота задают размер вью.
const WIDTH = 620;
// Больше пяти строк в поповере — уже панель истории, а не быстрый выбор.
const MAX_HITS = 5;
const QUERY_DEBOUNCE = 120;
// Сколько целей видно в свёрнутой полосе. Шесть — это ровно одна строка при ширине 620
// и типичной длине имени; остальное прячется под кнопку с ЧИСЛОМ, чтобы было видно, сколько
// там ещё (горизонтальная прокрутка этого не показывала вообще).
const CHIPS_COLLAPSED = 6;

const HIT_ICON = { tab: PanelTop, history: Clock, bookmark: Star } as const;
const HIT_LABEL = { tab: 'вкладка', history: 'история', bookmark: 'закладка' } as const;

// Общий рецепт острова. Тот же набор свойств, что у плашек в сайдбаре/тулбаре, но собран
// здесь: поповер живёт в своей WebContentsView и до src/styles/island.ts не дотягивается
// без лишней связности ради четырёх строк.
const islandCard: React.CSSProperties = {
  // ⚠️ МАТЕРИАЛ, а не плита: поповер — временный слой над землёй, и он обязан брать цвет
  // у того, что под ним. Белая непрозрачная карточка в цветном окне читается вырезанной из
  // другой программы — разбор общий, см. glassPlate в styles/island.ts.
  background: 'var(--material)',
  backdropFilter: 'var(--material-blur)',
  WebkitBackdropFilter: 'var(--material-blur)',
  border: '1px solid var(--glass-edge)',
  borderRadius: 'var(--radius-card)',
  boxShadow: 'var(--shadow-card)',
  boxSizing: 'border-box',
};

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// Плитка иконки: favicon, если он есть, иначе смысловой значок. Квадрат с фоном, а не голая
// линия — на пёстрой странице под поповером контур теряется, заливка держит форму.
function IconTile({ src, Fallback, size = 26 }: {
  src?: string | null;
  Fallback: LucideIcon;
  size?: number;
}) {
  return (
    <span style={{
      width: size, height: size, flex: 'none', borderRadius: 'calc(var(--radius-card) / 2)',
      background: 'var(--surface-sunken)', border: '1px solid var(--glass-edge)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', color: 'var(--text-muted)',
    }}>
      {src
        ? <img src={src} width={Math.round(size * 0.66)} height={Math.round(size * 0.66)} alt="" />
        : <Fallback size={Math.round(size * 0.58)} />}
    </span>
  );
}

// Чип цели. Ключ бэнга показываем в развёрнутом списке: узнать, что цель зовётся «!wb»,
// было больше неоткуда — а именно набор ключа выручает, когда нужной цели в полосе нет.
function Chip({ target, selected, showKey, onClick }: {
  target: SearchTarget; selected: boolean; showKey?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={target.kind === 'site' ? `Поиск по сайту ${target.name}` : target.name}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, flex: 'none',
        maxWidth: 230, height: 40, padding: '0 14px 0 10px',
        border: '1px solid',
        borderColor: selected ? 'transparent' : 'var(--glass-edge)',
        background: selected ? 'var(--accent)' : 'var(--surface-sunken)',
        color: selected ? '#fff' : 'var(--text-body)',
        borderRadius: RADIUS.pill,
        fontSize: 'var(--fs-sm)', fontWeight: selected ? 600 : 500,
        cursor: 'default', fontFamily: 'inherit',
        whiteSpace: 'nowrap', overflow: 'hidden',
      }}
    >
      {target.faviconUrl
        ? <img src={target.faviconUrl} width={18} height={18} alt="" style={{ borderRadius: RADIUS.tight, flex: 'none' }} />
        : <Globe size={17} style={{ flex: 'none', opacity: selected ? 0.9 : 0.55 }} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{target.name}</span>
      {showKey && target.bangKey && (
        <span style={{ flex: 'none', opacity: 0.6, fontSize: 'var(--fs-xs)' }}>!{target.bangKey}</span>
      )}
    </button>
  );
}

function SearchPopover() {
  const [targets, setTargets] = useState<SearchTarget[]>([]);
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<QuickHit[]>([]);
  // -1 — курсор в строке ввода: Enter уходит в веб-поиск. Стрелка вниз опускает его в список
  // находок. Так основной сценарий (набрал → Enter → искать) не меняется от того, нашлось ли
  // что-то своё, а находки остаются осознанным выбором, а не ловушкой под Enter.
  const [hitIndex, setHitIndex] = useState(-1);
  // Цель, названная бэнгом прямо в строке («!wb Xiaomi»), — приходит из main вместе с
  // находками. Пока она есть, полоса чипов не решает ничего: человек уже назвал цель словами.
  const [bangTarget, setBangTarget] = useState<SearchTarget | null>(null);
  const [strippedQuery, setStrippedQuery] = useState('');
  // Свёрнутая полоса показывает первые CHIPS_COLLAPSED, остальное — по кнопке «ещё N».
  // Горизонтальная прокрутка отсюда убрана совсем: она не показывала ни сколько целей всего,
  // ни где ты в них находишься.
  const [chipsExpanded, setChipsExpanded] = useState(false);
  // Счётчик показов. Нужен ровно затем, чтобы на КАЖДОЕ открытие пересчитать и доложить высоту:
  // main сбрасывает её в базовую при каждом показе (см. showSearchPopover), а вот наш DOM при
  // повторном открытии с тем же набором целей не меняется — и ResizeObserver молчит.
  const [showSeq, setShowSeq] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Номер запроса: ответы приходят асинхронно и могут разъехаться с текущим вводом —
  // применяем только ответ на последний.
  const querySeqRef = useRef(0);

  useEffect(() => {
    return window.searchPopover.onShow((p) => {
      setTargets(p.targets);
      setSelected(0);
      setHits([]);
      setHitIndex(-1);
      setBangTarget(null);
      setStrippedQuery('');
      setChipsExpanded(false);
      setShowSeq((n) => n + 1);
      // Выделение со страницы — уже готовый запрос: чаще всего Ctrl+E жмут именно ради него.
      if (p.prefill) setQuery(p.prefill);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    });
  }, []);

  // Высота карточки → main: WebContentsView не растёт под контент сама (см. канал resize).
  //
  // Именно ResizeObserver, а не мерка по изменению данных: перенос чипов на вторую строку
  // зависит от ШИРИНЫ текста, а та доезжает позже самих данных — когда догрузится веб-шрифт
  // (шрифты пока с Google Fonts, см. CLAUDE.md). Мерка «на изменение targets» успевала снять
  // высоту в один ряд, потом строка переносилась, а вью оставалась низкой — остров с целями
  // выглядел обрезанным снизу, и починить это можно было только развернув список (та мерка
  // запускалась заново). Наблюдатель ловит любую причину смены высоты, включая эту.
  // Тот же приём, которым App.tsx меряет область контента.
  const report = useCallback(() => {
    const h = cardRef.current?.offsetHeight;
    if (h) window.searchPopover.resize(h);
  }, []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [report]);

  // ...и отдельно — доклад на каждое ОТКРЫТИЕ, даже если DOM не изменился. Наблюдателя выше для
  // этого не хватает: он срабатывает только на смену высоты, а при повторном Ctrl+E с тем же
  // набором целей высота карточки та же — при том, что main уже сбросил свою в базовую. Ровно
  // так поповер и оказывался обрезанным по первой строке чипов при втором и последующих
  // открытиях. useLayoutEffect, а не rAF: он гарантированно бежит после того, как React положил
  // в DOM новое состояние показа.
  useLayoutEffect(report, [showSeq, report]);

  // Поиск по своим данным на каждое изменение строки, с дебаунсом.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const text = query.trim();
    if (!text) {
      setHits([]);
      setHitIndex(-1);
      setBangTarget(null);
      setStrippedQuery('');
      return;
    }
    const seq = ++querySeqRef.current;
    debounceRef.current = setTimeout(() => {
      void window.searchPopover.query(text).then((r) => {
        if (seq !== querySeqRef.current) return; // ответ на устаревший ввод
        setHits(r.hits.slice(0, MAX_HITS));
        setHitIndex(-1);
        setBangTarget(r.bangTarget);
        setStrippedQuery(r.strippedQuery);
      });
    }, QUERY_DEBOUNCE);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Выбранный чип держим в поле зрения: в развёрнутой сетке он может оказаться ниже видимой
  // части, а переключают цели ещё и с клавиатуры (Tab, Ctrl+цифра).
  useEffect(() => {
    chipsRef.current?.children[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected, chipsExpanded]);

  // Строку отдаём в main КАК ЕСТЬ: бэнг в ней он разберёт сам и перебьёт цель — здесь второго
  // разбора нет намеренно (см. шапку). Цель нужна лишь для случая «бэнга в строке нет».
  const run = (target: SearchTarget | undefined, sameTab: boolean) => {
    const q = query.trim();
    if (!q || !target) return;
    window.searchPopover.run(q, target, sameTab);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      window.searchPopover.close();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[hitIndex];
      if (hit) { window.searchPopover.open(hit); return; }
      // Ctrl+Enter — в текущей вкладке; по умолчанию поиск уходит в новую, чтобы страница,
      // с которой искали, осталась на месте.
      run(targets[selected], e.ctrlKey);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (hits.length === 0) return;
      e.preventDefault();
      // Вверх из первой строки возвращает курсор в поле (-1), а не заворачивает в конец
      // списка: поле — исходное состояние, из него человек и пришёл.
      setHitIndex((i) => {
        const next = i + (e.key === 'ArrowDown' ? 1 : -1);
        return next < -1 ? -1 : next >= hits.length ? hits.length - 1 : next;
      });
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (targets.length === 0) return;
      setSelected((i) => (i + (e.shiftKey ? -1 : 1) + targets.length) % targets.length);
      return;
    }
    // Ctrl+1..9 — прыжок к цели по номеру. Перехватывать этот аккорд тут безопасно: горячие
    // клавиши вкладок (TabManager) висят на webContents СТРАНИЦ, до нашей вью они не доходят.
    if (e.ctrlKey && /^[1-9]$/.test(e.key)) {
      const n = Number(e.key) - 1;
      if (n < targets.length) {
        e.preventDefault();
        setSelected(n);
      }
    }
  };

  const active = targets[selected];

  return (
    // Прозрачный внешний паддинг — место для вытекания теней (вью увеличена на столько же).
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div ref={cardRef} style={{
        width: WIDTH, boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', gap: 8,
        fontFamily: 'var(--font-sans)',
      }}>

        {/* ── Остров 1: строка запроса ── */}
        <div style={{
          ...islandCard,
          display: 'flex', alignItems: 'center', gap: 10,
          height: 58, padding: '0 14px',
        }}>
          <Search size={19} style={{ flex: 'none', color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={active ? `Искать в ${active.name}…` : 'Что найти?'}
            style={{
              flex: 1, minWidth: 0, border: 'none', background: 'transparent',
              fontSize: 'var(--fs-lg)', color: 'var(--text-strong)', outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, flex: 'none',
            padding: '4px 9px', borderRadius: RADIUS.pill,
            background: 'var(--surface-sunken)', border: '1px solid var(--glass-edge)',
            fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
          }}>
            <CornerDownLeft size={13} />
            новая вкладка
          </span>
        </div>

        {/* ── Остров 2: цели ──
            Бэнг из строки перебивает полосу: пока он есть, чипы гаснут и не участвуют в
            выборе — цель уже названа словами, и два одновременно «выбранных» ответа на
            вопрос «куда искать» только путали бы. */}
        {(targets.length > 0 || bangTarget) && (
          <div style={{ ...islandCard, padding: 8 }}>
            {bangTarget ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 4px' }}>
                <Chip target={bangTarget} selected onClick={() => inputRef.current?.focus()} />
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                  {strippedQuery
                    ? <>цель задана бэнгом <b>!{bangTarget.bangKey}</b> — Enter ищет здесь</>
                    : <>после <b>!{bangTarget.bangKey}</b> допишите запрос, иначе откроется сам сайт</>}
                </span>
              </div>
            ) : (
              <div
                ref={chipsRef}
                className="oblako-hide-scrollbar"
                style={{
                  display: 'flex', flexWrap: 'wrap', gap: 7,
                  // Развёрнутый список прокручивается ВЕРТИКАЛЬНО — колесом, как всё остальное.
                  maxHeight: chipsExpanded ? 168 : undefined,
                  overflowY: chipsExpanded ? 'auto' : 'visible',
                }}
              >
                {(chipsExpanded ? targets : targets.slice(0, CHIPS_COLLAPSED)).map((t, i) => (
                  <Chip
                    key={t.id}
                    target={t}
                    selected={i === selected}
                    showKey={chipsExpanded}
                    onClick={() => {
                      setSelected(i);
                      // Клик мышью по цели с уже набранным запросом — это и есть «искать здесь»:
                      // заставлять после клика тянуться к Enter было бы лишним движением.
                      if (query.trim()) run(t, false);
                      else inputRef.current?.focus();
                    }}
                  />
                ))}
                {targets.length > CHIPS_COLLAPSED && (
                  <button
                    onClick={() => setChipsExpanded((v) => !v)}
                    title={chipsExpanded ? 'Свернуть список целей' : 'Показать все цели'}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none',
                      height: 40, padding: '0 14px', borderRadius: RADIUS.pill,
                      border: '1px dashed var(--divider-strong)', background: 'transparent',
                      color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', fontWeight: 500,
                      cursor: 'default', fontFamily: 'inherit',
                    }}
                  >
                    {chipsExpanded
                      ? <><ChevronUp size={15} />свернуть</>
                      : <><ChevronDown size={15} />ещё {targets.length - CHIPS_COLLAPSED}</>}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Остров 3: находки в своих данных ── */}
        {hits.length > 0 && (
          <div style={{ ...islandCard, padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {hits.map((h, i) => {
              const Icon = HIT_ICON[h.kind];
              const isSelected = i === hitIndex;
              return (
                <button
                  key={`${h.kind}:${h.tabId ?? h.url}`}
                  onClick={() => window.searchPopover.open(h)}
                  onMouseEnter={() => setHitIndex(i)}
                  title={h.url}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    height: 46, flex: 'none', width: '100%',
                    padding: '0 10px', border: 'none', textAlign: 'left',
                    background: isSelected ? 'var(--surface-hover)' : 'transparent',
                    borderRadius: 'calc(var(--radius-card) / 2)',
                    cursor: 'default', fontFamily: 'inherit',
                  }}
                >
                  <IconTile src={h.faviconUrl} Fallback={Icon} />
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 'var(--fs-md)', color: 'var(--text-strong)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{h.title}</span>
                  <span style={{
                    flex: 'none', maxWidth: 170, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{hostOf(h.url)}</span>
                  {/* Пометка «вкладка» — единственная, что меняет исход: по ней переключаются,
                      а не открывают копию. Остальные две держим ради одинаковой строки. */}
                  <span style={{
                    flex: 'none', padding: '3px 8px', borderRadius: RADIUS.pill,
                    background: 'var(--surface-sunken)', border: '1px solid var(--glass-edge)',
                    fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
                  }}>{HIT_LABEL[h.kind]}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

installOverlayReveal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SearchPopover />
  </React.StrictMode>,
);
