// Поповер быстрого поиска (Ctrl+E) — отдельная WebContentsView поверх страницы
// (см. electron/SearchPopoverManager.ts). Суть: сначала запрос, цель — потом.
//
// Цель выбирается чипами, первой стоит текущий сайт (electron/SearchTargets.ts). Бэнг «!ключ»
// в самой строке продолжает работать — его разбирает main при навигации, второго парсера здесь
// намеренно нет: разъехавшийся разбор в двух местах — ровно тот класс багов, который проект уже
// ловил на дропдауне подсказок.
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Search, CornerDownLeft, Clock, Star, PanelTop } from 'lucide-react';
import './styles/global.css';
import type { SearchTarget, QuickHit } from '../shared/ipc';

interface ShowPayload { targets: SearchTarget[]; prefill: string }

declare global {
  interface Window {
    searchPopover: {
      onShow: (cb: (p: ShowPayload) => void) => () => void
      run: (query: string, target: SearchTarget, sameTab: boolean) => void
      query: (text: string) => Promise<QuickHit[]>
      open: (hit: QuickHit) => void
      resize: (height: number) => void
      close: () => void
    }
  }
}

// Держать в синхроне с SearchPopoverManager.ts — те же числа задают размер вью.
const WIDTH = 520;
const BASE_HEIGHT = 108;
const SHADOW_MARGIN = 20;
const HIT_ROW = 32;
// Больше пяти строк в поповере — уже панель истории, а не быстрый выбор.
const MAX_HITS = 5;
const QUERY_DEBOUNCE = 120;

const HIT_ICON = { tab: PanelTop, history: Clock, bookmark: Star } as const;
const HIT_LABEL = { tab: 'вкладка', history: 'история', bookmark: 'закладка' } as const;

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
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
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
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
      // Выделение со страницы — уже готовый запрос: чаще всего Ctrl+E жмут именно ради него.
      if (p.prefill) setQuery(p.prefill);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    });
  }, []);

  // Высота карточки → main: WebContentsView не растёт под контент сама (см. канал resize).
  useEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h) window.searchPopover.resize(h);
  }, [hits.length]);

  // Поиск по своим данным на каждое изменение строки, с дебаунсом.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const text = query.trim();
    if (text.length < 2) {
      setHits([]);
      setHitIndex(-1);
      return;
    }
    const seq = ++querySeqRef.current;
    debounceRef.current = setTimeout(() => {
      void window.searchPopover.query(text).then((r) => {
        if (seq !== querySeqRef.current) return; // ответ на устаревший ввод
        setHits(r.slice(0, MAX_HITS));
        setHitIndex(-1);
      });
    }, QUERY_DEBOUNCE);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

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
    // Прозрачный внешний паддинг — место для вытекания тени (вью увеличена на столько же).
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div ref={cardRef} style={{
        width: WIDTH, minHeight: BASE_HEIGHT, boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: 10,
        background: 'var(--surface-solid)',
        boxShadow: 'var(--shadow-card)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--glass-edge)',
        fontFamily: 'var(--font-sans)',
      }}>
        {/* Строка запроса */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px',
          background: 'var(--surface-sunken)',
          border: '1px solid var(--glass-edge)',
          borderRadius: 'calc(var(--radius-card) / 2)',
        }}>
          <Search size={15} style={{ flex: 'none', color: 'var(--text-faint)' }} />
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
              fontSize: 'var(--fs-md)', color: 'var(--text-strong)', outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none',
            fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
          }}>
            <CornerDownLeft size={12} />
            новая вкладка
          </span>
        </div>

        {/* Полоса целей. Первой — текущий сайт (если его поиск удалось распознать), дальше
            поисковик по умолчанию и бэнги. Прокрутка есть, полосы прокрутки нет — она бы
            съела высоту карточки ради двух пикселей информации. */}
        <div className="oblako-hide-scrollbar" style={{
          display: 'flex', alignItems: 'center', gap: 5,
          overflowX: 'auto', flex: 'none', height: 30,
        }}>
          {targets.map((t, i) => {
            const isSelected = i === selected;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setSelected(i);
                  // Клик мышью по цели с уже набранным запросом — это и есть «искать здесь»:
                  // заставлять после клика тянуться к Enter было бы лишним движением.
                  if (query.trim()) run(t, false);
                  else inputRef.current?.focus();
                }}
                title={t.kind === 'site' ? 'Поиск по этому сайту' : t.name}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, flex: 'none',
                  maxWidth: 190,
                  padding: '5px 10px', border: '1px solid',
                  borderColor: isSelected ? 'var(--accent)' : 'var(--glass-edge)',
                  background: isSelected ? 'var(--accent)' : 'var(--surface-sunken)',
                  color: isSelected ? '#fff' : 'var(--text-body)',
                  borderRadius: 'var(--radius-pill, 999px)',
                  fontSize: 'var(--fs-xs)', fontWeight: isSelected ? 600 : 500,
                  cursor: 'default', fontFamily: 'inherit',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {t.kind === 'site' && t.faviconUrl && (
                  <img src={t.faviconUrl} width={13} height={13} alt=""
                    style={{ borderRadius: 3, flex: 'none' }} />
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
              </button>
            );
          })}
        </div>

        {/* Находки в своих данных: открытые вкладки, закладки, история. Появляются только
            когда есть что показать — пустой блок в поповере был бы шумом. */}
        {hits.length > 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column',
            borderTop: '1px solid var(--divider)', paddingTop: 4, marginTop: 2,
          }}>
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
                    display: 'flex', alignItems: 'center', gap: 8,
                    height: HIT_ROW, flex: 'none', width: '100%',
                    padding: '0 8px', border: 'none', textAlign: 'left',
                    background: isSelected ? 'var(--surface-hover)' : 'transparent',
                    borderRadius: 'calc(var(--radius-card) / 2)',
                    cursor: 'default', fontFamily: 'inherit',
                  }}
                >
                  {h.faviconUrl
                    ? <img src={h.faviconUrl} width={14} height={14} alt="" style={{ borderRadius: 3, flex: 'none' }} />
                    : <Icon size={14} style={{ flex: 'none', color: 'var(--text-faint)' }} />}
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-strong)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{h.title}</span>
                  <span style={{
                    flex: 'none', maxWidth: 150, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{hostOf(h.url)}</span>
                  <span style={{
                    flex: 'none', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
                    // Пометка «вкладка» — единственная, что меняет исход: по ней переключаются,
                    // а не открывают копию. Остальные две держим ради одинаковой строки.
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SearchPopover />
  </React.StrictMode>,
);
