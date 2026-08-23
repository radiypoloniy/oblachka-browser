import { useMemo, useState } from 'react';
import type React from 'react';
import { X, Search, Globe } from 'lucide-react';
import { APPS, AppIconBadge } from '../aiApps';
import type { TileSite } from '../../../shared/frecency';
import { WIDGET_SIZES, type DesktopItem, type DesktopLayout, hasItem } from '../../newtab/desktop';
import { WIDGET_RENDERERS } from './widgets';
import { CAPS, RADIUS, ROW_TITLE, TEXT, motion, pad, sp } from '../../styles/system';

// Палитра добавления: виджеты, приложения и свои сайты.
//
// ⚠️ ГАЛЕРЕЯ С ПРЕДПРОСМОТРОМ, а не список строк. Прежний вид — иконка, название, подпись —
// заставлял человека представлять виджет по описанию: «Отслеживание · цены товаров» ничего не
// говорит о том, что окажется на столе. Виджет — вещь ВИЗУАЛЬНАЯ, и выбирают его глазами;
// поэтому здесь он показан ровно таким, каким встанет на стол.
//
// ⚠️ Предпросмотр ЖИВОЙ только у тех, кто не ходит в сеть. Это не лень и не оптимизация:
// смонтировать здесь погоду или курсы значило бы сходить к стороннему сервису ДО того, как
// человек решил их поставить, — то есть ровно то, ради избежания чего их нет в стартовом наборе
// (см. defaultLayout в newtab/desktop.ts). Сетевые показываются карточкой-плакатом, и в подписи
// прямо назван сервис, к которому виджет обратится.
//
// ⚠️ Уже стоящее на столе не предлагается повторно (см. hasItem): два одинаковых виджета погоды —
// не фича, а недосмотр, который человек потом молча удаляет. Сайты — исключение: их сколько
// угодно, они все разные.

// ⚠️ Кто ходит В СЕТЬ и КУДА ИМЕННО. Имя сервиса названо прямо: общая фраза «данные могут
// передаваться» — это шум, который прокликивают не читая, и пользы от неё нет никому.
const NETWORK_WIDGETS: Record<string, string> = {
  weather: 'Open-Meteo',
  rates: 'ЦБ РФ',
  crypto: 'CoinGecko',
};

const WIDGET_CHOICES: { key: string; label: string; hint: string; glyph: string; size: keyof typeof WIDGET_SIZES }[] = [
  { key: 'clock',     label: 'Часы',             hint: 'Время и дата',                   glyph: '🕒', size: 'small' },
  { key: 'calendar',  label: 'Календарь',        hint: 'Месяц целиком',                  glyph: '📅', size: 'small' },
  { key: 'timer',     label: 'Таймер',           hint: '5, 10 или 20 минут',             glyph: '⏱', size: 'small' },
  { key: 'weather',   label: 'Погода',           hint: 'Прогноз на ближайшие часы',      glyph: '🌤', size: 'medium' },
  { key: 'rates',     label: 'Курс валют',       hint: 'Доллар и евро, график за месяц', glyph: '₽', size: 'small' },
  { key: 'crypto',    label: 'Крипта',           hint: 'Цены в рублях и за 24 часа',     glyph: '₿', size: 'small' },
  { key: 'tasks',     label: 'Дела',             hint: 'Список с галочками',             glyph: '✓', size: 'medium' },
  { key: 'topsites',  label: 'Часто открываете', hint: 'Сайты из вашей истории',         glyph: '★', size: 'medium' },
  // ⚠️ Про сеть здесь СВОЯ формулировка: сам виджет никуда не ходит и ничего не сообщает, но
  // обложку показывает по ссылке сервиса — картинка грузится с того же сайта, который человек и
  // так слушает.
  { key: 'music',     label: 'Музыка',           hint: 'Управление тем, что играет · обложка грузится с сервиса', glyph: '♪', size: 'medium' },
  { key: 'shield',    label: 'Защита',           hint: 'Адблок и VPN',                   glyph: '🛡', size: 'small' },
  { key: 'moon',      label: 'Луна',             hint: 'Фаза по дате',                   glyph: '🌙', size: 'small' },
  { key: 'downloads', label: 'Загрузки',         hint: 'Что качается',                   glyph: '⤓', size: 'medium' },
  { key: 'holiday',   label: 'Праздники',        hint: 'Сколько до ближайшего',          glyph: '🎉', size: 'small' },
  { key: 'digest',    label: 'Чем занимался',    hint: 'Итог дня по вашей истории',      glyph: '✦', size: 'medium' },
  // ⚠️ «Не ходит в сеть» тут значит «сам никуда не ходит»: цены перепроверяет фоновый обходчик
  // (electron/TrackingChecker.ts), а виджет только показывает уже собранное.
  { key: 'tracking',  label: 'Отслеживание',     hint: 'Цены товаров',                   glyph: '⤓', size: 'medium' },
];

// Клетка и зазор сетки стола: предпросмотр рисуется в НАСТОЯЩИХ пропорциях плитки и лишь потом
// уменьшается целиком. Иначе виджет в галерее выглядел бы не так, как встанет на стол, — у него
// внутри всё считается от пиксельного размера коробки.
const CELL = 120;
const GAP = 14;
const PREVIEW_W = 232;
const PREVIEW_H = 132;

interface Props {
  layout: DesktopLayout;
  /** Сайты для живого предпросмотра «Часто открываете» — те же, что на столе. */
  tiles: TileSite[];
  onAdd: (item: Omit<DesktopItem, 'id'>) => void;
  onClose: () => void;
}

export default function AddSheet({ layout, tiles, onAdd, onClose }: Props) {
  const [siteUrl, setSiteUrl] = useState('');
  const [siteName, setSiteName] = useState('');
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const widgets = useMemo(
    () => WIDGET_CHOICES.filter((w) => !hasItem(layout, 'widget', w.key))
      .filter((w) => !q || w.label.toLowerCase().includes(q) || w.hint.toLowerCase().includes(q)),
    [layout, q],
  );
  const apps = useMemo(
    () => APPS.filter((a) => !hasItem(layout, 'app', a.id))
      .filter((a) => !q || a.label.toLowerCase().includes(q)),
    [layout, q],
  );

  const addSite = (): void => {
    const raw = siteUrl.trim();
    if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let title = siteName.trim();
    if (!title) {
      // Имя по домену — человеку не обязательно придумывать подпись самому.
      try { title = new URL(url).hostname.replace(/^www\./, ''); } catch { title = raw; }
    }
    onAdd({ kind: 'site', url, title, size: { w: 1, h: 1 } });
    setSiteUrl(''); setSiteName('');
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 20,
        background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: sp(6),
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 880, maxHeight: '86%', overflowY: 'auto',
          background: 'var(--surface-solid)', borderRadius: 'var(--radius-island)',
          boxShadow: 'var(--shadow-island)', padding: sp(6),
          display: 'flex', flexDirection: 'column', gap: sp(6),
          animation: 'oblako-drag-card-in var(--dur-base) var(--ease-out)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: sp(3) }}>
          <span style={{ flex: 1, ...TEXT.section, color: 'var(--text-strong)' }}>
            Добавить на экран
          </span>
          <button onClick={onClose} title="Закрыть" style={iconBtn}><X size={16} /></button>
        </div>

        {/* Поиск. ⚠️ Ищет и по подписи, а не только по названию: человек чаще помнит, ЧТО виджет
            делает («цены»), чем как он у нас назван («Отслеживание»). */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: sp(2),
          padding: pad(2, 4), borderRadius: RADIUS.pill,
          background: 'var(--surface-sunken)', border: '1px solid var(--divider)',
        }}>
          <Search size={16} style={{ color: 'var(--text-faint)', flex: 'none' }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск в виджетах"
            style={{
              flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
              color: 'var(--text-body)', ...TEXT.body, fontFamily: 'inherit',
            }}
          />
        </div>

        {widgets.length > 0 && (
          <Group title="Виджеты">
            <div style={{
              display: 'grid', gap: sp(4),
              gridTemplateColumns: `repeat(auto-fill, minmax(${PREVIEW_W}px, 1fr))`,
            }}>
              {widgets.map((w) => (
                <WidgetCard
                  key={w.key}
                  choice={w}
                  tiles={tiles}
                  service={NETWORK_WIDGETS[w.key]}
                  onAdd={() => onAdd({ kind: 'widget', widget: w.key, size: WIDGET_SIZES[w.size] })}
                />
              ))}
            </div>
          </Group>
        )}

        {apps.length > 0 && (
          <Group title="Приложения">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
              {apps.map((a) => (
                <button
                  key={a.id}
                  onClick={() => onAdd({ kind: 'app', appId: a.id, size: { w: 1, h: 1 } })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: sp(2),
                    padding: pad(1, 3), borderRadius: RADIUS.pill,
                    border: '1px solid var(--divider)', background: 'var(--surface-sunken)',
                    color: 'var(--text-body)', cursor: 'default', font: 'inherit',
                    transition: motion.hover('background', 'border-color'),
                  }}
                >
                  <AppIconBadge app={a} size={24} iconSize={14} />
                  <span style={{ ...TEXT.body }}>{a.label}</span>
                </button>
              ))}
            </div>
          </Group>
        )}

        {widgets.length === 0 && apps.length === 0 && (
          <span style={{ ...TEXT.body, color: 'var(--text-faint)' }}>
            {q ? 'Ничего не нашлось — попробуйте другое слово.' : 'Всё уже на экране.'}
          </span>
        )}

        <Group title="Сайт">
          <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
            <input
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addSite(); }}
              placeholder="Адрес, например github.com"
              style={{ ...field, flex: '2 1 240px' }}
            />
            <input
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addSite(); }}
              placeholder="Название (необязательно)"
              style={{ ...field, flex: '1 1 160px' }}
            />
            <button
              onClick={addSite}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: sp(2), flex: 'none',
                padding: `0 ${sp(4)}px`, height: 38, borderRadius: RADIUS.pill,
                border: 'none', cursor: 'default', background: 'var(--accent)', color: 'var(--on-accent)',
                ...TEXT.body, fontWeight: 600,
              }}
            ><Globe size={15} /> Добавить</button>
          </div>
        </Group>
      </div>
    </div>
  );
}

function WidgetCard({ choice, tiles, service, onAdd }: {
  choice: typeof WIDGET_CHOICES[number];
  tiles: TileSite[];
  /** Сервис, к которому виджет обращается. Пусто — виджет никуда не ходит. */
  service?: string;
  onAdd: () => void;
}) {
  return (
    <button
      onClick={onAdd}
      onMouseEnter={(e) => { e.currentTarget.style.transform = motion.lift; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
      style={{
        display: 'flex', flexDirection: 'column', gap: sp(2), textAlign: 'left',
        padding: 0, border: 'none', background: 'transparent', cursor: 'default',
        transition: motion.hover('transform'),
      }}
    >
      <div style={{
        width: '100%', height: PREVIEW_H, borderRadius: RADIUS.box, overflow: 'hidden',
        background: 'var(--surface-sunken)', border: '1px solid var(--divider)',
        display: 'grid', placeItems: 'center',
      }}>
        {service
          ? <Poster glyph={choice.glyph} />
          : <LivePreview widgetKey={choice.key} size={choice.size} tiles={tiles} />}
      </div>
      <span style={{ ...ROW_TITLE }}>{choice.label}</span>
      <span style={{
        ...TEXT.caption,
        // ⚠️ Про сеть сказано ЗДЕСЬ и с ИМЕНЕМ сервиса, в момент выбора: человек решает, ставить
        // ли виджет, и ровно в этот момент узнаёт цену.
        color: service ? 'var(--warning-500)' : 'var(--text-faint)',
      }}>
        {service ? `${choice.hint} · запрашивает данные у ${service}` : choice.hint}
      </span>
    </button>
  );
}

/** Живой виджет, уменьшенный целиком. Только для тех, кто не ходит в сеть, — см. шапку файла. */
function LivePreview({ widgetKey, size, tiles }: {
  widgetKey: string; size: keyof typeof WIDGET_SIZES; tiles: TileSite[];
}) {
  const cells = WIDGET_SIZES[size];
  const w = cells.w * CELL + (cells.w - 1) * GAP;
  const h = cells.h * CELL + (cells.h - 1) * GAP;
  // Вписываем с полями: плитка в предпросмотре должна читаться как отдельный предмет, а не
  // упираться в края карточки.
  const scale = Math.min((PREVIEW_W - sp(6)) / w, (PREVIEW_H - sp(4)) / h);
  const Render = WIDGET_RENDERERS[widgetKey];
  if (!Render) return <Poster glyph="★" />;
  return (
    <div style={{
      width: w, height: h, flex: 'none',
      transform: `scale(${scale})`, transformOrigin: 'center',
      // ⚠️ Клики внутрь не пускаем: карточка целиком — это кнопка «добавить», и нажатие на
      // «Собрать» внутри предпросмотра запускало бы работу виджета, которого ещё нет на столе.
      pointerEvents: 'none',
    }}>
      <Render
        size={cells}
        box={{ width: w, height: h }}
        tiles={tiles}
        onOpen={() => {}}
        city=""
      />
    </div>
  );
}

/** Карточка-плакат для сетевых виджетов: показываем знак, а не ходим за данными. */
function Poster({ glyph }: { glyph: string }) {
  return (
    <span style={{
      width: 64, height: 64, borderRadius: RADIUS.box,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--surface)', border: '1px solid var(--divider)',
      fontSize: 30, lineHeight: 1,
    }}>{glyph}</span>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3) }}>
      <span style={{ ...CAPS }}>{title}</span>
      {children}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'default', padding: sp(1),
  borderRadius: RADIUS.control, color: 'var(--text-faint)', display: 'inline-flex',
};

const field: React.CSSProperties = {
  height: 38, padding: `0 ${sp(3)}px`, borderRadius: RADIUS.control,
  border: '1px solid var(--divider-strong)', background: 'var(--surface-sunken)',
  color: 'var(--text-body)', ...TEXT.body, outline: 'none', minWidth: 0,
  fontFamily: 'inherit',
};
