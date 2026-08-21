import { useEffect, useState } from 'react';
import type React from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import {
  loadNewTabSettings, saveNewTabSettings, WALLPAPER_PRESETS, CRYPTO_CHOICES, RATE_CHOICES,
  type NewTabSettings,
} from '../../newtab/settings';
import { allMeshes, subscribeMeshes } from '../../newtab/gradients';
import { compileMeshBackground } from '../../../shared/chromeGround';
import {
  WIDGET_SIZES, addItem, removeItem, hasItem, setScale, scaleOf, SCALE_PRESETS,
  type DesktopItem, type DesktopLayout, type DesktopScale,
} from '../../newtab/desktop';
import { WIDGET_FILLS, FILL_SWATCH } from './widgets';
import CryptoIcon from '../CryptoIcon';
import { RADIUS } from '../../styles/system';

// Боковая панель настройки рабочего стола — всё, что можно поменять, в одном месте и по одному
// клику. Референс — Bonjourr.
//
// ⚠️ Панель НЕ ЗАМЕНЯЕТ раздел «Интерфейс» в настройках и не дублирует его состояние: обе
// стороны читают и пишут ОДИН стор (src/newtab/settings.ts, localStorage + событие окна), просто
// с разных сторон. Две копии настроек разошлись бы при первой же правке; здесь их нет.
//
// ⚠️ Почему сбоку, а не модалкой посреди экрана: человек крутит ползунок затемнения и должен
// ВИДЕТЬ результат. Модалка закрывает ровно то, что настраивает, — именно этим и была неудобна
// прежняя раскладка, где часть настроек жила в отдельном разделе, а часть на самом столе.

// Что вообще можно поставить на стол. Один список на панель — раньше он жил в AddSheet, и при
// добавлении виджета приходилось помнить, что в другом месте есть ещё и переключатели.
// ⚠️ Виджеты разбиты на ДВЕ группы, а не свалены в один список. Граница проходит там же, где
// проходит настоящая разница между ними: одни строятся из того, что браузер знает про себя,
// другие спрашивают у постороннего сервиса. Сваленные в кучу «Часы, Луна, Дела, Погода…» эту
// разницу стирали, а она — единственное, что человеку тут действительно важно знать.
const WIDGET_GROUPS: { title: string; note?: string; items: { key: string; label: string; icon: string; size: keyof typeof WIDGET_SIZES; net?: string }[] }[] = [
  {
    title: 'Свои данные',
    note: 'Работают офлайн, ничего никуда не отправляют',
    items: [
      { key: 'clock',     label: 'Часы',             icon: '🕒', size: 'small' },
      { key: 'moon',      label: 'Луна',             icon: '🌙', size: 'small' },
      { key: 'shield',    label: 'Защита',           icon: '🛡', size: 'small' },
      { key: 'tasks',     label: 'Дела',             icon: '✓',  size: 'medium' },
      { key: 'downloads', label: 'Загрузки',         icon: '⤓',  size: 'medium' },
      { key: 'digest',    label: 'Чем занимался',   icon: '✦',  size: 'medium' },
      { key: 'topsites',  label: 'Часто открываете', icon: '★',  size: 'medium' },
      { key: 'tracking',  label: 'Отслеживание',     icon: '⤓',  size: 'medium' },
    ],
  },
  {
    title: 'Внешние сервисы',
    note: 'Каждый обращается к указанному сайту',
    items: [
      { key: 'weather',   label: 'Погода',      icon: '🌤', size: 'medium', net: 'Open-Meteo' },
      { key: 'rates',     label: 'Курс валют',  icon: '₽',  size: 'small',  net: 'ЦБ РФ' },
      { key: 'crypto',    label: 'Крипта',      icon: '₿',  size: 'small',  net: 'CoinGecko' },
      { key: 'holiday',   label: 'Праздники',   icon: '🎉', size: 'small',  net: 'date.nager.at' },
    ],
  },
];

interface Props {
  layout: DesktopLayout;
  /** Режим правки живёт в DesktopScreen — панель только переключает его, чтобы «что показывать»
   *  и «где что лежит» настраивались в одном месте, а не двумя разными кнопками. */
  editing: boolean;
  onEditing: (v: boolean) => void;
  onLayout: (next: DesktopLayout) => void;
  onClose: () => void;
}

export default function SidePanel({ layout, onLayout, onClose, editing, onEditing }: Props) {
  const [s, setS] = useState<NewTabSettings>(() => loadNewTabSettings());
  const [meshes, setMeshes] = useState(() => allMeshes());
  useEffect(() => subscribeMeshes(() => setMeshes(allMeshes())), []);
  const apply = (next: NewTabSettings): void => { setS(next); saveNewTabSettings(next); };
  const patchBg = (p: Partial<NewTabSettings['background']>): void =>
    apply({ ...s, background: { ...s.background, ...p } });

  // Esc закрывает — панель это слой поверх стола, и у слоя должен быть выход с клавиатуры.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleWidget = (key: string, size: keyof typeof WIDGET_SIZES): void => {
    const existing = layout.items.find((i) => i.kind === 'widget' && i.widget === key);
    onLayout(existing
      ? removeItem(layout, existing.id)
      : addItem(layout, { kind: 'widget', widget: key, size: WIDGET_SIZES[size] }));
  };

  const setFill = (key: string, fill: string | undefined): void => {
    onLayout({
      ...layout,
      items: layout.items.map((i) => (i.kind === 'widget' && i.widget === key ? { ...i, fill } : i)),
    });
  };

  return (
    // Подложка ловит клик мимо панели. Прозрачная, без затемнения: панель настраивает то, что
    // под ней, и гасить это было бы прямым вредом (см. шапку файла).
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 30 }}>
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 380, maxWidth: '94%',
          background: 'var(--surface-solid)', boxShadow: 'var(--shadow-island)',
          display: 'flex', flexDirection: 'column',
          animation: 'oblako-panel-in var(--dur-base) var(--ease-out)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px',
          borderBottom: '1px solid var(--divider)', flex: 'none',
        }}>
          <span style={{ flex: 1, fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-strong)' }}>
            Настройка экрана
          </span>
          <button onClick={onClose} title="Закрыть" style={iconBtn}><X size={16} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px 28px', display: 'flex', flexDirection: 'column', gap: 26 }}>

          <Section title="Расположение" note="Включите, чтобы перетаскивать плитки и менять их размер прямо на экране">
            <Card>
              <Row>
                <Toggle icon="⠿" label="Режим правки" on={editing} onChange={onEditing} />
              </Row>
            </Card>
            {/* Размер плиток живёт в РАСКЛАДКЕ, а не в настройках вкладки: он задаёт число
                колонок, а колонки — система координат самих плиток, а не украшение. Одна ручка
                на два числа (колонки + потолок клетки) потому, что порознь они бессмысленны:
                шесть мелких плиток на широком окне собрались бы в островок посреди пустоты.
                ⚠️ Смена размера — единственный момент, когда расклад перестраивается не по воле
                человека: в сетке из пяти колонок нет клетки №7. */}
            <Segmented
              value={scaleOf(layout)}
              options={(Object.keys(SCALE_PRESETS) as DesktopScale[])
                .map((id) => [id, SCALE_PRESETS[id].label] as [string, string])}
              onChange={(v) => onLayout(setScale(layout, v as DesktopScale))}
            />
          </Section>

          <Section title="Фон">
            <Segmented
              value={s.background.kind === 'mesh' ? 'preset' : s.background.kind}
              options={[['preset', 'Градиент'], ['photo', 'Фото дня'], ['color', 'Цвет']]}
              onChange={(v) => {
                const kind = v as NewTabSettings['background']['kind'];
                patchBg({ kind: kind === 'preset' && s.background.meshId ? 'mesh' : kind });
              }}
            />
            {(s.background.kind === 'preset' || s.background.kind === 'mesh') && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                {WALLPAPER_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => patchBg({ kind: 'preset', preset: p.id })}
                    title={p.label}
                    style={{
                      height: 34, borderRadius: RADIUS.control, cursor: 'default', background: p.css,
                      border: s.background.kind === 'preset' && s.background.preset === p.id ? '2px solid var(--accent)' : '1px solid var(--divider)',
                    }}
                  />
                ))}
                {meshes.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => patchBg({ kind: 'mesh', meshId: m.id })}
                    title={m.name}
                    style={{
                      height: 34, borderRadius: RADIUS.control, cursor: 'default',
                      backgroundImage: compileMeshBackground(m), backgroundSize: 'cover',
                      border: s.background.kind === 'mesh' && s.background.meshId === m.id ? '2px solid var(--accent)' : '1px solid var(--divider)',
                    }}
                  />
                ))}
              </div>
            )}
            {s.background.kind === 'color' && (
              <input
                type="color"
                value={s.background.color}
                onChange={(e) => patchBg({ color: e.target.value })}
                style={{ width: '100%', height: 34, border: 'none', background: 'none', cursor: 'default' }}
              />
            )}
            {/* Ползунки — то, ради чего панель и сбоку: результат виден сразу за ней. */}
            <Slider label="Затемнение" value={s.background.dim} min={0} max={0.8} step={0.05}
              format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchBg({ dim: v })} />
            <Slider label="Размытие" value={s.background.blur} min={0} max={40} step={1}
              format={(v) => `${Math.round(v)} px`} onChange={(v) => patchBg({ blur: v })} />
          </Section>

          <Section title="Экран">
            <Card>
            <Toggle label="Строка поиска" on={s.search.show}
              onChange={(v) => apply({ ...s, search: { ...s.search, show: v } })} />
            <Toggle label="Приветствие" on={s.greeting.show}
              onChange={(v) => apply({ ...s, greeting: { ...s.greeting, show: v } })} />
            {s.greeting.show && (
              <Field placeholder="Как к вам обращаться" value={s.greeting.name}
                onChange={(v) => apply({ ...s, greeting: { ...s.greeting, name: v } })} />
            )}
            </Card>
          </Section>

          {WIDGET_GROUPS.map((g) => (
            <Section key={g.title} title={g.title} note={g.note}>
              <Card>
                {g.items.map((w, i) => {
                  const on = hasItem(layout, 'widget', w.key);
                  const item = layout.items.find((it) => it.kind === 'widget' && it.widget === w.key);
                  return (
                    <Row key={w.key} divider={i > 0}>
                      <Toggle
                        icon={w.icon}
                        label={w.label}
                        // Имя сервиса — у самого переключателя: это единственный момент, когда
                        // человек принимает решение, и уводить его отсюда некуда.
                        hint={w.net}
                        on={on}
                        onChange={() => toggleWidget(w.key, w.size)}
                      />
                      {/* Цвет — под своим же переключателем. Погоды тут нет: у неё цвет означает
                          время суток и саму погоду. */}
                      {on && w.key !== 'weather' && (
                        <div style={{ display: 'flex', gap: 7, padding: '10px 0 2px 34px' }}>
                          {WIDGET_FILLS.map((f) => (
                            <button
                              key={f.id}
                              onClick={() => setFill(w.key, f.id === 'theme' ? undefined : f.id)}
                              title={f.label}
                              style={{
                                width: 22, height: 22, borderRadius: RADIUS.pill, cursor: 'default', padding: 0,
                                background: FILL_SWATCH[f.id] ?? 'var(--surface-sunken)',
                                border: (item?.fill ?? 'theme') === f.id
                                  ? '2.5px solid var(--accent)' : '1px solid var(--divider-strong)',
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </Row>
                  );
                })}
              </Card>
            </Section>
          ))}

          {hasItem(layout, 'widget', 'clock') && (
            <Section title="Часы">
              <Segmented
                value={s.clock.face}
                options={[['analog', 'Стрелки'], ['digital', 'Цифры']]}
                onChange={(v) => apply({ ...s, clock: { ...s.clock, face: v as 'analog' | 'digital' } })}
              />
              <Toggle label={s.clock.face === 'analog' ? 'Секундная стрелка' : 'Секунды'} on={s.clock.seconds}
                onChange={(v) => apply({ ...s, clock: { ...s.clock, seconds: v } })} />
              <Toggle label="Дата" on={s.clock.date}
                onChange={(v) => apply({ ...s, clock: { ...s.clock, date: v } })} />
              {/* 24 часа осмысленны только у цифр — у стрелок этой разницы не существует. */}
              {s.clock.face === 'digital' && (
                <Toggle label="24 часа" on={s.clock.hour24}
                  onChange={(v) => apply({ ...s, clock: { ...s.clock, hour24: v } })} />
              )}
            </Section>
          )}

          {hasItem(layout, 'widget', 'weather') && (
            <Section title="Погода">
              <Field placeholder="Город" value={s.weather.city}
                onChange={(v) => apply({ ...s, weather: { ...s.weather, city: v } })} />
            </Section>
          )}

          {hasItem(layout, 'widget', 'rates') && (
            <Section title="Валюты">
              <Chips
                items={RATE_CHOICES.map((c) => ({ id: c.code, label: c.label }))}
                active={s.rates.codes}
                onToggle={(code) => apply({
                  ...s,
                  rates: {
                    ...s.rates,
                    codes: s.rates.codes.includes(code)
                      ? s.rates.codes.filter((c) => c !== code)
                      : RATE_CHOICES.map((c) => c.code).filter((c) => c === code || s.rates.codes.includes(c)),
                  },
                })}
              />
            </Section>
          )}

          {hasItem(layout, 'widget', 'crypto') && (
            <Section title="Монеты">
              <Chips
                items={CRYPTO_CHOICES.map((c) => ({ id: c.code, label: c.label, icon: <CryptoIcon code={c.code} size={14} /> }))}
                active={s.crypto.codes}
                onToggle={(code) => apply({
                  ...s,
                  crypto: {
                    ...s.crypto,
                    codes: s.crypto.codes.includes(code)
                      ? s.crypto.codes.filter((c) => c !== code)
                      : CRYPTO_CHOICES.map((c) => c.code).filter((c) => c === code || s.crypto.codes.includes(c)),
                  },
                })}
              />
            </Section>
          )}

          <Section title="Ярлыки">
            <SiteAdder onAdd={(item) => onLayout(addItem(layout, item))} />
            {layout.items.filter((i) => i.kind === 'site').map((i) => (
              <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-body)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{i.title || i.url}</span>
                <button onClick={() => onLayout(removeItem(layout, i.id))} title="Убрать" style={iconBtn}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </Section>
        </div>
      </aside>
    </div>
  );
}

// ── Примитивы панели ─────────────────────────────────────────────────────────
// Свои, а не из settings/kit.tsx: тот набор рассчитан на широкий раздел настроек с описаниями
// под каждым пунктом, здесь же колонка 320 px, и подписи там просто не помещаются.

// ⚠️ Раскладка секций — из настроек iOS, а не из плотной формы: заголовок обычным кеглем над
// КАРТОЧКОЙ со строками, между строками разделители, между секциями воздух. Прежний вариант был
// сплошным столбцом мелких строк без группировки — он и читался как перегруженная панель.
function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-strong)' }}>{title}</span>
      {note && (
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: -4 }}>{note}</span>
      )}
      {children}
    </div>
  );
}

// Карточка секции — белый остров со скруглением, как группа в настройках iOS.
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 'var(--radius-card)',
      border: '1px solid var(--divider)', padding: '4px 14px',
    }}>{children}</div>
  );
}

// Строка карточки. Разделитель — только между строками, а не рамкой вокруг каждой.
function Row({ children, divider }: { children: React.ReactNode; divider?: boolean }) {
  return (
    <div style={{
      padding: '10px 0',
      borderTop: divider ? '1px solid var(--divider)' : undefined,
    }}>{children}</div>
  );
}

function Toggle({ label, hint, on, onChange, icon }: {
  label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; icon?: string;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
        border: 'none', background: 'none', cursor: 'default', padding: '2px 0',
      }}
    >
      {icon && (
        <span style={{
          width: 26, height: 26, flex: 'none', borderRadius: RADIUS.control, fontSize: 'var(--fs-sm)',
          background: 'var(--surface-sunken)', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
        }}>{icon}</span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--text-strong)' }}>{label}</span>
        {hint && (
          <span style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{hint}</span>
        )}
      </span>
      <span style={{
        width: 44, height: 26, borderRadius: RADIUS.pill, flex: 'none', position: 'relative',
        background: on ? 'var(--accent)' : 'var(--surface-sunken)',
        transition: 'background var(--dur-fast) var(--ease-standard)',
      }}>
        <span style={{
          position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20,
          borderRadius: RADIUS.pill, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
          transition: 'left var(--dur-fast) var(--ease-standard)',
        }} />
      </span>
    </button>
  );
}

function Slider({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>
        <span style={{ flex: 1 }}>{label}</span>
        <span style={{ color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{format(value)}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)' }}
      />
    </label>
  );
}

function Segmented({ value, options, onChange }: {
  value: string; options: [string, string][]; onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--surface-sunken)', borderRadius: 'var(--radius-sm)' }}>
      {options.map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          style={{
            flex: 1, padding: '5px 0', border: 'none', cursor: 'default',
            borderRadius: 'calc(var(--radius-sm) - 2px)',
            background: value === id ? 'var(--surface)' : 'transparent',
            boxShadow: value === id ? 'var(--shadow-card)' : 'none',
            color: value === id ? 'var(--text-strong)' : 'var(--text-muted)',
            fontSize: 'var(--fs-xs)', fontWeight: value === id ? 600 : 400,
          }}
        >{label}</button>
      ))}
    </div>
  );
}

function Chips({ items, active, onToggle }: {
  items: { id: string; label: string; icon?: React.ReactNode }[];
  active: string[]; onToggle: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {items.map((it) => {
        const on = active.includes(it.id);
        return (
          <button
            key={it.id}
            onClick={() => onToggle(it.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 9px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'default',
              background: on ? 'var(--surface)' : 'var(--surface-sunken)',
              boxShadow: on ? 'var(--shadow-card)' : 'none',
              color: on ? 'var(--text-strong)' : 'var(--text-muted)',
              fontSize: 'var(--fs-xs)', fontWeight: on ? 600 : 400,
            }}
          >{it.icon}{it.label}</button>
        );
      })}
    </div>
  );
}

function Field({ value, placeholder, onChange }: {
  value: string; placeholder: string; onChange: (v: string) => void;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%', boxSizing: 'border-box', padding: '7px 10px',
        borderRadius: 'var(--radius-sm)', border: '1px solid var(--divider-strong)',
        background: 'var(--surface)', color: 'var(--text-strong)',
        fontSize: 'var(--fs-sm)', fontFamily: 'inherit', outline: 'none',
      }}
    />
  );
}

function SiteAdder({ onAdd }: { onAdd: (item: Omit<DesktopItem, 'id'>) => void }) {
  const [url, setUrl] = useState('');
  const add = (): void => {
    const raw = url.trim();
    if (!raw) return;
    const full = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let title = raw;
    try { title = new URL(full).hostname.replace(/^www\./, ''); } catch { /* останется введённое */ }
    onAdd({ kind: 'site', url: full, title, size: { w: 1, h: 1 } });
    setUrl('');
  };
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input
        value={url}
        placeholder="Адрес сайта"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        style={{
          flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '7px 10px',
          borderRadius: 'var(--radius-sm)', border: '1px solid var(--divider-strong)',
          background: 'var(--surface)', color: 'var(--text-strong)',
          fontSize: 'var(--fs-sm)', fontFamily: 'inherit', outline: 'none',
        }}
      />
      <button onClick={add} title="Добавить" style={{ ...iconBtn, flex: 'none' }}><Plus size={15} /></button>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'default', padding: 5,
  borderRadius: RADIUS.control, color: 'var(--text-faint)', display: 'inline-flex',
};
