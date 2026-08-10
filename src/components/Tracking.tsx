import { useEffect, useState } from 'react';
import { TrendingDown, Trash2, ExternalLink, RefreshCw, AlertTriangle, Bell, BellOff, Link2, Unlink, Store } from 'lucide-react';
import type { TrackedProduct, TrackingEvent, MatchSuggestion } from '../../shared/ipc';
import { islandPlate } from '../styles/island';

// Экран «что я отслеживаю» (PRICE-TRACKING.md). Компонент только рисует: список, историю цен и
// группы считает main (electron/TrackingStore.ts).
//
// ⚠️ Единица показа — ТОВАР, а не запись в базе. Живой случай: один ноутбук, отслеживаемый на
// Маркете и в Ситилинке, рисовался двумя одинаковыми строками с мелкой подписью «один товар в
// 2 магазинах» — то есть выглядел как дублирование, а не как то, ради чего склейка и делалась.
// Теперь карточка одна на товар, а магазины — предложения внутри неё.
//
// ⚠️ Никаких рекомендаций от модели здесь нет и не планируется. Всё, что показано, — ФАКТЫ из
// наших же наблюдений («дешевле всего», «минимум за всё время»): их считает код, и соврать он не
// может. «Самое время покупать» — совет о деньгах, цена ошибки не дешёвая.

function formatPrice(v: number, currency: string): string {
  const money = v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return `${money} ${currency === 'RUB' ? '₽' : currency}`;
}

// Свой маленький спарклайн: у виджетов рабочего стола он внутренний, а тащить сюда весь модуль
// виджетов ради одной кривой несоразмерно. Форма та же — только линия, без анимаций.
function PriceLine({ values, width = 120, height = 30 }: { values: number[]; width?: number; height?: number }) {
  // ⚠️ Пока наблюдение одно, рисуем ПУНКТИР, а не пустоту. Живой случай: человек добавил товары,
  // увидел на их месте ничего и спросил «а о каком графике речь». Кривой ещё нет по существу
  // (точка одна), но место под неё должно читаться, иначе выглядит как поломка.
  if (values.length < 2) {
    return (
      <svg width={width} height={height} style={{ display: 'block', flex: 'none' }}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2}
              stroke="var(--divider-strong)" strokeWidth={1.5} strokeDasharray="3 4" />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => `${i * step},${height - ((v - min) / span) * height}`).join(' ');
  // Цвет по направлению: у ТОВАРА рост цены — плохо, поэтому тёплый. Это третий случай той же
  // оси, что уже разведена у курса валют и крипты (см. widgets.tsx).
  const down = values[values.length - 1] <= values[0];
  const color = down ? 'var(--tone-green)' : 'var(--tone-warm)';
  return (
    <svg width={width} height={height} style={{ display: 'block', flex: 'none' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// «Проверено» человеческими словами. ⚠️ Показываем ИМЕННО давность проверки, а не только цену:
// цена без даты выглядит свежей всегда, а браузер проверяет только пока открыт.
function checkedAgo(ts: number): string {
  if (!ts) return 'ещё не проверялось';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 2) return 'проверено только что';
  if (mins < 60) return `проверено ${mins} мин назад`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `проверено ${hours} ч назад`;
  return `проверено ${Math.round(hours / 24)} дн назад`;
}

function lastPrice(p: TrackedProduct): number {
  return p.points[p.points.length - 1]?.price ?? 0;
}

/** Один товар: одно или несколько предложений из разных магазинов. */
interface ProductCardData {
  key: string;
  title: string;
  brand: string;
  currency: string;
  offers: TrackedProduct[];
}

/**
 * Собирает записи в карточки товаров.
 *
 * ⚠️ Несклеенная запись — тоже карточка, просто с одним предложением: два разных вида строки
 * («товар» и «просто запись») развалили бы экран на два языка.
 */
function toCards(items: TrackedProduct[]): ProductCardData[] {
  const byGroup = new Map<string, TrackedProduct[]>();
  for (const it of items) {
    const key = it.groupId > 0 ? `g${it.groupId}` : `i${it.id}`;
    const arr = byGroup.get(key) ?? [];
    arr.push(it);
    byGroup.set(key, arr);
  }
  return [...byGroup.entries()].map(([key, offers]) => {
    // Название берём у самого дешёвого: если магазины назвали товар по-разному, показать надо то
    // предложение, к которому человек скорее пойдёт.
    const sorted = [...offers].sort((a, b) => (lastPrice(a) || Infinity) - (lastPrice(b) || Infinity));
    return {
      key,
      title: sorted[0]?.title ?? '',
      brand: sorted[0]?.brand ?? '',
      currency: sorted[0]?.currency ?? 'RUB',
      offers: sorted,
    };
  });
}

export default function Tracking() {
  const [items, setItems] = useState<TrackedProduct[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState('');
  const [events, setEvents] = useState<TrackingEvent[]>([]);
  const [notify, setNotify] = useState(true);
  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([]);

  const reload = () => {
    void window.oblako.listTracked().then(setItems);
    void window.oblako.listTrackingEvents().then(setEvents);
    void window.oblako.listTrackingSuggestions().then(setSuggestions);
  };
  useEffect(() => { reload(); void window.oblako.getTrackingNotify().then(setNotify); }, []);
  useEffect(() => window.oblako.onTrackingChanged(reload), []);

  async function checkNow() {
    setChecking(true); setCheckNote('');
    const res = await window.oblako.checkTrackedNow().catch(() => ({ ok: 0, total: 0 }));
    setChecking(false);
    // Честный итог: сколько магазинов ответили. Часть не отвечает никогда (см. PRICE-TRACKING.md),
    // и делать вид, что проверено всё, нельзя.
    setCheckNote(res.total === 0 ? '' : `Ответили ${res.ok} из ${res.total}`);
    reload();
  }

  if (items === null) {
    return <div style={{ padding: 24, color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>Загрузка…</div>;
  }

  const cards = toCards(items);

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      ...islandPlate, borderRadius: 'var(--radius-island)',
      boxShadow: 'var(--shadow-island)', background: 'var(--surface-solid)', overflow: 'hidden',
    }}>
      <div style={{ padding: '18px 24px 12px', borderBottom: '1px solid var(--divider-strong)', flex: 'none' }}>
        <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-strong)' }}>Отслеживание</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <div style={{ flex: 1, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            Браузер сам перепроверяет цены несколько раз в день, пока открыт. График появится, когда
            цена изменится хотя бы раз. Часть магазинов не отдаёт цену роботу — это видно по дате проверки.
          </div>
          {checkNote && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', flex: 'none' }}>{checkNote}</span>
          )}
          {/* ⚠️ Тумблер обязателен: уведомления, которые нельзя выключить, — это не забота, а
              навязчивость. Журнал при этом пишется всегда: «не дёргай меня» ≠ «мне неинтересно». */}
          <button
            title={notify ? 'Уведомления включены' : 'Уведомления выключены'}
            onClick={() => { const next = !notify; setNotify(next); void window.oblako.setTrackingNotify(next); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none',
              padding: '6px 10px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--divider-strong)', background: 'transparent',
              color: notify ? 'var(--text-body)' : 'var(--text-faint)',
              fontSize: 'var(--fs-xs)', cursor: 'default',
            }}
          >
            {notify ? <Bell size={13} /> : <BellOff size={13} />}
            {notify ? 'Уведомлять' : 'Молча'}
          </button>
          <button
            onClick={() => void checkNow()}
            disabled={checking}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none',
              padding: '6px 10px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--divider-strong)', background: 'transparent',
              color: 'var(--text-body)', fontSize: 'var(--fs-xs)', cursor: 'default',
              opacity: checking ? 0.6 : 1,
            }}
          >
            <RefreshCw size={13} />
            {checking ? 'Проверяю…' : 'Проверить сейчас'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px 20px' }}>
        {/* Предложения склеить один товар из разных магазинов. ⚠️ Именно ПРЕДЛОЖЕНИЯ: пока человек
            не подтвердил, ничего не объединено. Ошибка здесь — два разных товара в одной карточке
            с общим графиком цен, то есть враньё в самой сути фичи. */}
        {suggestions.map((sg) => (
          <div key={`${sg.aId}-${sg.bId}`} style={{
            marginBottom: 12, padding: '12px 14px',
            border: '1px solid var(--accent)', borderRadius: 'var(--radius-card)',
            background: 'var(--accent-soft)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <Link2 size={16} style={{ color: 'var(--accent)', flex: 'none' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
                Похоже, это один товар в двух магазинах
              </div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                {sg.aHost}: {sg.aTitle.slice(0, 60)} · {sg.bHost}: {sg.bTitle.slice(0, 60)}
              </div>
            </div>
            <button
              onClick={() => { void window.oblako.mergeTracked(sg.aId, sg.bId).then(reload); }}
              style={{
                flex: 'none', padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: 'none',
                background: 'var(--accent)', color: '#fff', fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'default',
              }}
            >Объединить</button>
            <button
              onClick={() => { void window.oblako.dismissTrackedMerge(sg.aId, sg.bId).then(reload); }}
              style={{
                flex: 'none', padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--divider-strong)', background: 'transparent',
                color: 'var(--text-body)', fontSize: 'var(--fs-xs)', cursor: 'default',
              }}
            >Разные</button>
          </div>
        ))}

        {/* Журнал событий: тост живёт секунды и его легко пропустить, а «что случилось, пока меня
            не было» — главный вопрос к отслеживанию. */}
        {events.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              padding: '0 2px 6px', fontSize: 'var(--fs-xs)', fontWeight: 600,
              color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 'var(--ls-caps)',
            }}>Что произошло</div>
            {events.slice(0, 8).map((ev) => (
              <button
                key={ev.id}
                onClick={() => { void window.oblako.createTab(ev.url); }}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 8, width: '100%',
                  padding: '6px 8px', border: 'none', background: 'transparent',
                  borderRadius: 'var(--radius-sm)', cursor: 'default', textAlign: 'left',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{
                  flex: 'none', width: 8, height: 8, borderRadius: 999,
                  background: ev.kind === 'drop' || ev.kind === 'back' ? 'var(--tone-green)' : 'var(--tone-warm)',
                }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: 'var(--text-strong)' }}>{ev.title}</span>{' — '}{ev.text}
                </span>
                <span style={{ flex: 'none', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
                  {new Date(ev.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                </span>
              </button>
            ))}
          </div>
        )}

        {cards.length === 0 && (
          <div style={{
            padding: '28px 12px', display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
          }}>
            <TrendingDown size={15} />
            Пока ничего не отслеживается. Откройте карточку товара и нажмите значок в адресной строке.
          </div>
        )}

        {cards.map((card) => <ProductCard key={card.key} card={card} onChanged={reload} />)}
      </div>
    </div>
  );
}

/** Карточка ТОВАРА: название один раз, магазины — предложениями внутри. */
function ProductCard({ card, onChanged }: { card: ProductCardData; onChanged: () => void }) {
  const many = card.offers.length > 1;
  const best = card.offers[0]!;
  const bestPrice = lastPrice(best);
  const worstPrice = lastPrice(card.offers[card.offers.length - 1]!);
  // ⚠️ Факт, а не совет: «дешевле всего вот здесь, разница столько-то» — это арифметика по нашим
  // наблюдениям. «Самое время покупать» тут не появится (см. шапку файла).
  const spread = many ? worstPrice - bestPrice : 0;

  return (
    <div style={{
      marginBottom: 12, padding: '16px 18px',
      border: '1px solid var(--divider)', borderRadius: 'var(--radius-card)',
      background: 'var(--surface)', boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-strong)', lineHeight: 1.3,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{card.title}</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 4 }}>
            {[card.brand, many ? `${card.offers.length} магазина` : best.host].filter(Boolean).join(' · ')}
          </div>
        </div>
        {many && (
          <div style={{ flex: 'none', textAlign: 'right' }}>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-strong)' }}>
              {formatPrice(bestPrice, card.currency)}
            </div>
            {spread > 0 && (
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tone-green)' }}>
                дешевле на {formatPrice(spread, card.currency)}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: many ? 12 : 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {card.offers.map((offer, i) => (
          <OfferRow key={offer.id} offer={offer} currency={card.currency}
                    cheapest={many && i === 0} showTitle={false} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

function OfferRow({ offer, currency, cheapest, onChanged }: {
  offer: TrackedProduct; currency: string; cheapest: boolean; showTitle: boolean; onChanged: () => void;
}) {
  const prices = offer.points.map((p) => p.price);
  const last = prices[prices.length - 1] ?? 0;
  const first = prices[0] ?? 0;
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  const availability = offer.points[offer.points.length - 1]?.availability ?? '';
  const diff = last - first;

  // ⚠️ Только факты. «Минимум за всё время» — это про НАШИ наблюдения, а не про историю магазина,
  // и подпись говорит именно так: обещать больше, чем мы видели, нельзя.
  const notes: string[] = [];
  if (prices.length >= 2 && last === min && min !== max) notes.push('минимум за всё время наблюдений');
  if (prices.length >= 2 && last === max && min !== max) notes.push('максимум за всё время наблюдений');
  if (availability === 'OutOfStock') notes.push('нет в наличии');
  if (availability === 'LimitedAvailability') notes.push('осталось мало');

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 10px', borderRadius: 'var(--radius-sm)',
    }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <Store size={14} style={{ color: cheapest ? 'var(--tone-green)' : 'var(--text-faint)', flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-strong)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {offer.host}
          {cheapest && (
            <span style={{
              fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--tone-green)',
              padding: '1px 6px', borderRadius: 999, background: 'var(--tone-green-fill)',
            }}>дешевле всего</span>
          )}
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
          {[notes.join(', '), checkedAgo(offer.lastCheckedAt)].filter(Boolean).join(' · ')}
        </div>
      </div>

      {/* ⚠️ Значок «не удалось проверить» обязателен: без него последняя известная цена выглядит
          свежей, и человек решает о покупке по устаревшим данным, не зная этого. */}
      {offer.lastCheckedAt > 0 && !offer.lastCheckOk && (
        <span title="Магазин не ответил на последнюю проверку — цена может быть устаревшей"
              style={{ color: 'var(--tone-warm)', display: 'inline-flex', flex: 'none' }}>
          <AlertTriangle size={15} />
        </span>
      )}

      <PriceLine values={prices} />

      <div style={{ textAlign: 'right', flex: 'none', minWidth: 104 }}>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-strong)' }}>
          {formatPrice(last, currency)}
        </div>
        {prices.length >= 2 && diff !== 0 ? (
          <div style={{ fontSize: 'var(--fs-xs)', color: diff < 0 ? 'var(--tone-green)' : 'var(--tone-warm)' }}>
            {diff < 0 ? '−' : '+'}{formatPrice(Math.abs(diff), currency)}
          </div>
        ) : (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>одно наблюдение</div>
        )}
      </div>

      {offer.groupId > 0 && (
        <button
          title="Вынуть из группы — это другой товар"
          onClick={() => { void window.oblako.ungroupTracked(offer.id).then(onChanged); }}
          style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 5, display: 'inline-flex', color: 'var(--text-muted)' }}
        ><Unlink size={15} /></button>
      )}
      <button
        title="Открыть страницу товара"
        onClick={() => { void window.oblako.createTab(offer.url); }}
        style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 5, display: 'inline-flex', color: 'var(--text-muted)' }}
      ><ExternalLink size={15} /></button>
      <button
        title="Не отслеживать"
        onClick={() => { void window.oblako.untrackProduct(offer.id).then(onChanged); }}
        style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 5, display: 'inline-flex', color: 'var(--text-muted)' }}
      ><Trash2 size={15} /></button>
    </div>
  );
}
