import { Component, useMemo, useState, type ReactNode } from 'react';
import type React from 'react';
import { X, Search, Globe } from 'lucide-react';
import { APPS, AppIconBadge } from '../aiApps';
import type { TileSite } from '../../../shared/frecency';
import { WIDGET_SIZES, type DesktopItem, type DesktopLayout, hasItem } from '../../newtab/desktop';
import { WIDGET_RENDERERS, Tile, TileCaption, TileValue } from './widgets';
import { btnPrimary } from '../settings/kit';
import { CELL_REF } from '../../../shared/tileBudget';
import {
  ALTITUDE, CAPS, DISPLAY, RADIUS, ROW_TITLE, TEXT, altitude, cardGlass, motion, pad, sp,
} from '../../styles/system';

// Палитра добавления: виджеты, приложения и свои сайты.
//
// ⚠️ ВИДЖЕТ ПОКАЗАН САМ СОБОЙ, БЕЗ ПОДЛОЖКИ. Первая версия галереи ставила каждый предпросмотр
// в серую коробку с рамкой — и это была двойная ошибка: коробка спорила с собственной плиткой
// виджета (получалась карточка в карточке), а её пропорции ломали композицию, потому что виджет
// внутри всё считает от пиксельного размера коробки. У Apple ровно так же: в палитре лежит сам
// виджет своей формы — квадрат или прямоугольник, — а не картинка виджета в рамке.
//
// ⚠️ Предпросмотр ЖИВОЙ только у тех, кто не ходит в сеть. Смонтировать здесь погоду или курсы
// значило бы сходить к стороннему сервису ДО того, как человек решил их поставить, — то есть
// ровно то, ради избежания чего их нет в стартовом наборе (см. defaultLayout в newtab/desktop.ts).
// Сетевые показываются ПЛИТКОЙ ТОЙ ЖЕ ФОРМЫ с их знаком и именем сервиса: форма и материал
// честные, данных нет.
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

// Клетка и зазор сетки стола: предпросмотр рисуется в НАСТОЯЩИХ пропорциях плитки и уменьшается
// целиком. Ширина колонки постоянна, поэтому коэффициент известен заранее — без замеров и без
// «примерно похоже».
const CELL = 120;
const GAP = 14;
const COL = 236;

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
        background: 'rgba(10,12,20,0.42)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: sp(6),
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          // Готовый рецепт острова — поверхность, скругление содержимого, тень, кромка.
          // ⚠️ Тот же, что у экрана выбора профиля: два «листа поверх экрана» в одном продукте
          // обязаны быть сделаны одинаково, иначе интерфейс выглядит собранным из кусков.
          ...altitude(ALTITUDE.island, { content: true }),
          width: '100%', maxWidth: 980, maxHeight: '88%', overflowY: 'auto',
          padding: `${sp(6)}px ${sp(6)}px ${sp(8)}px`,
          display: 'flex', flexDirection: 'column', gap: sp(6),
          animation: 'oblako-drag-card-in var(--dur-base) var(--ease-out)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: sp(3) }}>
          <span style={{ flex: 1, ...DISPLAY, fontSize: 28, color: 'var(--text-strong)' }}>
            Что поставим?
          </span>
          <button onClick={onClose} title="Закрыть" style={iconBtn}><X size={16} /></button>
        </div>

        {/* Поиск. ⚠️ Ищет и по подписи, а не только по названию: человек чаще помнит, ЧТО виджет
            делает («цены»), чем как он у нас назван («Отслеживание»). */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: sp(2),
          padding: pad(2, 4), borderRadius: RADIUS.pill,
          ...cardGlass(), color: 'var(--text-body)',
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
        </label>

        {widgets.length > 0 && (
          <Group title="Виджеты">
            {/* ⚠️ Колонки ФИКСИРОВАННОЙ ширины, а не резиновые: от неё считается уменьшение
                предпросмотра, и резиновая колонка означала бы замер на каждый кадр. Остаток
                ширины уходит в зазор — сетка остаётся выровненной по левому краю. */}
            <div style={{
              display: 'grid', gap: `${sp(6)}px ${sp(4)}px`,
              gridTemplateColumns: `repeat(auto-fill, ${COL}px)`,
              alignItems: 'start',
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
                  onMouseEnter={(e) => { e.currentTarget.style.transform = motion.lift; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: sp(2),
                    padding: pad(1, 3), borderRadius: RADIUS.pill,
                    ...cardGlass(),
                    cursor: 'default', font: 'inherit',
                    transition: motion.hover('background', 'transform'),
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
            {/* ⚠️ Общий рецепт кнопки из дизайн-системы (btnPrimary), а не своя пилюля. Каждая
                самодельная кнопка — это ещё один вид кнопки в продукте, и именно так интерфейс
                перестаёт выглядеть сделанным одной рукой. */}
            <button
              onClick={addSite}
              style={{ ...btnPrimary, display: 'inline-flex', alignItems: 'center', gap: sp(2) }}
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
  const cells = WIDGET_SIZES[choice.size];
  const w = cells.w * CELL + (cells.w - 1) * GAP;
  const h = cells.h * CELL + (cells.h - 1) * GAP;
  // ⚠️ Широкая плитка занимает ДВЕ колонки. Не ради красоты: 2×2 это квадрат, 4×2 — ровно две
  // такие клетки в ряд, и при таком разбиении высота у них СОВПАДАЕТ. Иначе строки галереи
  // получаются рваными — широкий предпросмотр вдвое ниже квадратного, и под ним зияет дыра.
  const span = cells.w >= 4 ? 2 : 1;
  const cardW = COL * span + sp(4) * (span - 1);
  const scale = cardW / w;

  return (
    // ⚠️ НЕ <button>. Внутри предпросмотра живут собственные кнопки виджета («Собрать», «Старт»),
    // а кнопка внутри кнопки — недопустимая разметка: React ругается, а браузеры расходятся в
    // том, куда уходит клик. Роль и обработчик клавиатуры оставляем, чтобы карточка осталась
    // доступной.
    <div
      role="button"
      tabIndex={0}
      onClick={onAdd}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd(); } }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
      style={{
        gridColumn: `span ${span}`,
        display: 'flex', flexDirection: 'column', gap: sp(3), textAlign: 'left',
        cursor: 'default', outline: 'none',
        transition: motion.state('transform'),
      }}
    >
      {/* Коробка ровно по уменьшенной плитке: никакой рамки и никакой подложки — сам виджет и
          есть картинка. ⚠️ Центрируем ПОЗИЦИОНИРОВАНИЕМ, а не выравниванием сетки: элемент
          крупнее коробки, и браузер выравнивает такой «безопасно» — прижимает к началу. Именно
          от этого предпросмотры уезжали вправо и обрезались. */}
      <div style={{ width: cardW, height: Math.round(h * scale), position: 'relative' }}>
        <div style={{
          position: 'absolute', left: '50%', top: '50%',
          width: w, height: h,
          transform: `translate(-50%, -50%) scale(${scale})`,
          // ⚠️ Клики внутрь не пускаем: карточка целиком — кнопка «добавить», и нажатие на
          // «Собрать» внутри предпросмотра запускало бы работу виджета, которого ещё нет на столе.
          pointerEvents: 'none',
        }}>
          {service
            ? <PosterTile choice={choice} service={service} tileH={h} />
            : <LivePreview widgetKey={choice.key} cells={cells} box={{ width: w, height: h }} tiles={tiles} />}
        </div>
      </div>
      <span style={{ display: 'flex', flexDirection: 'column', gap: sp(1) }}>
        <span style={{ ...ROW_TITLE }}>{choice.label}</span>
        <span style={{
          ...TEXT.caption,
          // ⚠️ Про сеть сказано ЗДЕСЬ и с ИМЕНЕМ сервиса, в момент выбора: человек решает,
          // ставить ли виджет, и ровно в этот момент узнаёт цену.
          color: service ? 'var(--warning-500)' : 'var(--text-faint)',
        }}>
          {service ? `${choice.hint} · данные у ${service}` : choice.hint}
        </span>
      </span>
    </div>
  );
}

/** Живой виджет. Только для тех, кто не ходит в сеть, — см. шапку файла. */
function LivePreview({ widgetKey, cells, box, tiles }: {
  widgetKey: string;
  cells: { w: number; h: number };
  box: { width: number; height: number };
  tiles: TileSite[];
}) {
  const Render = WIDGET_RENDERERS[widgetKey];
  if (!Render) return null;
  return (
    <PreviewBoundary>
      {/* Клетка у превью своя: сетки стола здесь нет, а плотность виджет обязан знать —
          иначе образец в списке живёт по другим правилам, чем плитка на столе. */}
      <Render size={cells} box={box} cell={Math.round(Math.min(CELL_REF, box.width / cells.w))}
        tiles={tiles} onOpen={() => {}} city="" />
    </PreviewBoundary>
  );
}

/**
 * Ограда вокруг предпросмотра.
 *
 * ⚠️ Заведена не «на всякий случай». Палитра монтирует ДЕСЯТОК виджетов разом, и падение любого
 * из них уносило бы весь стол — React снимает всё дерево до ближайшей ограды, а её не было.
 * Цена ошибки несоразмерна: человек открыл список, чтобы что-то поставить, а получил пустую
 * вкладку. Поймано стендом, где виджету досталось пустое хранилище.
 */
class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  render(): ReactNode {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

/**
 * Плитка-заглушка для сетевого виджета: та же форма и тот же материал, что у настоящей, но без
 * единого запроса. ⚠️ Знак крупный и набран дисплейной гарнитурой — плитка должна читаться как
 * виджет, а не как «место, где что-то не загрузилось».
 */
function PosterTile({ choice, service, tileH }: {
  choice: typeof WIDGET_CHOICES[number]; service: string; tileH: number;
}) {
  return (
    <Tile surface toned>
      <TileCaption>{choice.label}</TileCaption>
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <TileValue size={Math.round(tileH * 0.38)}>{choice.glyph}</TileValue>
      </div>
      <span style={{ ...TEXT.caption, color: 'inherit', opacity: 0.7 }}>{service}</span>
    </Tile>
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
