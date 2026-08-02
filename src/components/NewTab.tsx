import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Search, Workflow } from 'lucide-react';
import type { TileSite } from '../../shared/frecency';
import {
  loadNewTabSettings, subscribeNewTabSettings, presetCss, getNewTabCustomImage,
  ensureCustomImageShrunk, rateSymbol, isLightBackground,
  type NewTabSettings,
} from '../newtab/settings';

// Минималистичная новая вкладка (в духе Bonjourr): полноэкранный фон, крупные часы, приветствие,
// строка поиска и быстрые ссылки. Настройки читаются из localStorage (см. src/newtab/settings.ts)
// и применяются живьём — раздел «Интерфейс» пишет туда же. Палитра текста и плашек зависит от
// светлоты фона (см. isLightBackground): на градиентах и фото — светлая с мягкой тенью:
// он лежит поверх произвольного фона (градиент/фото), не поверх surface-токенов темы.

interface NewTabProps {
  onSubmit: (input: string) => void; // омнибокс-сабмит (URL или запрос) — тот же, что у плиток
  onOpenAi: () => void;              // переключение Hub в AI-режим
  onOpenGraph: () => void;           // переключение Hub в граф-воркспейс
  // В лёгком окне больших режимов нет: и блокнот, и холст графа завязаны на службы полного окна.
  isLightWindow?: boolean;
  tiles: TileSite[];                 // топ-сайты для быстрых ссылок (из истории, см. Hub)
}

// ⚠️ Палитра вкладки живёт в CSS-переменных, а не в константах: фон бывает и светлым (белый по
// умолчанию, нежные градиенты «Мята»/«Небо»), и на нём белый текст попросту не виден. Значения
// подставляются на корневом контейнере по isLightBackground — ниже все цвета берутся отсюда.
const TEXT = 'var(--nt-text)';
const TEXT_SOFT = 'var(--nt-text-soft)';
// Плашки (кнопки в углу, чипы быстрых ссылок, строка поиска): на тёмном фоне — светлое стекло,
// на светлом — тёмное. Иначе на белом получаются белые кнопки на белом.
const CHIP = 'var(--nt-chip)';
const CHIP_HOVER = 'var(--nt-chip-hover)';
// Тень под текстом — ради читаемости поверх произвольного фото, но КОРОТКАЯ. Было одно широкое
// пятно (16px, 0.35): на крупном тонком шрифте часов оно читается не как тень, а как грязная
// обводка вокруг букв. Два слоя: 2px держит край буквы, 10px даёт мягкий контраст с фоном —
// оба слабее прежнего, суммарно тише и без ореола.
const TEXT_SHADOW = 'var(--nt-shadow)';

// Тёмный фон (градиенты, фото): светлый текст и светлое стекло — как было.
const DARK_PALETTE: Record<string, string> = {
  '--nt-text': 'rgba(255,255,255,0.96)',
  '--nt-text-soft': 'rgba(255,255,255,0.78)',
  // Тень под текстом — ради читаемости поверх произвольного фото, но КОРОТКАЯ. Было одно широкое
  // пятно (16px, 0.35): на крупном тонком шрифте часов оно читается не как тень, а как грязная
  // обводка вокруг букв. Два слоя: 2px держит край буквы, 10px даёт мягкий контраст с фоном.
  '--nt-shadow': '0 1px 2px rgba(0,0,0,0.28), 0 2px 10px rgba(0,0,0,0.18)',
  '--nt-chip': 'rgba(255,255,255,0.14)',
  '--nt-chip-hover': 'rgba(255,255,255,0.24)',
  '--nt-field': 'rgba(0,0,0,0.30)',
  '--nt-field-border': 'rgba(255,255,255,0.22)',
  '--nt-field-text': '#fff',
  '--nt-plate': 'rgba(0,0,0,0.24)',
  '--nt-plate-border': 'rgba(255,255,255,0.16)',
  '--nt-tile': 'rgba(255,255,255,0.16)',
  '--nt-tile-border': 'rgba(255,255,255,0.14)',
  '--nt-sep': 'rgba(255,255,255,0.32)',
};

// Светлый фон (белый по умолчанию, нежные градиенты): тёмный текст, тень не нужна вовсе —
// на ровном светлом она читалась бы грязью, а не глубиной.
const LIGHT_PALETTE: Record<string, string> = {
  '--nt-text': 'rgba(28,28,32,0.92)',
  '--nt-text-soft': 'rgba(28,28,32,0.62)',
  '--nt-shadow': 'none',
  '--nt-chip': 'rgba(0,0,0,0.05)',
  '--nt-chip-hover': 'rgba(0,0,0,0.10)',
  // Поле поиска на светлом — белая плашка с мягкой рамкой и тенью: то же, что у поисковиков,
  // и единственный способ показать «сюда можно печатать» без контраста наизнанку.
  '--nt-field': 'rgba(255,255,255,0.92)',
  '--nt-field-border': 'rgba(0,0,0,0.10)',
  '--nt-field-text': 'rgba(28,28,32,0.92)',
  '--nt-plate': 'rgba(255,255,255,0.72)',
  '--nt-plate-border': 'rgba(0,0,0,0.07)',
  '--nt-tile': 'rgba(255,255,255,0.82)',
  '--nt-tile-border': 'rgba(0,0,0,0.07)',
  '--nt-sep': 'rgba(28,28,32,0.28)',
};

export default function NewTab({ onSubmit, onOpenAi, onOpenGraph, tiles, isLightWindow = false }: NewTabProps) {
  const [settings, setSettings] = useState<NewTabSettings>(() => loadNewTabSettings());
  useEffect(() => subscribeNewTabSettings(() => setSettings(loadNewTabSettings())), []);
  const light = isLightBackground(settings.background);

  // Своё фото могло быть сохранено полноразмерным (раньше усадки не было вовсе) — ужимаем один
  // раз в фоне, иначе каждый показ вкладки платит за декодирование гигантского кадра.
  useEffect(() => {
    if (settings.background.kind === 'custom') ensureCustomImageShrunk();
  }, [settings.background.kind]);

  // «Фото дня» — тянется через main (кэш на день), только при выбранном фоне 'photo'.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (settings.background.kind !== 'photo') return;
    let alive = true;
    void window.oblako.getNewtabPhoto().then((r) => { if (alive && r.ok && r.dataUrl) setPhotoUrl(r.dataUrl); });
    return () => { alive = false; };
  }, [settings.background.kind]);

  return (
    // Скругление под тот же радиус, что у островов-вкладок (см. History/Settings) — фон не должен
    // упираться в прямые углы контент-области.
    <div style={{
      position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'var(--radius-island)',
      ...(light ? LIGHT_PALETTE : DARK_PALETTE),
    } as React.CSSProperties}>
      <Background bg={settings.background} photoUrl={photoUrl} />

      {/* Контент поверх фона. Появляется ступенчато (см. .oblako-newtab-in в global.css):
          новая вкладка — единственное место, где заметная анимация уместна, потому что она
          играет один раз и ничему не мешает. */}
      <div className="oblako-newtab-in" style={{
        position: 'absolute', inset: 0, zIndex: 2,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 22, padding: '48px', textAlign: 'center',
      }}>
        {settings.clock.show && <Clock opts={settings.clock} />}
        <InfoRow settings={settings} />
        {settings.greeting.show && <Greeting name={settings.greeting.name} />}
        {settings.search.show && <div style={{ height: 6 }} />}
        {settings.search.show && <SearchBar onSubmit={onSubmit} />}
        {settings.quickLinks.show && <QuickLinks cfg={settings.quickLinks} tiles={tiles} onSubmit={onSubmit} />}
      </div>

      {/* Незаметные переходы в большие режимы — правый верхний угол */}
      {!isLightWindow && (
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 3, display: 'flex', gap: 8 }}>
        <button onClick={onOpenGraph} title="Граф-воркспейс" style={cornerButton}
          onMouseEnter={(e) => (e.currentTarget.style.background = CHIP_HOVER)}
          onMouseLeave={(e) => (e.currentTarget.style.background = CHIP)}
        >
          <Workflow size={18} />
        </button>
        <button onClick={onOpenAi} title="AI-режим" style={cornerButton}
          onMouseEnter={(e) => (e.currentTarget.style.background = CHIP_HOVER)}
          onMouseLeave={(e) => (e.currentTarget.style.background = CHIP)}
        >
          <Sparkles size={18} />
        </button>
      </div>
      )}
    </div>
  );
}

const cornerButton: React.CSSProperties = {
  width: 40, height: 40, borderRadius: 999, border: 'none', cursor: 'default',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: CHIP, backdropFilter: 'blur(12px)',
  color: TEXT, boxShadow: 'var(--nt-chip-shadow, 0 2px 12px rgba(0,0,0,0.18))',
};

// ── Фон ────────────────────────────────────────────────────────────────────────
function Background({ bg, photoUrl }: { bg: NewTabSettings['background']; photoUrl: string | null }) {
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
    if (bg.kind === 'photo') {
      // Пока фото не загрузилось (или офлайн) — показываем пресет, чтобы не мигать пустотой.
      return photoUrl ? { ...base, backgroundImage: `url("${photoUrl}")` } : { ...base, background: presetCss(bg.preset) };
    }
    return { ...base, background: presetCss(bg.preset) };
  }, [bg.kind, bg.preset, bg.color, photoUrl]);

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
        // Стекло по светлоте фона: на тёмном — тёмное с белым текстом, на светлом — белое с
        // тёмным (см. LIGHT_PALETTE/DARK_PALETTE).
        borderRadius: 999, background: 'var(--nt-field)', backdropFilter: 'blur(16px)',
        border: '1px solid var(--nt-field-border)', boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
      }}>
        <Search size={18} style={{ color: 'var(--nt-field-text)', opacity: 0.8, flex: 'none' }} />
        <input
          className="newtab-search-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Поиск или адрес"
          autoFocus
          style={{
            flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
            fontSize: 'var(--fs-lg)', color: 'var(--nt-field-text)',
          }}
        />
      </div>
    </form>
  );
}

// ── Погода: WMO weather_code → эмодзи + короткая подпись ───────────────────────
// (компактно, покрывает основные группы; сам виджет — часть InfoRow ниже)
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

// ── Инфо-строка под часами: дата · погода · курс ───────────────────────────────
// Один бейдж на все три, а не три бейджа в столбик: вкладка минималистичная, и каждый
// отдельный «остров» под часами ломает её тем сильнее, чем их больше. Данные тянут оба
// источника независимо, поэтому строка собирается из тех кусков, что реально доехали, —
// отвалившаяся сеть просто убирает свой кусок, а не оставляет пустую плашку.
const RATE_FMT = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function InfoRow({ settings }: { settings: NewTabSettings }) {
  const showDate = settings.clock.date;
  const city = settings.weather.city.trim();
  const showWeather = settings.weather.show && city !== '';
  const codes = settings.rates.codes;
  const showRates = settings.rates.show && codes.length > 0;

  // Дата: тикаем раз в минуту — этого хватает, чтобы строка сама пережила полночь на
  // долгооткрытой вкладке, и не будит рендер каждую секунду ради неменяющегося текста.
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    if (!showDate) return;
    const t = setInterval(() => setToday(new Date()), 60_000);
    return () => clearInterval(t);
  }, [showDate]);

  const [weather, setWeather] = useState<import('../../shared/ipc').WeatherInfo | null>(null);
  useEffect(() => {
    if (!showWeather) { setWeather(null); return; }
    let alive = true;
    const load = () => { void window.oblako.getWeather(city).then((w) => { if (alive) setWeather(w); }); };
    load();
    const t = setInterval(load, 15 * 60_000); // раз в 15 минут
    return () => { alive = false; clearInterval(t); };
  }, [showWeather, city]);

  const [rates, setRates] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (!showRates) { setRates(null); return; }
    let alive = true;
    // Курс ЦБ — суточный, и в main уже лежит часовой кэш (CurrencyRates.ts): свой интервал здесь
    // нужен только чтобы долгооткрытая вкладка подхватила курс следующего дня.
    const load = () => { void window.oblako.getCurrencyRates().then((r) => { if (alive && r.ok && r.rates) setRates(r.rates); }); };
    load();
    const t = setInterval(load, 60 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [showRates]);

  const parts: React.ReactNode[] = [];

  if (showDate) {
    const text = today.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    parts.push(<span key="date">{text.charAt(0).toUpperCase() + text.slice(1)}</span>);
  }

  if (weather?.ok && weather.tempC !== undefined) {
    const w = wmo(weather.weatherCode ?? -1);
    const temp = settings.weather.units === 'f'
      ? Math.round(weather.tempC * 9 / 5 + 32)
      : Math.round(weather.tempC);
    parts.push(
      <span key="weather" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
        title={`${weather.city ?? city} · ${w.label}`}>
        <span style={{ fontSize: 'var(--fs-lg)', lineHeight: 1 }}>{w.icon}</span>
        <span style={{ fontWeight: 600 }}>{temp}°{settings.weather.units === 'f' ? 'F' : 'C'}</span>
        <span style={{ color: TEXT_SOFT, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {weather.city ?? city}
        </span>
      </span>,
    );
  }

  if (rates) {
    // Показываем только те коды, что реально пришли от ЦБ, — иначе строка молча теряет смысл.
    const shown = codes.filter((c) => typeof rates[c] === 'number');
    if (shown.length > 0) {
      parts.push(
        <span key="rates" style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }} title="Курс ЦБ РФ">
          {shown.map((c) => (
            <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ color: TEXT_SOFT }}>{rateSymbol(c)}</span>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{RATE_FMT.format(rates[c]!)}</span>
            </span>
          ))}
        </span>,
      );
    }
  }

  if (parts.length === 0) return null;

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderRadius: 999,
      background: 'var(--nt-plate)', backdropFilter: 'blur(12px)',
      border: '1px solid var(--nt-plate-border)',
      color: TEXT, fontSize: 'var(--fs-md)', boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
      maxWidth: '100%', flexWrap: 'wrap', justifyContent: 'center',
    }}>
      {parts.map((p, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          {i > 0 && <span aria-hidden style={{ color: 'var(--nt-sep)' }}>·</span>}
          {p}
        </span>
      ))}
    </div>
  );
}

// ── Быстрые ссылки ────────────────────────────────────────────────────────────
// Источник: топ-сайты из истории ЛИБО свой набор (см. настройки). Приводим оба к единому виду
// {url, origin, title} для рендера.
function QuickLinks({ cfg, tiles, onSubmit }: { cfg: NewTabSettings['quickLinks']; tiles: TileSite[]; onSubmit: (input: string) => void }) {
  // label — что показываем ПОДПИСЬЮ: для своих ссылок это заданное имя (иначе — хост), для
  // топ-сайтов — домен (полные заголовки страниц слишком длинные).
  const items: { url: string; origin: string; label: string }[] = cfg.source === 'custom'
    ? cfg.custom
        .filter((l) => l.url.trim())
        .map((l) => ({ url: l.url, origin: originOf(l.url), label: l.title.trim() || hostOf(l.url) }))
    : tiles.slice(0, cfg.count).map((t) => ({ url: t.url, origin: t.origin, label: t.origin.replace(/^https?:\/\//, '') }));
  if (items.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center', maxWidth: 560 }}>
      {items.map((it, i) => <QuickLink key={it.origin + i} origin={it.origin} label={it.label} onClick={() => onSubmit(it.url)} />)}
    </div>
  );
}
function originOf(url: string): string {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).origin; } catch { return url; }
}
function hostOf(url: string): string {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch { return url; }
}
function QuickLink({ origin, label, onClick }: { origin: string; label: string; onClick: () => void }) {
  const [ok, setOk] = useState(true);
  const letter = label.charAt(0).toUpperCase();
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
        width: 76, background: 'none', border: 'none', cursor: 'default',
      }}
    >
      <span style={{
        width: 52, height: 52, borderRadius: 16, flex: 'none',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--nt-tile)', backdropFilter: 'blur(12px)',
        border: '1px solid var(--nt-tile-border)',
      }}>
        {ok
          ? <img src={`${origin}/favicon.ico`} width={26} height={26} alt="" style={{ borderRadius: 6 }} onError={() => setOk(false)} />
          : <span style={{ color: TEXT, fontSize: 20, fontWeight: 600 }}>{letter}</span>}
      </span>
      <span style={{
        fontSize: 'var(--fs-sm)', color: TEXT_SOFT, textShadow: TEXT_SHADOW, maxWidth: '100%',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{label}</span>
    </button>
  );
}
