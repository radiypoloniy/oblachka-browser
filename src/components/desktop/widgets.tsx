import { useEffect, useState } from 'react';
import type React from 'react';
import type { TileSite } from '../../../shared/frecency';
import type { CellSize } from '../../newtab/desktop';
import { loadNewTabSettings } from '../../newtab/settings';
import SiteIcon from './SiteIcon';

// Виджеты рабочего стола. Все рисуются в одной «плитке» (WidgetCard) и получают свой размер в
// клетках — от него зависит не масштаб, а СОДЕРЖАНИЕ: маленький показывает главное число,
// широкий добавляет подробности. Так же устроены виджеты iOS, и это единственный способ, при
// котором маленький виджет остаётся читаемым, а большой не выглядит растянутым.

export interface WidgetProps {
  size: CellSize;
  /** Пиксельные размеры плитки — нужны виджетам, которые сами раскладывают содержимое. */
  box: { width: number; height: number };
  tiles: TileSite[];
  onOpen: (url: string) => void;
  /** Город для погоды — из настроек вкладки; пустой означает «человек ещё не выбрал». */
  city: string;
}

// ── Общая плитка ──────────────────────────────────────────────────────────────
export function WidgetCard({ children, padding = 14, tone = 'glass' }: {
  children: React.ReactNode;
  padding?: number;
  tone?: 'glass' | 'accent';
}) {
  return (
    <div style={{
      width: '100%', height: '100%', overflow: 'hidden',
      borderRadius: 'var(--radius-card)',
      // Плитка виджета — то же «стекло», что у остальных поверхностей рабочего стола: она обязана
      // читаться и на белом фоне, и на тёмных обоях (см. переменные --nt-* в DesktopScreen).
      background: tone === 'accent' ? 'var(--accent)' : 'var(--nt-plate)',
      border: '1px solid var(--nt-plate-border)',
      backdropFilter: 'blur(12px)',
      boxShadow: '0 2px 14px rgba(0,0,0,0.10)',
      color: tone === 'accent' ? 'var(--on-accent)' : 'var(--nt-text)',
      padding,
      display: 'flex', flexDirection: 'column',
    }}>{children}</div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
      textTransform: 'uppercase', color: 'var(--nt-text-soft)', marginBottom: 6,
    }}>{children}</div>
  );
}

// ── Часы ──────────────────────────────────────────────────────────────────────
export function ClockWidget({ size, box }: WidgetProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Тик раз в секунду не нужен: секунды не показываем, а лишний ререндер в минуту — бесплатен.
    const t = setInterval(() => setNow(new Date()), loadNewTabSettings().clock.seconds ? 1_000 : 15_000);
    return () => clearInterval(t);
  }, []);

  // Формат — из настроек «Интерфейса»: там он и был, и раздел не должен превратиться в
  // декорацию из-за переезда часов в виджет.
  const opts = loadNewTabSettings().clock;
  const time = now.toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit',
    ...(opts.seconds ? { second: '2-digit' } : {}),
    hour12: !opts.hour24,
  });
  const date = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  // Размер цифр — от высоты плитки, а не от размера в клетках: клетка сама резиновая, и
  // фиксированный кегль на узком окне вылезал бы за край.
  // ⚠️ Потолок обязателен: клетка резиновая, и на широком окне (клетка 124 px) формула от высоты
  // давала 120-пиксельные цифры — виджет превращался в вывеску и перевешивал весь экран.
  const fs = Math.round(Math.min(box.height * 0.42, box.width * (size.w >= 4 ? 0.2 : 0.34), 68));

  return (
    <WidgetCard>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontSize: fs, fontWeight: 300, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {time}
        </div>
        {opts.date && (
          <div style={{
            marginTop: 8, fontSize: 'var(--fs-sm)', color: 'var(--nt-text-soft)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {date.charAt(0).toUpperCase() + date.slice(1)}
          </div>
        )}
      </div>
    </WidgetCard>
  );
}

// ── Погода ────────────────────────────────────────────────────────────────────
function wmoIcon(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '🌨️';
  if (code <= 82) return '🌦️';
  if (code <= 86) return '🌨️';
  return '⛈️';
}

export function WeatherWidget({ size, city }: WidgetProps) {
  const [data, setData] = useState<{ t: number; code: number; city: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!city) return; // города нет — просить погоду не у кого, см. подсказку ниже
    let alive = true;
    void window.oblako.getWeather(city).then((w) => {
      if (!alive) return;
      if (w.error || w.tempC === undefined) { setFailed(true); return; }
      setData({ t: Math.round(w.tempC), code: w.weatherCode ?? 0, city: w.city || '' });
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [city]);

  if (!city) {
    return (
      <WidgetCard>
        <Caption>Погода</Caption>
        <div style={{ color: 'var(--nt-text-soft)', fontSize: 'var(--fs-sm)', lineHeight: 1.4 }}>
          Укажите город в настройках интерфейса
        </div>
      </WidgetCard>
    );
  }

  if (failed) {
    // ⚠️ Виджет со сбойным источником исчезает молча, а не показывает ошибку: погода на рабочем
    // столе — украшение, и красный текст об отказе сети здесь неуместен.
    return <WidgetCard><Caption>Погода</Caption><div style={{ color: 'var(--nt-text-soft)', fontSize: 'var(--fs-sm)' }}>нет данных</div></WidgetCard>;
  }

  return (
    <WidgetCard>
      <Caption>{data?.city || 'Погода'}</Caption>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: size.w >= 4 ? 40 : 34, lineHeight: 1 }}>
          {data ? wmoIcon(data.code) : '·'}
        </span>
        <span style={{ fontSize: size.w >= 4 ? 40 : 32, fontWeight: 300, lineHeight: 1 }}>
          {data ? `${data.t}°` : '—'}
        </span>
      </div>
    </WidgetCard>
  );
}

// ── Курсы валют ───────────────────────────────────────────────────────────────
export function RatesWidget({ size }: WidgetProps) {
  const [rates, setRates] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let alive = true;
    void window.oblako.getCurrencyRates().then((r) => {
      if (alive && r.rates) setRates(r.rates as Record<string, number>);
    }).catch(() => { /* курс — украшение, молчим */ });
    return () => { alive = false; };
  }, []);

  // Валюты — те, что человек отметил в «Интерфейсе»; в маленьком виджете помещаются две.
  const chosen = loadNewTabSettings().rates.codes;
  const codes = (chosen.length ? chosen : ['USD', 'EUR']).slice(0, size.w >= 4 ? 4 : 2);

  return (
    <WidgetCard>
      <Caption>Курс ЦБ</Caption>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
        {codes.map((c) => (
          <div key={c} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 'var(--fs-sm)' }}>
            <span style={{ color: 'var(--nt-text-soft)', width: 38 }}>{c}</span>
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {rates?.[c] !== undefined ? rates[c].toFixed(2) : '—'}
            </span>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}

// ── Топ-сайты ─────────────────────────────────────────────────────────────────
export function TopSitesWidget({ box, tiles, onOpen }: WidgetProps) {
  // Сколько иконок влезет: считаем от реальных пикселей плитки, а не от размера в клетках, —
  // клетка резиновая, и на узком окне фиксированное число icons просто не поместилось бы.
  const pad = 14;
  const iconBox = 46;
  const cols = Math.max(2, Math.floor((box.width - pad * 2 + 10) / (iconBox + 10)));
  const rows = Math.max(1, Math.floor((box.height - pad * 2 - 22 + 10) / (iconBox + 26)));
  const shown = tiles.slice(0, cols * rows);

  return (
    <WidgetCard>
      <Caption>Часто открываете</Caption>
      {shown.length === 0 ? (
        <div style={{ color: 'var(--nt-text-soft)', fontSize: 'var(--fs-sm)' }}>
          Пока пусто — история наберётся сама.
        </div>
      ) : (
        <div style={{
          flex: 1, display: 'grid', gap: 10,
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          alignContent: 'start',
        }}>
          {shown.map((t) => (
            <SiteIcon
              key={t.origin}
              url={t.url}
              title={t.title}
              size={iconBox}
              onOpen={onOpen}
              labelColor="var(--nt-text-soft)"
            />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

export const WIDGET_RENDERERS: Record<string, (p: WidgetProps) => React.ReactElement> = {
  clock: ClockWidget,
  weather: WeatherWidget,
  rates: RatesWidget,
  topsites: TopSitesWidget,
};
