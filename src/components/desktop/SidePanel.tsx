import { useEffect, useState } from 'react';
import type React from 'react';
import { X, Plus, Trash2, Sparkles } from 'lucide-react';
import {
  loadNewTabSettings, saveNewTabSettings, WALLPAPER_PRESETS, CRYPTO_CHOICES, RATE_CHOICES,
  type NewTabSettings,
} from '../../newtab/settings';
import { allMeshes, subscribeMeshes, meshCss } from '../../newtab/gradients';
import {
  WIDGET_SIZES, addItem, removeItem, hasItem, setScale, scaleOf, SCALE_PRESETS,
  type DesktopItem, type DesktopLayout, type DesktopScale,
} from '../../newtab/desktop';
import { WIDGET_FILLS, FILL_SWATCH } from './widgets';
import CryptoIcon from '../CryptoIcon';
import { RADIUS, ROW_TITLE, TEXT, motion, pad, sp } from '../../styles/system';
import { GenShelf } from './GenCompose';
import { deleteGenRecord } from '../../newtab/genStore';

// Боковая панель настройки рабочего стола — всё, что можно поменять, в одном месте и по одному
// клику. Референс — Bonjourr.
//
// ⚠️ Размеры берутся из дизайн-системы (sp/pad/RADIUS/TEXT/motion), а не пишутся числами. Панель
// под машинную проверку conventions-check не попадает (та смотрит только src/components/settings),
// но правило одно на проект, и держится оно здесь руками.
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

// ⚠️ РАЗМЕРЫ КОНТРОЛОВ, а не отступы: шкала SPACE описывает воздух между вещами, а не саму
// вещь. Поэтому они живут именованными константами здесь, а не числами по месту.
// Ширина панели: 380 было ровно на грани — подписи виджетов ужимались в одну строку, а превью
// градиентов приходилось делать в почтовую марку. 480 даёт строке тела 14 px нормальную меру.
const PANEL_WIDTH = 480;
/** Превью обоев и градиента: ниже 44 узор сетки перестаёт читаться и все превью выглядят одинаково. */
const THUMB_H = 44;
/** Кружок заливки виджета. */
const SWATCH = 26;
/** Плашка значка в строке виджета — по ней же считается отступ ряда заливок под строкой. */
const ICON_BOX = 28;
const TOGGLE_W = 46;
const TOGGLE_H = 28;
const TOGGLE_KNOB = 22;
const TOGGLE_INSET = (TOGGLE_H - TOGGLE_KNOB) / 2;

interface Props {
  layout: DesktopLayout;
  /** Режим правки живёт в DesktopScreen — панель только переключает его, чтобы «что показывать»
   *  и «где что лежит» настраивались в одном месте, а не двумя разными кнопками. */
  editing: boolean;
  onEditing: (v: boolean) => void;
  onLayout: (next: DesktopLayout) => void;
  onClose: () => void;
  /** Уйти в режим сборки своего виджета (см. GenStudio). Панель при этом закрывается. */
  onStudio: () => void;
}

export default function SidePanel({ layout, onLayout, onClose, editing, onEditing, onStudio }: Props) {
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
          position: 'absolute', top: 0, right: 0, bottom: 0, width: PANEL_WIDTH, maxWidth: '94%',
          background: 'var(--surface-solid)', boxShadow: 'var(--shadow-island)',
          display: 'flex', flexDirection: 'column',
          animation: 'oblako-panel-in var(--dur-base) var(--ease-out)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: sp(3), padding: pad(4, 6),
          borderBottom: '1px solid var(--divider)', flex: 'none',
        }}>
          <span style={{ flex: 1, ...TEXT.title }}>
            Настройка экрана
          </span>
          <button onClick={onClose} title="Закрыть" style={iconBtn}><X size={16} /></button>
        </div>

        <div style={{
          flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: sp(8),
          padding: `${sp(6)}px ${sp(6)}px ${sp(8)}px`,
        }}>

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

          <Section title="Свой виджет" note="Локальная модель соберёт одностраничник. В хром он не попадает — только песочница">
            {/* ⚠️ Сборка ушла из панели на сам стол (GenStudio): здесь виджет собирался вслепую —
                превью 240×140 в узкой колонке не показывало ни настоящего размера, ни того, как
                плитка сядет рядом с остальными. Тут осталась только дверь и полка собранного. */}
            <button onClick={onStudio} style={studioBtn}>
              <Sparkles size={16} /> Собрать виджет
            </button>
            <Card>
              <GenShelf
                layout={layout}
                onPlace={(item) => onLayout(addItem(layout, item))}
                onForget={(genId) => {
                  deleteGenRecord(genId);
                  const gone = layout.items.find((i) => i.genId === genId);
                  if (gone) onLayout(removeItem(layout, gone.id));
                }}
              />
            </Card>
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
              <div style={{
                display: 'grid', gap: sp(2),
                gridTemplateColumns: `repeat(auto-fill, minmax(${THUMB_H * 1.6}px, 1fr))`,
              }}>
                {WALLPAPER_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => patchBg({ kind: 'preset', preset: p.id })}
                    title={p.label}
                    style={{
                      height: THUMB_H, borderRadius: RADIUS.control, cursor: 'default', background: p.css,
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
                      height: THUMB_H, borderRadius: RADIUS.control, cursor: 'default',
                      backgroundImage: meshCss(m), backgroundSize: 'cover',
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
                style={{ width: '100%', height: THUMB_H, border: 'none', background: 'none', cursor: 'default' }}
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
                        <div style={{
                          display: 'flex', gap: sp(2),
                          // Отступ слева ровно под плашкой значка: ряд заливок принадлежит строке
                          // выше, и выровнен он по её тексту, а не по краю карточки.
                          padding: `${sp(3)}px 0 ${sp(1)}px ${ICON_BOX + sp(3)}px`,
                        }}>
                          {WIDGET_FILLS.map((f) => (
                            <button
                              key={f.id}
                              onClick={() => setFill(w.key, f.id === 'theme' ? undefined : f.id)}
                              title={f.label}
                              style={{
                                width: SWATCH, height: SWATCH, borderRadius: RADIUS.pill, cursor: 'default', padding: 0,
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
              <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
                <span style={{
                  flex: 1, minWidth: 0, ...TEXT.body,
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
// под каждым пунктом, здесь же одна колонка, и подписи там просто не помещаются.

// ⚠️ Раскладка секций — из настроек iOS, а не из плотной формы: заголовок обычным кеглем над
// КАРТОЧКОЙ со строками, между строками разделители, между секциями воздух. Прежний вариант был
// сплошным столбцом мелких строк без группировки — он и читался как перегруженная панель.
function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
      <span style={{ ...TEXT.section }}>{title}</span>
      {note && (
        <span style={{ ...TEXT.caption, marginTop: -sp(1) }}>{note}</span>
      )}
      {children}
    </div>
  );
}

// Карточка секции — белый остров со скруглением, как группа в настройках iOS.
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: RADIUS.box,
      border: '1px solid var(--divider)', padding: pad(1, 4),
    }}>{children}</div>
  );
}

// Строка карточки. Разделитель — только между строками, а не рамкой вокруг каждой.
function Row({ children, divider }: { children: React.ReactNode; divider?: boolean }) {
  return (
    <div style={{
      padding: `${sp(3)}px 0`,
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
        display: 'flex', alignItems: 'center', gap: sp(3), width: '100%', textAlign: 'left',
        border: 'none', background: 'none', cursor: 'default', padding: `${sp(1)}px 0`,
      }}
    >
      {icon && (
        <span style={{
          width: ICON_BOX, height: ICON_BOX, flex: 'none', borderRadius: RADIUS.control,
          ...TEXT.body, background: 'var(--surface-sunken)', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
        }}>{icon}</span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', ...ROW_TITLE }}>{label}</span>
        {hint && (
          <span style={{ display: 'block', ...TEXT.caption }}>{hint}</span>
        )}
      </span>
      <span style={{
        width: TOGGLE_W, height: TOGGLE_H, borderRadius: RADIUS.pill, flex: 'none', position: 'relative',
        background: on ? 'var(--accent)' : 'var(--surface-sunken)',
        transition: motion.hover('background'),
      }}>
        <span style={{
          position: 'absolute', top: TOGGLE_INSET, width: TOGGLE_KNOB, height: TOGGLE_KNOB,
          left: on ? TOGGLE_W - TOGGLE_KNOB - TOGGLE_INSET : TOGGLE_INSET,
          borderRadius: RADIUS.pill, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
          transition: motion.hover('left'),
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
    <label style={{ display: 'flex', flexDirection: 'column', gap: sp(1) }}>
      <span style={{ display: 'flex', ...TEXT.body }}>
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
    <div style={{
      display: 'flex', gap: 2, padding: 2, background: 'var(--surface-sunken)',
      borderRadius: RADIUS.control,
    }}>
      {options.map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          style={{
            flex: 1, padding: `${sp(2)}px 0`, border: 'none', cursor: 'default',
            borderRadius: RADIUS.tight,
            background: value === id ? 'var(--surface)' : 'transparent',
            boxShadow: value === id ? 'var(--shadow-card)' : 'none',
            ...TEXT.body,
            color: value === id ? 'var(--text-strong)' : 'var(--text-muted)',
            fontWeight: value === id ? 600 : 400,
            transition: motion.hover('background', 'color'),
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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(1) }}>
      {items.map((it) => {
        const on = active.includes(it.id);
        return (
          <button
            key={it.id}
            onClick={() => onToggle(it.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: sp(1),
              padding: pad(2, 3), borderRadius: RADIUS.control, border: 'none', cursor: 'default',
              background: on ? 'var(--surface)' : 'var(--surface-sunken)',
              boxShadow: on ? 'var(--shadow-card)' : 'none',
              ...TEXT.body,
              color: on ? 'var(--text-strong)' : 'var(--text-muted)',
              fontWeight: on ? 600 : 400,
              transition: motion.hover('background', 'color'),
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
        width: '100%', boxSizing: 'border-box', padding: pad(2, 3),
        borderRadius: RADIUS.control, border: '1px solid var(--divider-strong)',
        ...TEXT.body, background: 'var(--surface)', color: 'var(--text-strong)',
        fontFamily: 'inherit', outline: 'none',
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
    <div style={{ display: 'flex', gap: sp(2) }}>
      <input
        value={url}
        placeholder="Адрес сайта"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        style={{
          flex: 1, minWidth: 0, boxSizing: 'border-box', padding: pad(2, 3),
          borderRadius: RADIUS.control, border: '1px solid var(--divider-strong)',
          ...TEXT.body, background: 'var(--surface)', color: 'var(--text-strong)',
          fontFamily: 'inherit', outline: 'none',
        }}
      />
      <button onClick={add} title="Добавить" style={{ ...iconBtn, flex: 'none' }}><Plus size={15} /></button>
    </div>
  );
}

const studioBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: sp(2),
  width: '100%', padding: pad(3, 4), border: 'none', cursor: 'default',
  ...TEXT.body, borderRadius: RADIUS.control,
  background: 'var(--accent)', color: 'var(--on-accent)',
  fontWeight: 600, transition: motion.hover('background'),
};

const iconBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'default', padding: sp(2),
  borderRadius: RADIUS.control, color: 'var(--text-faint)', display: 'inline-flex',
  transition: motion.hover('background', 'color'),
};
