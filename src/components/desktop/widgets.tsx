import { useEffect, useState } from 'react';
import type React from 'react';
import { Check, Plus, X } from 'lucide-react';
import type { TileSite } from '../../../shared/frecency';
import type { CellSize } from '../../newtab/desktop';
import { loadNewTabSettings } from '../../newtab/settings';

// Виджеты рабочего стола.
//
// ⚠️ Два правила, выведенных из первой версии, которую справедливо назвали бедной:
//
// 1. Плитка ЦВЕТНАЯ, а не прозрачная. Полупрозрачное стекло на обоях даёт «дырку» в фоне и само
//    по себе ничего не сообщает; у Apple каждый виджет — сплошной носитель со своим настроением
//    (погода синяя, ночью тёмная). Цвет здесь несёт смысл, а не украшает.
// 2. Место используется целиком. Размер меняет не масштаб, а СОДЕРЖАНИЕ: маленькая плитка
//    показывает главное число, широкая добавляет ряд часов и крайности суток. Одна крупная
//    цифра посреди пустого прямоугольника — это и есть «дёшево».

export interface WidgetProps {
  size: CellSize;
  /** Пиксельные размеры плитки — от них считаются кегли и число колонок внутри. */
  box: { width: number; height: number };
  tiles: TileSite[];
  onOpen: (url: string) => void;
  /** Город для погоды — из настроек вкладки; пустой означает «человек ещё не выбрал». */
  city: string;
}

// ── Плитка ────────────────────────────────────────────────────────────────────
function Tile({ children, tint, padding = 16 }: {
  children: React.ReactNode;
  /** Градиент-заливка. Задаётся всегда: прозрачных виджетов на столе больше нет. */
  tint: string;
  padding?: number;
}) {
  return (
    <div style={{
      width: '100%', height: '100%', overflow: 'hidden',
      borderRadius: 'var(--radius-card)',
      background: tint,
      boxShadow: '0 6px 20px rgba(16,20,40,0.22)',
      color: '#fff',
      padding,
      display: 'flex', flexDirection: 'column',
    }}>{children}</div>
  );
}

function TileCaption({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
      textTransform: 'uppercase', opacity: 0.75, flex: 'none',
    }}>{children}</div>
  );
}

// ── Часы ──────────────────────────────────────────────────────────────────────
const CLOCK_TINT = 'linear-gradient(160deg, #2B3242 0%, #1B2030 60%, #141720 100%)';

export function ClockWidget({ box }: WidgetProps) {
  const [now, setNow] = useState(() => new Date());
  const opts = loadNewTabSettings().clock;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), opts.seconds ? 1_000 : 15_000);
    return () => clearInterval(t);
  }, [opts.seconds]);

  const time = now.toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit',
    ...(opts.seconds ? { second: '2-digit' } : {}),
    hour12: !opts.hour24,
  });
  const weekday = now.toLocaleDateString('ru-RU', { weekday: 'long' });
  const dayMonth = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  // Кегль считаем от ДЛИНЫ строки, а не от одной ширины плитки: «18:50» и «18:50:07» занимают
  // разное место, и общий коэффициент неизбежно ошибается на одном из них — в маленьком виджете
  // время упиралось в край. 0.56 — доля ширины цифры от кегля у моноширинных цифр (tabular-nums)
  // нашего шрифта, замерена по факту. Потолок по высоте и общий потолок остаются.
  const avail = box.width - 32; // минус паддинги плитки
  const fs = Math.round(Math.min(box.height * 0.42, avail / (time.length * 0.56), 92));

  return (
    <Tile tint={CLOCK_TINT}>
      <TileCaption>{weekday}</TileCaption>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{
          fontSize: fs, fontWeight: 250, lineHeight: 1,
          fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
        }}>{time}</div>
        {opts.date && (
          <div style={{ marginTop: 10, fontSize: Math.max(13, Math.round(fs * 0.2)), opacity: 0.8 }}>
            {dayMonth}
          </div>
        )}
      </div>
    </Tile>
  );
}

// ── Погода ────────────────────────────────────────────────────────────────────
interface WeatherState {
  t: number; code: number; city: string;
  feels?: number; max?: number; min?: number; isDay: boolean;
  hours: { hour: number; tempC: number; code: number }[];
}

function wmoIcon(code: number, day = true): string {
  if (code === 0) return day ? '☀️' : '🌙';
  if (code <= 2) return day ? '🌤️' : '☁️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 57) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '🌨️';
  if (code <= 82) return '🌦️';
  if (code <= 86) return '🌨️';
  return '⛈️';
}

function wmoText(code: number): string {
  if (code === 0) return 'Ясно';
  if (code <= 2) return 'Малооблачно';
  if (code === 3) return 'Пасмурно';
  if (code <= 48) return 'Туман';
  if (code <= 57) return 'Морось';
  if (code <= 67) return 'Дождь';
  if (code <= 77) return 'Снег';
  if (code <= 82) return 'Ливень';
  if (code <= 86) return 'Снегопад';
  return 'Гроза';
}

// Цвет плитки — от времени суток и состояния неба. Это и есть «настроение» виджета Apple:
// ясный день голубой, пасмурный серо-синий, ночь тёмная.
function weatherTint(code: number, isDay: boolean): string {
  if (!isDay) return 'linear-gradient(160deg, #2B3B5B 0%, #1B2437 65%, #141A28 100%)';
  if (code >= 71) return 'linear-gradient(160deg, #8FA6C4 0%, #5C77A0 100%)';
  if (code >= 51) return 'linear-gradient(160deg, #6E86A8 0%, #47597B 100%)';
  if (code >= 3)  return 'linear-gradient(160deg, #7C93B4 0%, #566A8C 100%)';
  return 'linear-gradient(160deg, #4FA3E3 0%, #2E7BC4 55%, #2463A8 100%)';
}

export function WeatherWidget({ size, box, city }: WidgetProps) {
  const [data, setData] = useState<WeatherState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!city) return;
    let alive = true;
    void window.oblako.getWeather(city).then((w) => {
      if (!alive) return;
      if (w.error || w.tempC === undefined) { setFailed(true); return; }
      setData({
        t: Math.round(w.tempC), code: w.weatherCode ?? 0, city: w.city || city,
        feels: w.feelsC !== undefined ? Math.round(w.feelsC) : undefined,
        max: w.maxC !== undefined ? Math.round(w.maxC) : undefined,
        min: w.minC !== undefined ? Math.round(w.minC) : undefined,
        isDay: w.isDay !== false,
        hours: w.hours ?? [],
      });
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [city]);

  if (!city || failed) {
    return (
      <Tile tint="linear-gradient(160deg, #7C93B4 0%, #566A8C 100%)">
        <TileCaption>Погода</TileCaption>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: 'var(--fs-sm)', opacity: 0.9, lineHeight: 1.4 }}>
          {city ? 'Не удалось загрузить' : 'Укажите город в настройках интерфейса'}
        </div>
      </Tile>
    );
  }

  const wide = size.w >= 4;
  const tempSize = Math.round(Math.min(box.height * (wide ? 0.3 : 0.34), 64));
  const hours = data?.hours.slice(0, wide ? 6 : 3) ?? [];

  return (
    <Tile tint={weatherTint(data?.code ?? 0, data?.isDay ?? true)}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flex: 'none' }}>
        <span style={{
          fontSize: 'var(--fs-sm)', fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{data?.city ?? city}</span>
        {data?.max !== undefined && data?.min !== undefined && (
          <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.85, flex: 'none' }}>
            {data.max}° / {data.min}°
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
        <span style={{ fontSize: tempSize, fontWeight: 250, lineHeight: 1, letterSpacing: '-0.03em' }}>
          {data ? `${data.t}°` : '—'}
        </span>
        <span style={{ fontSize: Math.round(tempSize * 0.62), lineHeight: 1 }}>
          {wmoIcon(data?.code ?? 0, data?.isDay ?? true)}
        </span>
      </div>

      <div style={{ fontSize: 'var(--fs-sm)', opacity: 0.9, marginTop: 2 }}>
        {wmoText(data?.code ?? 0)}
        {data?.feels !== undefined && `, ощущается ${data.feels}°`}
      </div>

      {/* Почасовой ряд — то, чем виджет Apple заполняет нижнюю половину. Появляется, только
          если место под него реально есть: втиснутый в низкую плитку он был бы кашей. */}
      {hours.length > 0 && box.height > 150 && (
        <div style={{
          marginTop: 'auto', paddingTop: 10, display: 'flex', justifyContent: 'space-between',
          borderTop: '1px solid rgba(255,255,255,0.18)',
        }}>
          {hours.map((h) => (
            <div key={h.hour} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.8 }}>{String(h.hour).padStart(2, '0')}</span>
              <span style={{ fontSize: 15, lineHeight: 1 }}>{wmoIcon(h.code, h.hour >= 7 && h.hour <= 20)}</span>
              <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600 }}>{Math.round(h.tempC)}°</span>
            </div>
          ))}
        </div>
      )}
    </Tile>
  );
}

// ── Курсы валют ───────────────────────────────────────────────────────────────
const RATES_TINT = 'linear-gradient(160deg, #2E9E6B 0%, #1F7A55 60%, #16603F 100%)';
const RATE_SYMBOL: Record<string, string> = {
  USD: '$', EUR: '€', CNY: '¥', GBP: '£', JPY: '¥', KZT: '₸', TRY: '₺', BYN: 'Br', AMD: '֏', GEL: '₾',
};

export function RatesWidget({ size, box }: WidgetProps) {
  const [rates, setRates] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let alive = true;
    void window.oblako.getCurrencyRates().then((r) => {
      if (alive && r.rates) setRates(r.rates as Record<string, number>);
    }).catch(() => { /* курс — украшение, молчим */ });
    return () => { alive = false; };
  }, []);

  const chosen = loadNewTabSettings().rates.codes;
  const codes = (chosen.length ? chosen : ['USD', 'EUR']).slice(0, size.w >= 4 ? 4 : 3);
  // Кегль числа — от того, сколько строк реально помещается: три валюты в маленькой плитке
  // должны читаться так же спокойно, как одна.
  const rowFs = Math.round(Math.min((box.height - 46) / codes.length * 0.5, 30));

  return (
    <Tile tint={RATES_TINT}>
      <TileCaption>Курс ЦБ</TileCaption>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
        {codes.map((c) => (
          <div key={c} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: Math.round(rowFs * 0.78), width: '1.3em', opacity: 0.9, flex: 'none' }}>
              {RATE_SYMBOL[c] ?? c}
            </span>
            <span style={{ fontSize: rowFs, fontWeight: 500, fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 }}>
              {rates?.[c] !== undefined ? rates[c].toFixed(2) : '—'}
            </span>
            <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.7 }}>{c}</span>
          </div>
        ))}
      </div>
    </Tile>
  );
}

// ── Часто открываете ──────────────────────────────────────────────────────────
const SITES_TINT = 'linear-gradient(160deg, #4C5B78 0%, #333F58 100%)';

function hostLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function TopSitesWidget({ box, tiles, onOpen }: WidgetProps) {
  // ⚠️ Подпись — ДОМЕН, а не заголовок страницы. Первая версия ставила сюда title, и «Далай
  // лама: смотрите и скачивайте изображения — Яндекс Картинки» расползался на всю плитку,
  // налезая на соседние иконки. Домен короткий, узнаваемый и примерно одной длины у всех.
  const pad = 16;
  const cellW = 76;
  const cellH = 80;
  const inner = box.width - pad * 2;
  const cols = Math.max(2, Math.floor((inner + 12) / (cellW + 12)));
  const rows = Math.max(1, Math.floor((box.height - pad * 2 - 26 + 12) / (cellH + 12)));
  const shown = tiles.slice(0, cols * rows);

  return (
    <Tile tint={SITES_TINT}>
      <TileCaption>Часто открываете</TileCaption>
      {shown.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: 'var(--fs-sm)', opacity: 0.85 }}>
          Пока пусто — история наберётся сама.
        </div>
      ) : (
        <div style={{
          flex: 1, marginTop: 12, display: 'grid', gap: 12,
          gridTemplateColumns: `repeat(${cols}, 1fr)`, alignContent: 'start',
        }}>
          {shown.map((t) => (
            <button
              key={t.origin}
              onClick={() => onOpen(t.url)}
              title={t.title || hostLabel(t.url)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                background: 'transparent', border: 'none', cursor: 'default', padding: 0,
                minWidth: 0, color: 'inherit',
              }}
            >
              <img
                src={`https://${hostLabel(t.url)}/favicon.ico`}
                alt=""
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                style={{
                  width: 44, height: 44, borderRadius: 12, objectFit: 'contain', flex: 'none',
                  background: 'rgba(255,255,255,0.94)', padding: 7, boxSizing: 'border-box',
                }}
              />
              <span style={{
                maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontSize: 'var(--fs-xs)', opacity: 0.9,
              }}>{hostLabel(t.url)}</span>
            </button>
          ))}
        </div>
      )}
    </Tile>
  );
}

// ── Дела ──────────────────────────────────────────────────────────────────────
const TASKS_TINT = 'linear-gradient(160deg, #E9A93C 0%, #D8862B 60%, #BE6E1E 100%)';
const TASKS_KEY = 'oblako-desktop-tasks';

interface Task { id: string; text: string; done: boolean }

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as Task[]).filter((t) => t && typeof t.text === 'string') : [];
  } catch { return []; }
}

function saveTasks(list: Task[]): void {
  try { localStorage.setItem(TASKS_KEY, JSON.stringify(list)); } catch { /* квота — не критично */ }
}

/**
 * Список дел прямо на столе. Пока полностью локальный (localStorage): синхронизация с календарём
 * — отдельная задача с чужим API и учётными данными, и делать её вслепую под непроверенный
 * визуал не стоит. Формат записи выбран так, чтобы будущий источник событий добавил себе поле,
 * а не переписывал хранилище.
 */
export function TasksWidget({ box }: WidgetProps) {
  const [tasks, setTasks] = useState<Task[]>(loadTasks);
  const [draft, setDraft] = useState('');

  const update = (next: Task[]): void => { setTasks(next); saveTasks(next); };
  const toggle = (id: string): void => update(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: string): void => update(tasks.filter((t) => t.id !== id));
  const add = (): void => {
    const text = draft.trim();
    if (!text) return;
    update([...tasks, { id: `${Date.now()}`, text, done: false }]);
    setDraft('');
  };

  const capacity = Math.max(1, Math.floor((box.height - 96) / 28));
  const left = tasks.filter((t) => !t.done).length;

  return (
    <Tile tint={TASKS_TINT}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flex: 'none' }}>
        <TileCaption>Дела</TileCaption>
        <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.85 }}>
          {tasks.length === 0 ? '' : left ? `осталось ${left}` : 'всё сделано'}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {tasks.slice(0, capacity).map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => toggle(t.id)}
              title={t.done ? 'Вернуть в дела' : 'Сделано'}
              style={{
                width: 18, height: 18, flex: 'none', borderRadius: 6, cursor: 'default',
                border: t.done ? 'none' : '1.5px solid rgba(255,255,255,0.75)',
                background: t.done ? 'rgba(255,255,255,0.95)' : 'transparent',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              }}
            >{t.done && <Check size={12} style={{ color: '#BE6E1E' }} />}</button>
            <span style={{
              flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', textAlign: 'left',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textDecoration: t.done ? 'line-through' : 'none', opacity: t.done ? 0.6 : 1,
            }}>{t.text}</span>
            <button
              onClick={() => remove(t.id)}
              title="Убрать"
              style={{
                border: 'none', background: 'transparent', cursor: 'default', padding: 2,
                color: 'inherit', opacity: 0.55, display: 'inline-flex', flex: 'none',
              }}
            ><X size={13} /></button>
          </div>
        ))}
        {tasks.length === 0 && (
          <div style={{ fontSize: 'var(--fs-sm)', opacity: 0.85 }}>Записывайте, что нужно не забыть.</div>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); add(); }}
        style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none', marginTop: 8 }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Новое дело"
          style={{
            flex: 1, minWidth: 0, height: 30, padding: '0 10px',
            borderRadius: 999, border: '1px solid rgba(255,255,255,0.35)',
            background: 'rgba(255,255,255,0.16)', color: '#fff',
            fontSize: 'var(--fs-sm)', outline: 'none',
          }}
        />
        <button
          type="submit"
          title="Добавить"
          style={{
            width: 30, height: 30, flex: 'none', borderRadius: 999, border: 'none', cursor: 'default',
            background: 'rgba(255,255,255,0.92)', color: '#BE6E1E',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        ><Plus size={16} /></button>
      </form>
    </Tile>
  );
}

export const WIDGET_RENDERERS: Record<string, (p: WidgetProps) => React.ReactElement> = {
  clock: ClockWidget,
  weather: WeatherWidget,
  rates: RatesWidget,
  topsites: TopSitesWidget,
  tasks: TasksWidget,
};
