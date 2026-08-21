import { useEffect, useRef, useState } from 'react';
import { parseHex } from '../../../shared/chromeGround';
import { RADIUS, sp, TEXT } from '../../styles/system';
import { TextField } from './kit';

// Палитра как в Figma: квадрат насыщенность×яркость и дорожка тона. native <input type="color">
// даёт системный поповер без поля hex и без перетаскивания — для конструктора этого мало.

interface Hsv { h: number; s: number; v: number }

function hexToHsv(hex: string): Hsv {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d !== 0) {
    hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { h: hue, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

const HUE_BAR =
  'linear-gradient(to right, rgb(255,0,0), rgb(255,255,0), rgb(0,255,0), rgb(0,255,255), rgb(0,0,255), rgb(255,0,255), rgb(255,0,0))';

export default function ColorField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const hex = parseHex(value) ?? '#808080';
  const hsv = hexToHsv(hex);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState(hex.toUpperCase());
  useEffect(() => { setTyped(hex.toUpperCase()); }, [hex]);

  function drag(el: HTMLDivElement | null, ev: React.PointerEvent, apply: (nx: number, ny: number) => void) {
    if (!el) return;
    el.setPointerCapture(ev.pointerId);
    const read = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const ny = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      apply(nx, ny);
    };
    read(ev.nativeEvent);
    const move = (e: PointerEvent) => read(e);
    const up = () => {
      el.releasePointerCapture(ev.pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
      <div
        ref={svRef}
        onPointerDown={(e) => drag(svRef.current, e, (nx, ny) => onChange(hsvToHex(hsv.h, nx, 1 - ny)))}
        style={{
          position: 'relative', height: 140, borderRadius: RADIUS.control, cursor: 'crosshair',
          background: `linear-gradient(to top, rgb(0,0,0), transparent), linear-gradient(to right, rgb(255,255,255), ${hsvToHex(hsv.h, 1, 1)})`,
          boxShadow: 'inset 0 0 0 1px var(--divider)',
        }}
      >
        <span style={{
          position: 'absolute',
          left: `${hsv.s * 100}%`,
          top: `${(1 - hsv.v) * 100}%`,
          width: 12, height: 12, marginLeft: -6, marginTop: -6,
          borderRadius: RADIUS.pill, pointerEvents: 'none',
          boxShadow: 'inset 0 0 0 2px rgb(255,255,255), 0 0 0 1px rgb(0,0,0,0.35)',
          background: hex,
        }} />
      </div>
      <div
        ref={hueRef}
        onPointerDown={(e) => drag(hueRef.current, e, (nx) => onChange(hsvToHex(nx * 360, hsv.s, hsv.v)))}
        style={{
          position: 'relative', height: 12, borderRadius: RADIUS.pill, cursor: 'default',
          background: HUE_BAR, boxShadow: 'inset 0 0 0 1px var(--divider)',
        }}
      >
        <span style={{
          position: 'absolute', left: `${(hsv.h / 360) * 100}%`, top: '50%',
          width: 12, height: 12, marginLeft: -6, marginTop: -6,
          borderRadius: RADIUS.pill, pointerEvents: 'none',
          background: hsvToHex(hsv.h, 1, 1),
          boxShadow: 'inset 0 0 0 2px rgb(255,255,255), 0 0 0 1px rgb(0,0,0,0.35)',
        }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
        <span style={{
          width: 24, height: 24, borderRadius: RADIUS.control, background: hex, flex: 'none',
          boxShadow: 'inset 0 0 0 1px var(--divider)',
        }} />
        <TextField
          value={typed}
          onChange={(v) => {
            setTyped(v);
            const p = parseHex(v);
            if (p) onChange(p);
          }}
          mono
          style={{ flex: 1 }}
        />
        <span style={{ ...TEXT.caption, flex: 'none' }}>HEX</span>
      </div>
    </div>
  );
}
