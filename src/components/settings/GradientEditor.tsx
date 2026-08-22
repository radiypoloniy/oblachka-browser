import { useState } from 'react';
import { Plus, Trash2, Shuffle } from 'lucide-react';
import {
  mixFromSeeds, MESH_SEEDS_MAX, MESH_SEEDS_MIN,
  MESH_SOFTNESS_MIN, MESH_SOFTNESS_MAX, randomMesh, type MeshGradient,
} from '../../../shared/chromeGround';
import { meshCss } from '../../newtab/gradients';
import { RADIUS, sp, pad, TEXT, well } from '../../styles/system';
import { btnGhost, btnPrimary, TextField } from './kit';
import ColorField from './ColorField';

export default function GradientEditor({
  mesh, dark, onChange, onSave, onCancel, heading,
}: {
  mesh: MeshGradient;
  dark: boolean;
  onChange: (next: MeshGradient) => void;
  onSave: () => void;
  onCancel: () => void;
  heading: string;
}) {
  const [seedIndex, setSeedIndex] = useState(0);
  const current = mesh.seeds[Math.min(seedIndex, mesh.seeds.length - 1)] ?? mesh.seeds[0]!;
  const css = meshCss(mesh, dark);

  function patchSeeds(seeds: string[], blobs = mesh.blobs) {
    const mixed = mixFromSeeds(seeds, {
      intensity: mesh.intensity,
      softness: mesh.softness,
      blobs: blobs.length === seeds.length ? blobs : undefined,
    });
    onChange({ ...mesh, ...mixed });
    if (seedIndex >= seeds.length) setSeedIndex(seeds.length - 1);
  }

  function moveBlob(index: number, x: number, y: number) {
    const blobs = mesh.blobs.map((b, i) => i === index ? { ...b, x, y } : b);
    onChange({ ...mesh, blobs });
  }

  function onPreviewPointer(e: React.PointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 100;
    const y = ((e.clientY - box.top) / box.height) * 100;
    let nearest = 0;
    let best = Infinity;
    mesh.blobs.forEach((b, i) => {
      const d = (b.x - x) ** 2 + (b.y - y) ** 2;
      if (d < best) { best = d; nearest = i; }
    });
    setSeedIndex(nearest);
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const read = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      moveBlob(
        nearest,
        Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100)),
        Math.max(0, Math.min(100, ((ev.clientY - r.top) / r.height) * 100)),
      );
    };
    read(e.nativeEvent);
    const move = (ev: PointerEvent) => read(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: sp(4),
      padding: pad(4),
      border: '1px solid var(--divider-strong)',
      borderRadius: RADIUS.box,
      minWidth: 0,
    }}>
      <div>
        <div style={{ ...TEXT.section }}>{heading}</div>
        <p style={{ margin: `${sp(1)}px 0 0`, ...TEXT.caption }}>
          Цвета выбираете вы, смешивание и пятна — система. Превью следует светлой или тёмной
          теме окна: те же семена, другая атмосфера. Обои это содержимое: любой цвет,
          в том числе сиреневый. Закон палитры сюда не действует.
        </p>
      </div>

      <div
        onPointerDown={onPreviewPointer}
        style={{
          position: 'relative', height: 160, borderRadius: RADIUS.box, overflow: 'hidden',
          backgroundImage: css, backgroundSize: 'cover', cursor: 'default',
          boxShadow: 'inset 0 0 0 1px var(--divider)',
        }}
      >
        {mesh.blobs.map((b, i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: `${b.x}%`, top: `${b.y}%`,
              width: 16, height: 16, marginLeft: -8, marginTop: -8,
              borderRadius: RADIUS.pill,
              background: b.color,
              boxShadow: i === seedIndex
                ? '0 0 0 2px var(--accent), inset 0 0 0 2px var(--on-accent)'
                : 'inset 0 0 0 2px rgb(255,255,255), 0 0 0 1px rgb(0,0,0,0.25)',
              pointerEvents: 'none',
            }}
          />
        ))}
      </div>
      <span style={{ ...TEXT.caption }}>Перетащите пятно, чтобы сдвинуть его.</span>

      <TextField value={mesh.name} onChange={(name) => onChange({ ...mesh, name })} placeholder="Название" />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'center' }}>
        {mesh.seeds.map((c, i) => (
          <button
            key={`${c}-${i}`}
            title={c}
            onClick={() => setSeedIndex(i)}
            style={{
              width: 28, height: 28, borderRadius: RADIUS.pill, background: c, padding: 0,
              border: 'none',
              outline: i === seedIndex ? '2px solid var(--accent)' : '2px solid transparent',
              outlineOffset: 2, cursor: 'default',
            }}
          />
        ))}
        {mesh.seeds.length < MESH_SEEDS_MAX && (
          <button
            onClick={() => patchSeeds([...mesh.seeds, mesh.seeds[0] ?? '#808080'])}
            style={{ ...btnGhost, padding: pad(1, 2), display: 'inline-flex', alignItems: 'center', gap: sp(1) }}
          >
            <Plus size={14} /> Цвет
          </button>
        )}
        {mesh.seeds.length > MESH_SEEDS_MIN && (
          <button
            onClick={() => patchSeeds(mesh.seeds.filter((_, i) => i !== seedIndex))}
            style={{ ...btnGhost, padding: pad(1, 2), display: 'inline-flex', alignItems: 'center', gap: sp(1) }}
          >
            <Trash2 size={14} /> Убрать
          </button>
        )}
      </div>

      <ColorField
        value={current}
        onChange={(hex) => patchSeeds(mesh.seeds.map((c, i) => i === seedIndex ? hex : c), mesh.blobs)}
      />

      <Slider
        label="Насыщенность пятен"
        value={mesh.intensity} min={20} max={100} step={1}
        format={(v) => `${v}%`}
        onChange={(intensity) => onChange({ ...mesh, ...mixFromSeeds(mesh.seeds, { intensity, softness: mesh.softness, blobs: mesh.blobs }) })}
      />
      <Slider
        label="Мягкость"
        value={mesh.softness} min={MESH_SOFTNESS_MIN} max={MESH_SOFTNESS_MAX} step={1}
        format={(v) => `${v}%`}
        onChange={(softness) => onChange({ ...mesh, softness })}
      />
      <Slider
        label="Размер пятна"
        value={mesh.blobs[seedIndex]?.size ?? 70} min={40} max={110} step={1}
        format={(v) => `${v}%`}
        onChange={(size) => {
          const blobs = mesh.blobs.map((b, i) => i === seedIndex ? { ...b, size } : b);
          onChange({ ...mesh, blobs });
        }}
      />

      <div style={{ ...well(), padding: pad(3), ...TEXT.caption }}>
        Готовый градиент появится и в фоне окна, и на новой вкладке.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
        <button type="button" onClick={onSave} style={btnPrimary}>Сохранить</button>
        <button
          type="button"
          onClick={() => onChange({ ...mesh, ...randomMesh(), id: mesh.id, name: mesh.name || 'Случайный' })}
          style={btnGhost}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Shuffle size={14} /> Случайный
          </span>
        </button>
        <button type="button" onClick={onCancel} style={btnGhost}>Отмена</button>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: sp(3) }}>
      <span style={{ flex: '0 0 140px', ...TEXT.body }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1, minWidth: 0 }} />
      <span style={{ flex: '0 0 44px', textAlign: 'right', ...TEXT.caption }}>{format(value)}</span>
    </div>
  );
}
