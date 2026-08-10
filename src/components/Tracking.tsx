import { useEffect, useState } from 'react';
import { TrendingDown, Trash2, ExternalLink, RefreshCw, AlertTriangle, Bell, BellOff, Link2, Unlink } from 'lucide-react';
import type { TrackedProduct, TrackingEvent, MatchSuggestion } from '../../shared/ipc';
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

  // Размер каждой группы считаем один раз на отрисовку: подпись «в N магазинах» нужна каждой
  // строке группы, а пересчитывать её в цикле — лишняя работа на ровном месте.
  const groupSize = new Map<number, number>();
  for (const it of items ?? []) {
    if (it.groupId > 0) groupSize.set(it.groupId, (groupSize.get(it.groupId) ?? 0) + 1);
  }

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

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px 16px' }}>
        {/* Предложения склеить один товар из разных магазинов. ⚠️ Именно ПРЕДЛОЖЕНИЯ: пока человек
            не подтвердил, ничего не объединено. Ошибка здесь — два разных товара в одной карточке
            с общим графиком цен, то есть враньё в самой сути фичи. */}
        {suggestions.map((sg) => (
          <div key={`${sg.aId}-${sg.bId}`} style={{
            margin: '4px 12px 10px', padding: '10px 12px',
            border: '1px solid var(--divider-strong)', borderRadius: 'var(--radius-sm)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <Link2 size={16} style={{ color: 'var(--text-muted)', flex: 'none' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-strong)' }}>
                Похоже, это один товар в двух магазинах
              </div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
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
          <div style={{ margin: '4px 0 14px' }}>
            <div style={{
              padding: '0 12px 6px', fontSize: 'var(--fs-xs)', fontWeight: 600,
              color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 'var(--ls-caps)',
            }}>Что произошло</div>
            {events.slice(0, 8).map((ev) => (
              <button
                key={ev.id}
                onClick={() => { void window.oblako.createTab(ev.url); }}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 8, width: '100%',
                  padding: '6px 12px', border: 'none', background: 'transparent',
                  cursor: 'default', textAlign: 'left',
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
          // Сколько предложений в этой группе — чтобы подписать «в N магазинах».
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
                  {it.groupId > 0 && groupSize.get(it.groupId)! > 1 && (
                    <span style={{ color: 'var(--accent)' }}>
                      {`один товар в ${groupSize.get(it.groupId)} магазинах`}{' · '}
                    </span>
                  )}
                  {[it.host, it.brand].filter(Boolean).join(' · ')}
                  {notes.length > 0 && ` · ${notes.join(', ')}`}
                  {` · ${checkedAgo(it.lastCheckedAt)}`}
                </div>
              </div>

              {/* ⚠️ Значок «не удалось проверить» обязателен: без него последняя известная цена
                  выглядит свежей, и человек решает о покупке по устаревшим данным, не зная этого. */}
              {it.lastCheckedAt > 0 && !it.lastCheckOk && (
                <span title="Магазин не ответил на последнюю проверку — цена может быть устаревшей"
                      style={{ color: 'var(--tone-warm)', display: 'inline-flex', flex: 'none' }}>
                  <AlertTriangle size={15} />
                </span>
              )}

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

              {it.groupId > 0 && (
                <button
                  title="Вынуть из группы"
                  onClick={() => { void window.oblako.ungroupTracked(it.id).then(reload); }}
                  style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 5, display: 'inline-flex', color: 'var(--text-muted)' }}
                ><Unlink size={15} /></button>
              )}
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
