import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { Search, Sparkles, Workflow } from 'lucide-react';
import type { TileSite } from '../../../shared/frecency';
import {
  loadDesktop, subscribeDesktop, computeGrid, layoutItems,
  type DesktopLayout,
} from '../../newtab/desktop';
import {
  loadNewTabSettings, subscribeNewTabSettings, presetCss, getNewTabCustomImage,
  ensureCustomImageShrunk, isLightBackground, type NewTabSettings,
} from '../../newtab/settings';
import { APPS, AppIconBadge } from '../aiApps';
import SiteIcon from './SiteIcon';
import { WIDGET_RENDERERS } from './widgets';

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
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = (): void => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const light = isLightBackground(settings.background);
  const grid = useMemo(() => computeGrid(Math.max(320, width)), [width]);
  const { placed, rows } = useMemo(
    () => layoutItems(layout.items, grid.cols),
    [layout.items, grid.cols],
  );

  const step = grid.cell + grid.gap;
  const appById = useMemo(() => new Map(APPS.map((a) => [a.id, a])), []);

  return (
    <div style={{
      position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'var(--radius-island)',
      ...(light ? LIGHT_PALETTE : DARK_PALETTE),
    } as React.CSSProperties}>
      <Background bg={settings.background} photoUrl={photoUrl} />

      <div style={{
        position: 'absolute', inset: 0, zIndex: 2, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '28px 24px 40px',
      }}>
        {settings.search.show && <SearchBar onSubmit={onSubmit} />}

        {/* Область сетки: меряем её ширину, а саму сетку центрируем — на широком экране она
            перестаёт расти (см. потолки в computeGrid) и стоит по центру, как springboard. */}
        <div ref={areaRef} style={{ width: '100%', maxWidth: 1320, marginTop: settings.search.show ? 26 : 0 }}>
          <div style={{
            position: 'relative', margin: '0 auto',
            width: grid.width, height: rows * step - grid.gap,
          }}>
            {placed.map(({ item, col, row, w, h }) => {
              const box = {
                width: w * grid.cell + (w - 1) * grid.gap,
                height: h * grid.cell + (h - 1) * grid.gap,
              };
              const style: React.CSSProperties = {
                position: 'absolute',
                left: col * step, top: row * step,
                width: box.width, height: box.height,
              };

              if (item.kind === 'widget') {
                const Render = WIDGET_RENDERERS[item.widget ?? ''];
                if (!Render) return null;
                return (
                  <div key={item.id} style={style}>
                    <Render size={item.size} box={box} tiles={tiles} onOpen={onSubmit} city={settings.weather.city} />
                  </div>
                );
              }

              if (item.kind === 'app') {
                const app = appById.get(item.appId ?? '');
                if (!app) return null;
                const iconSize = Math.round(grid.cell * 0.72);
                return (
                  <div key={item.id} style={style}>
                    <button
                      onClick={() => onOpenApp(app.id)}
                      title={app.label}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                        width: '100%', height: '100%', padding: 0, border: 'none',
                        background: 'transparent', cursor: 'default',
                      }}
                    >
                      <AppIconBadge
                        app={app}
                        size={iconSize}
                        radius={Math.round(iconSize * 0.235)}
                        iconSize={Math.round(iconSize * 0.45)}
                        shadow
                      />
                      <span style={{
                        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        fontSize: 'var(--fs-xs)', fontWeight: 500,
                        color: 'var(--nt-text)', textShadow: 'var(--nt-shadow)',
                      }}>{app.label}</span>
                    </button>
                  </div>
                );
              }

              return (
                <div key={item.id} style={style}>
                  <SiteIcon
                    url={item.url ?? ''}
                    title={item.title ?? ''}
                    size={Math.round(grid.cell * 0.72)}
                    onOpen={onSubmit}
                    labelColor="var(--nt-text)"
                    labelShadow="var(--nt-shadow)"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Переходы в большие режимы — там же, где были на минималистичной вкладке. */}
      {!isLightWindow && (
        <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 3, display: 'flex', gap: 8 }}>
          <CornerButton title="Граф-воркспейс" onClick={onOpenGraph}><Workflow size={18} /></CornerButton>
          <CornerButton title="AI-режим" onClick={onOpenAi}><Sparkles size={18} /></CornerButton>
        </div>
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
