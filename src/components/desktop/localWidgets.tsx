import { useEffect, useState } from 'react';
import { Tile, TileCaption, type WidgetProps } from './widgets';
import type { TrackedProduct } from '../../../shared/ipc';
import type { DayDigestState } from '../../../shared/ipc';

// Виджеты, которым НЕ НУЖНА СЕТЬ. Отдельным файлом не только ради объёма widgets.tsx: это
// смысловая граница. Всё здесь строится из того, что браузер уже знает про себя, поэтому такой
// виджет ничего никому не сообщает и стоит на столе без единой оговорки о передаче данных — в
// отличие от погоды, курсов и крипты, которых по этой причине нет даже в стартовом наборе
// (см. NETWORK_WIDGETS в AddSheet.tsx).

// ── Фаза луны ─────────────────────────────────────────────────────────────────
//
// Ни одного запроса вообще: фаза считается из даты формулой. Метод — синодический месяц
// (29.53059 суток) от известного новолуния 6 января 2000, 18:14 UTC. Точность порядка часов;
// астрономические поправки здесь были бы точностью ради точности — картинке и подписи хватает.
const SYNODIC_DAYS = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14) / 86_400_000;

const MOON_PHASES = [
  'Новолуние', 'Растущий серп', 'Первая четверть', 'Растущая луна',
  'Полнолуние', 'Убывающая луна', 'Последняя четверть', 'Убывающий серп',
];

function moonAge(now: Date): number {
  const days = now.getTime() / 86_400_000 - KNOWN_NEW_MOON;
  return ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
}

export function MoonWidget({ box, fill }: WidgetProps) {
  const [now, setNow] = useState(() => new Date());
  // Раз в час: фаза за минуту не меняется, а таймер на секундах жёг бы кадры впустую.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 3_600_000);
    return () => clearInterval(t);
  }, []);

  const age = moonAge(now);
  const frac = age / SYNODIC_DAYS;                 // 0 — новолуние, 0.5 — полнолуние
  const phase = MOON_PHASES[Math.round(frac * 8) % 8]!;
  const lit = Math.round((1 - Math.cos(frac * 2 * Math.PI)) / 2 * 100);
  const disc = Math.max(48, Math.min(box.width - 44, box.height - 84));

  return (
    <Tile surface fill={fill}>
      <TileCaption>Луна</TileCaption>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <MoonDisc frac={frac} size={disc} />
      </div>
      <div style={{ flex: 'none', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{phase}</div>
      <div style={{ flex: 'none', fontSize: 'var(--fs-xs)', opacity: 0.7 }}>
        Освещена на {lit}% · {Math.round(age)}-й день
      </div>
    </Tile>
  );
}

// ⚠️ Терминатор рисуется ДВУМЯ дугами, а не кругом с наложенной тенью: у настоящей луны граница
// света идёт по эллипсу, и полукруг с прямым краем выдаёт подделку сразу — это заметно даже
// на 60 px. rx — полуось этого эллипса, она и «выгибает» границу от серпа к полудиску.
function MoonDisc({ frac, size }: { frac: number; size: number }) {
  const r = 50;
  const k = Math.cos(frac * 2 * Math.PI);  // 1 — новолуние, 0 — четверть, -1 — полнолуние
  const waxing = frac < 0.5;               // растущая — освещён правый край
  const sweepOuter = waxing ? 1 : 0;
  const sweepInner = k > 0 ? (waxing ? 0 : 1) : (waxing ? 1 : 0);

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden style={{ display: 'block' }}>
      <circle cx="50" cy="50" r={r} fill="#2A2F3C" />
      <path
        d={`M50 0 A ${r} ${r} 0 0 ${sweepOuter} 50 100 A ${Math.abs(k) * r} ${r} 0 0 ${sweepInner} 50 0 Z`}
        fill="#E8E4D9"
      />
      {/* Пара «морей»: без них диск выглядит пластиковым кружком, а не луной. */}
      <circle cx="38" cy="36" r="9" fill="rgba(110,112,124,0.20)" />
      <circle cx="58" cy="61" r="12" fill="rgba(110,112,124,0.16)" />
      <circle cx="63" cy="33" r="5" fill="rgba(110,112,124,0.18)" />
    </svg>
  );
}

// ── Защита ────────────────────────────────────────────────────────────────────
//
// ⚠️ ОДИН виджет на VPN и адблок, а не два. Они отвечают на один вопрос — «я сейчас прикрыт?» —
// и двумя плитками этот ответ пришлось бы собирать глазами. По той же причине в тулбаре они уже
// объединены в поповер «Защита» (см. Toolbar.tsx): разводить их на столе значило бы спорить с
// решением, принятым в самом браузере.
export function ShieldWidget({ box, fill }: WidgetProps) {
  const [ad, setAd] = useState<{ enabled: boolean; blocked: number } | null>(null);
  const [vpnOn, setVpnOn] = useState(false);

  useEffect(() => {
    void window.oblako.getAdBlockState()
      .then((s) => setAd({ enabled: s.enabled, blocked: s.sessionBlockCount }))
      .catch(() => { /* плитка только показывает — молчим */ });
    return window.oblako.onAdBlockStateChanged((s) => setAd({ enabled: s.enabled, blocked: s.sessionBlockCount }));
  }, []);

  useEffect(() => window.oblako.onVpnConnectionStateChanged((s) => setVpnOn(s.state === 'running')), []);

  // ⚠️ Тесная плитка — ОТДЕЛЬНЫЙ вид, а не тот же самый ужатый. В одну клетку высотой прежняя
  // вёрстка не складывалась вовсе: счётчик заезжал под заголовок, строка «заблокировано за
  // сеанс» рвалась на три, а две точки состояния переносились и накладывались на неё. Здесь
  // нет места на всё сразу, поэтому в тесноте виджет отвечает на главный вопрос («прикрыт ли
  // я и сколько отбито»), а подпись про сеанс уходит в подсказку курсором.
  const compact = box.height < 150;
  const big = Math.round(Math.min(box.height * (compact ? 0.34 : 0.3), 46));

  if (compact) {
    return (
      <Tile surface fill={fill} padding={12}>
        {/* Заголовок остаётся и здесь: без него «0» рядом с двумя точками не отвечает, чего
            именно ноль. А вот подпись «заблокировано за сеанс» в эту высоту уже не влезает —
            она ушла в подсказку курсором на самом числе. */}
        <TileCaption>Защита</TileCaption>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minHeight: 0, minWidth: 0 }}>
          <div title="Заблокировано за сеанс" style={{
            fontSize: big, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums', flex: 'none',
          }}>
            {ad ? ad.blocked.toLocaleString('ru') : '—'}
          </div>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0,
            fontSize: 'var(--fs-xs)', overflow: 'hidden',
          }}>
            <StatusDot on={ad?.enabled ?? false} label="Адблок" />
            <StatusDot on={vpnOn} label="VPN" />
          </div>
        </div>
      </Tile>
    );
  }

  return (
    <Tile surface fill={fill}>
      <TileCaption>Защита</TileCaption>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontSize: big, fontWeight: 600, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
          {ad ? ad.blocked.toLocaleString('ru') : '—'}
        </div>
        {/* «за сеанс» — не мелочь: счётчик обнуляется при перезапуске (см. AdBlockState), и без
            подписи человек читал бы его как «за всё время» и удивлялся, куда всё делось. */}
        <div style={{ fontSize: 'var(--fs-xs)', opacity: 0.7, marginTop: 2 }}>заблокировано за сеанс</div>
      </div>
      <div style={{ flex: 'none', display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 'var(--fs-xs)' }}>
        <StatusDot on={ad?.enabled ?? false} label="Адблок" />
        <StatusDot on={vpnOn} label="VPN" />
      </div>
    </Tile>
  );
}

// Зелёная точка = работает. Это тот самый функциональный зелёный из цветового закона
// (--dot-vpn), а не декоративный: он и в остальном интерфейсе означает ровно это.
function StatusDot({ on, label }: { on: boolean; label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, opacity: on ? 1 : 0.5,
      // Не переносим: перенос ставил слово «выкл» на вторую строку и накладывал его на соседа.
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', flex: 'none',
        background: on ? 'var(--dot-vpn)' : 'currentColor',
      }} />
      {on ? label : `${label} выкл`}
    </span>
  );
}

// ── Итоги дня ─────────────────────────────────────────────────────────────────
//
// ⚠️ Первый сбор — ТОЛЬКО по кнопке, и это не лень интерфейса. Материал берётся из истории
// посещений, а считает его локальная модель, которая может быть выгружена: холодная загрузка —
// около полуминуты и несколько гигабайт видеопамяти. Делать это молча оттого, что человек открыл
// новую вкладку, нельзя (то же правило, что у поиска вкладок и разбора полей формы). Дальше итог
// живёт в кэше весь день и обновляется фоном — уже на тёплой модели.
//
// ⚠️ Виджет НЕ показывает список посещённых страниц. Он для того, чтобы вспомнить, чем был занят
// день, а не чтобы выставить историю на всеобщее обозрение поверх обоев: экран новой вкладки
// видят и через плечо, и на демонстрации экрана.
export function DigestWidget({ box, fill }: WidgetProps) {
  const [state, setState] = useState<DayDigestState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.oblako.getDayDigest().then((s) => { if (alive) setState(s); }).catch(() => { /* итог — не критично */ });
    return () => { alive = false; };
  }, []);

  const build = (): void => {
    setBusy(true);
    void window.oblako.buildDayDigest()
      .then((s) => setState(s))
      .catch(() => { /* модели нет — останется прежнее состояние */ })
      .finally(() => setBusy(false));
  };

  const lines = state?.state === 'ready' ? state.digest.lines : [];
  const capacity = Math.max(1, Math.floor((box.height - 64) / 24));
  const builtAt = state?.state === 'ready' ? new Date(state.digest.builtAt) : null;

  return (
    <Tile surface fill={fill}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, flex: 'none' }}>
        <TileCaption>Чем занимался</TileCaption>
        {builtAt && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {builtAt.getHours()}:{String(builtAt.getMinutes()).padStart(2, '0')}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {lines.slice(0, capacity).map((line, i) => (
          <div key={i} style={{ display: 'flex', gap: 7, fontSize: 'var(--fs-sm)', lineHeight: 1.25 }}>
            <span style={{ opacity: 0.45, flex: 'none' }}>•</span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{line}</span>
          </div>
        ))}

        {lines.length === 0 && (
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            {busy ? 'Читаю историю за сегодня…'
              : state?.state === 'empty' && state.reason === 'no-history'
                ? 'Сегодня ещё нечего обобщать'
                : 'Соберу итог дня по вашей истории — локально, без сети'}
          </span>
        )}
      </div>

      {lines.length === 0 && !(state?.state === 'empty' && state.reason === 'no-history') && (
        <button
          onClick={build}
          disabled={busy}
          style={{
            flex: 'none', alignSelf: 'flex-start', marginTop: 8,
            border: 'none', background: busy ? 'var(--surface-sunken)' : 'var(--accent)',
            color: busy ? 'var(--text-muted)' : 'var(--on-accent)',
            padding: '6px 12px', borderRadius: 'var(--radius-sm)', cursor: 'default',
            fontSize: 'var(--fs-sm)', fontWeight: 500, fontFamily: 'inherit',
          }}
        >
          {busy ? 'Собираю…' : 'Собрать'}
        </button>
      )}
    </Tile>
  );
}

// ── Загрузки ──────────────────────────────────────────────────────────────────
//
// ⚠️ Виджет только ПОКАЗЫВАЕТ. Управление (пауза, отмена, открыть) осталось в поповере у кнопки
// тулбара и в разделе: третья копия той логики разошлась бы с двумя первыми при первой же
// правке. А «идёт ли что-то прямо сейчас» — вопрос, на который стол отвечает уместно.
export function DownloadsWidget({ box, fill }: WidgetProps) {
  const [items, setItems] = useState<{ id: string; name: string; done: boolean; pct: number }[]>([]);

  useEffect(() => window.oblako.onDownloadsChanged((list) => {
    setItems(list.slice(0, 4).map((d) => ({
      id: d.id,
      name: d.filename,
      done: d.state !== 'progressing',
      pct: d.totalBytes > 0 ? Math.round(d.receivedBytes / d.totalBytes * 100) : 0,
    })));
  }), []);

  const active = items.filter((i) => !i.done).length;
  const shown = items.slice(0, box.height > 150 ? 4 : 2);

  return (
    <Tile surface fill={fill}>
      <TileCaption>Загрузки</TileCaption>
      {items.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: 'var(--fs-sm)', opacity: 0.6 }}>
          Ничего не скачивалось
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
          {shown.map((it) => (
            <div key={it.id} style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 'var(--fs-xs)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: it.done ? 0.6 : 1,
              }}>{it.name}</div>
              {!it.done && (
                <div style={{ height: 3, borderRadius: 99, background: 'rgba(128,128,128,0.25)', marginTop: 3 }}>
                  <div style={{
                    width: `${it.pct}%`, height: '100%', borderRadius: 99,
                    background: 'var(--accent)', transition: 'width var(--dur-slow) linear',
                  }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ flex: 'none', fontSize: 'var(--fs-xs)', opacity: 0.7 }}>
        {active > 0 ? `${active} идёт` : items.length > 0 ? 'всё завершено' : ''}
      </div>
    </Tile>
  );
}

// ── Отслеживание товаров ──────────────────────────────────────────────────────
//
// Показывает то, ради чего отслеживание и заводят: сколько товаров под наблюдением и что с ними
// происходит. ⚠️ Плитка ТЕМЫ (surface), а не цветная: цвет тут значил бы направление цены, а на
// плитке товаров сразу несколько и разнонаправленных — красить её целиком было бы враньём.
export function TrackingWidget({ box, fill }: WidgetProps) {
  const [items, setItems] = useState<TrackedProduct[]>([]);

  const load = () => { void window.oblako.listTracked().then(setItems); };
  useEffect(() => { load(); }, []);
  useEffect(() => window.oblako.onTrackingChanged(load), []);

  // ⚠️ Считаем по ГРУППАМ, а не по записям: один товар в трёх магазинах — это один товар, и
  // «отслеживается 3» было бы неправдой (та же единица счёта, что на экране отслеживания).
  const groups = new Map<string, TrackedProduct[]>();
  for (const it of items) {
    const key = it.groupId > 0 ? `g${it.groupId}` : `i${it.id}`;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }

  // Самое интересное — то, что подешевело сильнее всех с момента добавления. Это факт из наших
  // наблюдений, а не совет: виджет ничего не советует покупать.
  let bestTitle = '';
  let bestDrop = 0;
  let bestNow = 0;
  let currency = 'RUB';
  for (const offers of groups.values()) {
    for (const o of offers) {
      const first = o.points[0]?.price ?? 0;
      const last = o.points[o.points.length - 1]?.price ?? 0;
      if (!first || !last) continue;
      const drop = first - last;
      if (drop > bestDrop) { bestDrop = drop; bestTitle = o.title; bestNow = last; currency = o.currency; }
    }
  }

  const money = (v: number) => `${Math.round(v).toLocaleString('ru-RU')} ${currency === 'RUB' ? '₽' : currency}`;
  const tight = box.height < 120;

  return (
    <Tile surface fill={fill}>
      <TileCaption>Отслеживание</TileCaption>
      {groups.size === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: 'var(--fs-sm)', opacity: 0.6 }}>
          Ничего не отслеживается
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
          <div style={{ fontSize: tight ? 'var(--fs-lg)' : 'var(--fs-xl)', fontWeight: 700, lineHeight: 1.1 }}>
            {groups.size}
          </div>
          {!tight && bestDrop > 0 && (
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 'var(--fs-xs)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.8,
              }}>{bestTitle}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--tone-green)' }}>
                −{money(bestDrop)} · сейчас {money(bestNow)}
              </div>
            </div>
          )}
        </div>
      )}
      <div style={{ flex: 'none', fontSize: 'var(--fs-xs)', opacity: 0.7 }}>
        {groups.size === 0 ? '' : bestDrop > 0 ? 'подешевело с добавления' : 'товаров под наблюдением'}
      </div>
    </Tile>
  );
}

// ── Праздники ─────────────────────────────────────────────────────────────────
//
// ⚠️ Единственный виджет в этом файле, который ХОДИТ В СЕТЬ, и живёт он здесь по соседству
// сознательно — чтобы разница была видна прямо в коде. Получатель новый (date.nager.at), но
// footprint крошечный: один запрос на год, и наружу уходит только код страны — ни координат,
// ни адресов, ни чего-либо о человеке. Кэш в main держит год целиком, поэтому за сеанс запрос
// уходит максимум один раз.
export function HolidayWidget({ box, fill }: WidgetProps) {
  const [data, setData] = useState<{ name: string; days: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.oblako.getNextHoliday('RU').then((r) => {
      if (!alive) return;
      if (!r.ok || !r.name || r.daysUntil === undefined) { setFailed(true); return; }
      setData({ name: r.name, days: r.daysUntil });
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  const big = Math.round(Math.min(box.height * 0.32, 52));

  return (
    <Tile surface fill={fill}>
      <TileCaption>Ближайший праздник</TileCaption>
      {failed || !data ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: 'var(--fs-sm)', opacity: 0.6 }}>
          {failed ? 'Не удалось узнать' : '…'}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: big, fontWeight: 600, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
            {data.days === 0 ? 'Сегодня' : data.days}
          </div>
          {data.days > 0 && (
            <div style={{ fontSize: 'var(--fs-xs)', opacity: 0.7, marginTop: 2 }}>{dayWord(data.days)}</div>
          )}
        </div>
      )}
      {data && (
        <div style={{
          flex: 'none', fontSize: 'var(--fs-sm)', fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{data.name}</div>
      )}
    </Tile>
  );
}

// «1 день», «2 дня», «5 дней» — без этого плитка писала бы «5 день». Правило русского счёта:
// 11-14 всегда «дней», дальше по последней цифре.
function dayWord(n: number): string {
  const last2 = n % 100;
  const last = n % 10;
  if (last2 >= 11 && last2 <= 14) return 'дней';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
}
