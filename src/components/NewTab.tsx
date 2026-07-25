import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Search } from 'lucide-react';
import type { TileSite } from '../../shared/frecency';
import {
  loadNewTabSettings, subscribeNewTabSettings, presetCss, getNewTabCustomImage,
  type NewTabSettings,
} from '../newtab/settings';

// Минималистичная новая вкладка (в духе Bonjourr): полноэкранный фон, крупные часы, приветствие,
// строка поиска и быстрые ссылки. Настройки читаются из localStorage (см. src/newtab/settings.ts)
// и применяются живьём — раздел «Интерфейс» пишет туда же. Текст всегда светлый с мягкой тенью:
// он лежит поверх произвольного фона (градиент/фото), не поверх surface-токенов темы.

interface NewTabProps {
  onSubmit: (input: string) => void; // омнибокс-сабмит (URL или запрос) — тот же, что у плиток
  onOpenAi: () => void;              // переключение Hub в AI-режим
  tiles: TileSite[];                 // топ-сайты для быстрых ссылок (из истории, см. Hub)
}

const TEXT = 'rgba(255,255,255,0.96)';
const TEXT_SOFT = 'rgba(255,255,255,0.78)';
const TEXT_SHADOW = '0 1px 16px rgba(0,0,0,0.35)';

export default function NewTab({ onSubmit, onOpenAi, tiles }: NewTabProps) {
  const [settings, setSettings] = useState<NewTabSettings>(() => loadNewTabSettings());
  useEffect(() => subscribeNewTabSettings(() => setSettings(loadNewTabSettings())), []);

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <Background bg={settings.background} />

      {/* Контент поверх фона */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 2,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 28, padding: '48px', textAlign: 'center',
      }}>
        {settings.clock.show && <Clock opts={settings.clock} />}
        {settings.greeting.show && <Greeting name={settings.greeting.name} />}
        {settings.search.show && <SearchBar onSubmit={onSubmit} />}
        {settings.quickLinks.show && tiles.length > 0 && (
          <QuickLinks tiles={tiles.slice(0, settings.quickLinks.count)} onSubmit={onSubmit} />
        )}
      </div>

      {settings.weather.show && settings.weather.city.trim() && (
        <WeatherWidget city={settings.weather.city.trim()} units={settings.weather.units} />
      )}

      {/* Незаметный переход в AI-режим — правый верхний угол */}
      <button
        onClick={onOpenAi}
        title="AI-режим"
        style={{
          position: 'absolute', top: 16, right: 16, zIndex: 3,
          width: 40, height: 40, borderRadius: 999, border: 'none', cursor: 'default',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.14)', backdropFilter: 'blur(12px)',
          color: TEXT, boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.24)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
      >
        <Sparkles size={18} />
      </button>
    </div>
  );
}

// ── Фон ────────────────────────────────────────────────────────────────────────
function Background({ bg }: { bg: NewTabSettings['background'] }) {
  const layer = useMemo<React.CSSProperties>(() => {
    const base: React.CSSProperties = {
      position: 'absolute', inset: 0, zIndex: 0,
      backgroundSize: 'cover', backgroundPosition: 'center',
    };
    if (bg.kind === 'color') return { ...base, background: bg.color };
    if (bg.kind === 'custom') {
      const url = getNewTabCustomImage();
      return url ? { ...base, backgroundImage: `url("${url}")` } : { ...base, background: presetCss('aurora') };
    }
    // 'photo' появится заходом позже — до тех пор ведёт себя как пресет.
    return { ...base, background: presetCss(bg.preset) };
  }, [bg.kind, bg.preset, bg.color]);

  // Размытие фона отдельным слоем со scale — чтобы размытые края не оголяли фон окна.
  const blurred = bg.blur > 0 ? { ...layer, filter: `blur(${bg.blur}px)`, transform: 'scale(1.08)' } : layer;

  return (
    <>
      <div style={blurred} />
      {bg.dim > 0 && <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: `rgba(0,0,0,${bg.dim})` }} />}
    </>
  );
}

// ── Часы ────────────────────────────────────────────────────────────────────────
function Clock({ opts }: { opts: NewTabSettings['clock'] }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const pad = (n: number) => String(n).padStart(2, '0');
  let h = now.getHours();
  let suffix = '';
  if (!opts.hour24) {
    suffix = h >= 12 ? ' PM' : ' AM';
    h = h % 12 || 12;
  }
  const time = `${opts.hour24 ? pad(h) : h}:${pad(now.getMinutes())}${opts.seconds ? ':' + pad(now.getSeconds()) : ''}${suffix}`;

  return (
    <div style={{
      fontSize: 'clamp(56px, 12vw, 120px)', fontWeight: 300, letterSpacing: '-0.02em',
      color: TEXT, textShadow: TEXT_SHADOW, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
    }}>
      {time}
    </div>
  );
}

// ── Приветствие ──────────────────────────────────────────────────────────────────
function greetingText(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Добрый день';
  if (hour >= 18 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}
function Greeting({ name }: { name: string }) {
  const text = greetingText(new Date().getHours());
  return (
    <div style={{ fontSize: 'clamp(18px, 2.4vw, 26px)', fontWeight: 400, color: TEXT_SOFT, textShadow: TEXT_SHADOW }}>
      {text}{name.trim() ? `, ${name.trim()}` : ''}
    </div>
  );
}

// ── Строка поиска ──────────────────────────────────────────────────────────────
function SearchBar({ onSubmit }: { onSubmit: (input: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); const v = value.trim(); if (v) { onSubmit(v); setValue(''); } }}
      style={{ width: '100%', maxWidth: 560 }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, height: 52, padding: '0 20px',
        borderRadius: 999, background: 'rgba(255,255,255,0.16)', backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.18)', boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
      }}>
        <Search size={18} style={{ color: TEXT_SOFT, flex: 'none' }} />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Поиск или адрес"
          autoFocus
          style={{
            flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
            fontSize: 17, color: TEXT,
          }}
        />
      </div>
    </form>
  );
}

// ── Погода ────────────────────────────────────────────────────────────────────
// WMO weather_code → эмодзи + короткая подпись (компактно, покрывает основные группы).
function wmo(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: '☀️', label: 'Ясно' };
  if (code >= 1 && code <= 2) return { icon: '🌤️', label: 'Малооблачно' };
  if (code === 3) return { icon: '☁️', label: 'Облачно' };
  if (code === 45 || code === 48) return { icon: '🌫️', label: 'Туман' };
  if (code >= 51 && code <= 57) return { icon: '🌦️', label: 'Морось' };
  if (code >= 61 && code <= 67) return { icon: '🌧️', label: 'Дождь' };
  if (code >= 71 && code <= 77) return { icon: '❄️', label: 'Снег' };
  if (code >= 80 && code <= 82) return { icon: '🌧️', label: 'Ливень' };
  if (code >= 85 && code <= 86) return { icon: '❄️', label: 'Снег' };
  if (code >= 95) return { icon: '⛈️', label: 'Гроза' };
  return { icon: '🌡️', label: '' };
}

function WeatherWidget({ city, units }: { city: string; units: 'c' | 'f' }) {
  const [data, setData] = useState<import('../../shared/ipc').WeatherInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => { void window.oblako.getWeather(city).then((w) => { if (alive) setData(w); }); };
    load();
    const t = setInterval(load, 15 * 60_000); // раз в 15 минут
    return () => { alive = false; clearInterval(t); };
  }, [city]);

  if (!data || !data.ok || data.tempC === undefined) return null;
  const w = wmo(data.weatherCode ?? -1);
  const temp = units === 'f' ? Math.round(data.tempC * 9 / 5 + 32) : Math.round(data.tempC);
  return (
    <div style={{
      position: 'absolute', top: 16, left: 16, zIndex: 3,
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 999,
      background: 'rgba(255,255,255,0.14)', backdropFilter: 'blur(12px)',
      color: TEXT, boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
    }} title={`${data.city ?? city} · ${w.label}`}>
      <span style={{ fontSize: 18, lineHeight: 1 }}>{w.icon}</span>
      <span style={{ fontSize: 15, fontWeight: 600 }}>{temp}°{units === 'f' ? 'F' : 'C'}</span>
      <span style={{ fontSize: 13, color: TEXT_SOFT, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {data.city ?? city}
      </span>
    </div>
  );
}

// ── Быстрые ссылки ────────────────────────────────────────────────────────────
function QuickLinks({ tiles, onSubmit }: { tiles: TileSite[]; onSubmit: (input: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center', maxWidth: 560 }}>
      {tiles.map((site) => <QuickLink key={site.origin} site={site} onClick={() => onSubmit(site.url)} />)}
    </div>
  );
}
function QuickLink({ site, onClick }: { site: TileSite; onClick: () => void }) {
  const [ok, setOk] = useState(true);
  const domain = site.origin.replace(/^https?:\/\//, '');
  const letter = domain.charAt(0).toUpperCase();
  return (
    <button
      onClick={onClick}
      title={site.title || domain}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
        width: 76, background: 'none', border: 'none', cursor: 'default',
      }}
    >
      <span style={{
        width: 52, height: 52, borderRadius: 16, flex: 'none',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,0.16)', backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.14)',
      }}>
        {ok
          ? <img src={`${site.origin}/favicon.ico`} width={26} height={26} alt="" style={{ borderRadius: 6 }} onError={() => setOk(false)} />
          : <span style={{ color: TEXT, fontSize: 20, fontWeight: 600 }}>{letter}</span>}
      </span>
      <span style={{
        fontSize: 12, color: TEXT_SOFT, textShadow: TEXT_SHADOW, maxWidth: '100%',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{domain}</span>
    </button>
  );
}
