import { useEffect, useState } from 'react';
import { TrendingDown, Trash2, ExternalLink } from 'lucide-react';
import type { TrackedProduct } from '../../shared/ipc';
import { islandPlate } from '../styles/island';

// Экран «что я отслеживаю» (PRICE-TRACKING.md, срез 1). Компонент только рисует: список и историю
// цен считает main (electron/TrackingStore.ts).
//
// ⚠️ Никаких рекомендаций от модели здесь нет и не планируется. Всё, что показано, — ФАКТЫ из
// наших же наблюдений («минимум за всё время», «дешевле, чем когда добавили»): их считает код, и
// соврать он не может. «Самое время покупать» — совет о деньгах, цена ошибки не дешёвая.

function formatPrice(v: number, currency: string): string {
  const money = v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return `${money} ${currency === 'RUB' ? '₽' : currency}`;
}

// Свой маленький спарклайн: у виджетов рабочего стола он внутренний, а тащить сюда весь модуль
// виджетов ради одной кривой несоразмерно. Форма та же — только opacity/линия, без анимаций.
function PriceLine({ values, width = 160, height = 34 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
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

export default function Tracking() {
  const [items, setItems] = useState<TrackedProduct[] | null>(null);

  const reload = () => { void window.oblako.listTracked().then(setItems); };
  useEffect(() => { reload(); }, []);
  useEffect(() => window.oblako.onTrackingChanged(reload), []);

  if (items === null) {
    return <div style={{ padding: 24, color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>Загрузка…</div>;
  }

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      ...islandPlate, borderRadius: 'var(--radius-island)',
      boxShadow: 'var(--shadow-island)', background: 'var(--surface-solid)', overflow: 'hidden',
    }}>
      <div style={{ padding: '18px 24px 12px', borderBottom: '1px solid var(--divider-strong)', flex: 'none' }}>
        <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-strong)' }}>Отслеживание</div>
        <div style={{ marginTop: 4, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          Цена записывается, когда вы открываете страницу товара. Значок отслеживания появляется
          в адресной строке там, где магазин публикует цену в стандартной разметке.
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px 16px' }}>
        {items.length === 0 && (
          <div style={{
            padding: '28px 12px', display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
          }}>
            <TrendingDown size={15} />
            Пока ничего не отслеживается. Откройте карточку товара и нажмите значок в адресной строке.
          </div>
        )}

        {items.map((it) => {
          const prices = it.points.map((p) => p.price);
          const last = prices[prices.length - 1] ?? 0;
          const first = prices[0] ?? 0;
          const min = prices.length ? Math.min(...prices) : 0;
          const max = prices.length ? Math.max(...prices) : 0;
          const availability = it.points[it.points.length - 1]?.availability ?? '';
          const diff = last - first;

          // ⚠️ Только факты. «Минимум за всё время» — это про НАШИ наблюдения, а не про историю
          // магазина, и подпись говорит именно так: обещать больше, чем мы видели, нельзя.
          const notes: string[] = [];
          if (prices.length >= 2 && last === min && min !== max) notes.push('минимальная за всё время наблюдений');
          if (prices.length >= 2 && last === max && min !== max) notes.push('максимальная за всё время наблюдений');
          if (availability === 'OutOfStock') notes.push('нет в наличии');
          if (availability === 'LimitedAvailability') notes.push('осталось мало');

          return (
            <div key={it.id} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '12px', borderRadius: 'var(--radius-sm)',
            }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{it.title}</div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
                  {[it.host, it.brand].filter(Boolean).join(' · ')}
                  {notes.length > 0 && ` · ${notes.join(', ')}`}
                </div>
              </div>

              <PriceLine values={prices} />

              <div style={{ textAlign: 'right', flex: 'none', minWidth: 110 }}>
                <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-strong)' }}>
                  {formatPrice(last, it.currency)}
                </div>
                {prices.length >= 2 && diff !== 0 && (
                  <div style={{
                    fontSize: 'var(--fs-xs)',
                    color: diff < 0 ? 'var(--tone-green)' : 'var(--tone-warm)',
                  }}>
                    {diff < 0 ? '−' : '+'}{formatPrice(Math.abs(diff), it.currency)} с добавления
                  </div>
                )}
                {prices.length < 2 && (
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>одно наблюдение</div>
                )}
              </div>

              <button
                title="Открыть страницу товара"
                onClick={() => { void window.oblako.createTab(it.url); }}
                style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 5, display: 'inline-flex', color: 'var(--text-muted)' }}
              ><ExternalLink size={15} /></button>
              <button
                title="Не отслеживать"
                onClick={() => { void window.oblako.untrackProduct(it.id).then(reload); }}
                style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 5, display: 'inline-flex', color: 'var(--text-muted)' }}
              ><Trash2 size={15} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
