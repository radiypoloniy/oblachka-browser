import { useRef, useState } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import { SectionHeader, Subsection, InlineError, TextField, btnGhost } from './kit';
import Toggle from '../Toggle';
import {
  loadNewTabSettings, saveNewTabSettings, setNewTabCustomImage, getNewTabCustomImage,
  WALLPAPER_PRESETS, type NewTabSettings, type BackgroundKind,
} from '../../newtab/settings';

// Раздел «Интерфейс» — кастомизация минималистичной новой вкладки (см. src/components/NewTab.tsx).
// Пишет в тот же localStorage-стор, что читает вкладка; saveNewTabSettings шлёт событие → открытая
// вкладка применяет изменения живьём. UI-примитивы — из settings/kit + общий Toggle.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // свыше — риск переполнить квоту localStorage

export default function AppearanceSection() {
  const [s, setS] = useState<NewTabSettings>(() => loadNewTabSettings());
  const [hasCustom, setHasCustom] = useState(() => getNewTabCustomImage() !== null);
  const [imgError, setImgError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function apply(next: NewTabSettings) { setS(next); saveNewTabSettings(next); }
  const patchBg = (p: Partial<NewTabSettings['background']>) => apply({ ...s, background: { ...s.background, ...p } });
  const patchClock = (p: Partial<NewTabSettings['clock']>) => apply({ ...s, clock: { ...s.clock, ...p } });
  const patchGreeting = (p: Partial<NewTabSettings['greeting']>) => apply({ ...s, greeting: { ...s.greeting, ...p } });
  const patchWeather = (p: Partial<NewTabSettings['weather']>) => apply({ ...s, weather: { ...s.weather, ...p } });

  function onPickFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) { setImgError('Файл больше 8 МБ'); return; }
    setImgError('');
    const reader = new FileReader();
    reader.onload = () => {
      setNewTabCustomImage(reader.result as string);
      setHasCustom(true);
      patchBg({ kind: 'custom' });
    };
    reader.onerror = () => setImgError('Не удалось прочитать файл');
    reader.readAsDataURL(file);
  }

  function removeCustom() {
    setNewTabCustomImage(null);
    setHasCustom(false);
    if (s.background.kind === 'custom') patchBg({ kind: 'preset' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      <SectionHeader title="Интерфейс">
        Оформление новой вкладки — фон, часы, приветствие и быстрые ссылки.
      </SectionHeader>

      {/* ── Фон ── */}
      <Subsection title="Фон" description="Градиент, свой цвет или изображение.">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([['preset', 'Градиент'], ['color', 'Цвет'], ['custom', 'Своё фото'], ['photo', 'Фото дня']] as [BackgroundKind, string][]).map(([kind, label]) => (
            <SegBtn key={kind} active={s.background.kind === kind}
              onClick={() => patchBg({ kind })}>{label}</SegBtn>
          ))}
        </div>

        {s.background.kind === 'photo' && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            Новое фото каждый день (загружается из интернета через ваше соединение/VPN, кэшируется на день).
          </span>
        )}

        {s.background.kind === 'preset' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {WALLPAPER_PRESETS.map((p) => (
              <button key={p.id} title={p.label} onClick={() => patchBg({ preset: p.id })}
                style={{
                  width: 64, height: 44, borderRadius: 'var(--radius-sm)', cursor: 'default',
                  background: p.css, border: 'none',
                  outline: s.background.preset === p.id ? '2px solid var(--accent)' : '2px solid transparent',
                  outlineOffset: 2,
                }} />
            ))}
          </div>
        )}

        {s.background.kind === 'color' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="color" value={s.background.color}
              onChange={(e) => patchBg({ color: e.target.value })}
              style={{ width: 44, height: 32, border: 'none', background: 'none', cursor: 'default' }} />
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', fontFamily: 'monospace' }}>{s.background.color}</span>
          </div>
        )}

        {s.background.kind === 'custom' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input ref={fileRef} type="file" accept="image/*" hidden
              onChange={(e) => onPickFile(e.target.files?.[0])} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }} onClick={() => fileRef.current?.click()}>
                <Upload size={14} /> {hasCustom ? 'Заменить фото' : 'Выбрать фото'}
              </button>
              {hasCustom && (
                <button style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }} onClick={removeCustom}>
                  <Trash2 size={14} /> Убрать
                </button>
              )}
            </div>
            {imgError && <InlineError>{imgError}</InlineError>}
            {!hasCustom && !imgError && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>Изображение хранится локально на этом устройстве.</span>}
          </div>
        )}

        <SliderRow label="Затемнение" value={s.background.dim} min={0} max={0.8} step={0.02}
          onChange={(v) => patchBg({ dim: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <SliderRow label="Размытие" value={s.background.blur} min={0} max={40} step={1}
          onChange={(v) => patchBg({ blur: v })} format={(v) => `${v}px`} />
      </Subsection>

      {/* ── Часы ── */}
      <Subsection title="Часы">
        <ToggleRow label="Показывать часы" checked={s.clock.show} onChange={(v) => patchClock({ show: v })} />
        {s.clock.show && <>
          <ToggleRow label="24-часовой формат" checked={s.clock.hour24} onChange={(v) => patchClock({ hour24: v })} />
          <ToggleRow label="Секунды" checked={s.clock.seconds} onChange={(v) => patchClock({ seconds: v })} />
        </>}
      </Subsection>

      {/* ── Приветствие ── */}
      <Subsection title="Приветствие">
        <ToggleRow label="Показывать приветствие" checked={s.greeting.show} onChange={(v) => patchGreeting({ show: v })} />
        {s.greeting.show && (
          <TextField value={s.greeting.name} placeholder="Ваше имя (необязательно)"
            onChange={(v) => patchGreeting({ name: v })} />
        )}
      </Subsection>

      {/* ── Поиск и ссылки ── */}
      <Subsection title="Поиск и ссылки">
        <ToggleRow label="Строка поиска" checked={s.search.show} onChange={(v) => apply({ ...s, search: { show: v } })} />
        <ToggleRow label="Быстрые ссылки" checked={s.quickLinks.show} onChange={(v) => apply({ ...s, quickLinks: { ...s.quickLinks, show: v } })} />
        {s.quickLinks.show && (
          <SliderRow label="Сколько ссылок" value={s.quickLinks.count} min={4} max={12} step={1}
            onChange={(v) => apply({ ...s, quickLinks: { ...s.quickLinks, count: v } })} format={(v) => String(v)} />
        )}
      </Subsection>

      {/* ── Погода ── */}
      <Subsection title="Погода" description="Небольшой виджет в углу вкладки.">
        <ToggleRow label="Показывать погоду" checked={s.weather.show} onChange={(v) => patchWeather({ show: v })} />
        {s.weather.show && <>
          <TextField value={s.weather.city} placeholder="Город (например, Москва)"
            onChange={(v) => patchWeather({ city: v })} />
          <div style={{ display: 'flex', gap: 6 }}>
            <SegBtn active={s.weather.units === 'c'} onClick={() => patchWeather({ units: 'c' })}>°C</SegBtn>
            <SegBtn active={s.weather.units === 'f'} onClick={() => patchWeather({ units: 'f' })}>°F</SegBtn>
          </div>
        </>}
      </Subsection>
    </div>
  );
}

// ── Мелкие презентационные хелперы секции ────────────────────────────────────
function SegBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'default',
      fontSize: 'var(--fs-sm)', fontWeight: active ? 600 : 400,
      background: active ? 'var(--surface)' : 'var(--surface-sunken)',
      boxShadow: active ? 'var(--shadow-card)' : 'none',
      color: active ? 'var(--text-strong)' : 'var(--text-body)',
    }}>{children}</button>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>{label}</span>
      <Toggle checked={checked} onChange={() => onChange(!checked)} />
    </div>
  );
}

function SliderRow({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ flex: '0 0 130px', fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1 }} />
      <span style={{ flex: '0 0 44px', textAlign: 'right', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>
        {format(value)}
      </span>
    </div>
  );
}
