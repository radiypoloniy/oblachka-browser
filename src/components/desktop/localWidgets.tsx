import { useEffect, useState } from 'react';
import { DISPLAY, RADIUS } from '../../styles/system';
import { Tile, TileCaption, Sparkline, TONE_GREEN, TONE_WARM, FILL_GREEN, FILL_WARM, type WidgetProps } from './widgets';
import { CalendarFace, TimerLayout } from './clockFaces';
import { TIMER_PRESETS, timerLeftMs, timerRunning } from '../../newtab/timerStore';
import type { TimerState } from '../../../shared/ipc';
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

export function MoonWidget({ box, fill, overImage, hero: isHero }: WidgetProps) {
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
    <Tile surface toned overImage={overImage} hero={isHero} fill={fill}>
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
export function ShieldWidget({ box, fill, overImage, hero: isHero }: WidgetProps) {
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
      <Tile surface toned overImage={overImage} hero={isHero} fill={fill} padding={12}>
        {/* Заголовок остаётся и здесь: без него «0» рядом с двумя точками не отвечает, чего
            именно ноль. А вот подпись «заблокировано за сеанс» в эту высоту уже не влезает —
            она ушла в подсказку курсором на самом числе. */}
        <TileCaption>Защита</TileCaption>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minHeight: 0, minWidth: 0 }}>
          <div title="Заблокировано за сеанс" style={{
            ...DISPLAY, fontSize: Math.round(big * (isHero ? 1.28 : 1)), fontWeight: isHero ? 700 : 600,
            lineHeight: 1, flex: 'none',
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
    <Tile surface toned overImage={overImage} hero={isHero} fill={fill}>
      <TileCaption>Защита</TileCaption>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ ...DISPLAY, fontSize: Math.round(big * (isHero ? 1.28 : 1)), fontWeight: isHero ? 700 : 600, lineHeight: 1.05 }}>
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
export function DigestWidget({ box, fill, overImage, hero: isHero }: WidgetProps) {
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
  // Высота строки стала меньше (13px/1.35 + поля), поэтому и ёмкость считается по ней.
  const capacity = Math.max(1, Math.floor((box.height - 96) / 26));
  const builtAt = state?.state === 'ready' ? new Date(state.digest.builtAt) : null;

  return (
    <Tile surface toned overImage={overImage} hero={isHero} fill={fill}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, flex: 'none' }}>
        <TileCaption>Чем занимался</TileCaption>
        {builtAt && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {builtAt.getHours()}:{String(builtAt.getMinutes()).padStart(2, '0')}
          </span>
        )}
      </div>

      {/* ⚠️ Список без маркеров и с волосяными разделителями, а не буллиты. Точки перед строками
          читались как черновик заметки и выбивали виджет из общего языка: у всех соседей число
          и подпись, а тут абзац текста (живая жалоба «чем занимался не очень вписывается»).
          Сверху добавлено ключевое число — сколько тем набралось: так плитка отвечает на вопрос
          одним взглядом, как и остальные, а список остаётся расшифровкой. */}
      {lines.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flex: 'none', marginTop: 2 }}>
          <span style={{ ...DISPLAY, fontSize: isHero ? 34 : 26, fontWeight: isHero ? 700 : 600 }}>
            {lines.length}
          </span>
          <span style={{ fontSize: 'var(--fs-xs)', opacity: 0.7 }}>
            {lines.length === 1 ? 'тема за день' : lines.length < 5 ? 'темы за день' : 'тем за день'}
          </span>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', marginTop: 8, display: 'flex', flexDirection: 'column' }}>
        {lines.slice(0, capacity).map((line, i) => (
          <div key={i} style={{
            fontSize: 'var(--fs-xs)', lineHeight: 1.35, padding: '5px 0',
            borderTop: i === 0 ? 'none' : '1px solid color-mix(in srgb, currentColor 12%, transparent)',
            minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{line}</div>
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
export function DownloadsWidget({ box, fill, overImage, hero: isHero }: WidgetProps) {
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
    <Tile surface toned overImage={overImage} hero={isHero} fill={fill}>
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
                <div style={{ height: 3, borderRadius: RADIUS.pill, background: 'rgba(128,128,128,0.25)', marginTop: 3 }}>
                  <div style={{
                    width: `${it.pct}%`, height: '100%', borderRadius: RADIUS.pill,
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
// ⚠️ Герой плитки — ТОВАР, а не счётчик. Первая версия показывала крупную цифру «2» и подпись
// «товаров под наблюдением»: на столе, где рядом стоит плотный виджет погоды, это выглядело
// пусто и не сообщало ничего — число само по себе не ответ ни на один вопрос. Человека
// интересует «что там с моими товарами», то есть конкретная цена и куда она двинулась.
//
// ⚠️ Плитка ТЕМЫ (surface), а не цветная: товаров несколько и цены разнонаправленные, красить
// её целиком было бы враньём. Цвет несёт только строка изменения — там направление одно и известно.
// ⚠️ hero переименован в isHero: внутри этого виджета уже есть своё «hero» — товар с самым
// заметным движением цены. Одинаковые имена для высоты плитки и для главного товара путали бы
// в первую очередь читателя, а не компилятор.
export function TrackingWidget({ box, fill, onActivate, overImage, hero: isHero }: WidgetProps) {
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

  // Герой — тот, чья цена сильнее всего сдвинулась с добавления (в любую сторону: подорожание
  // человеку тоже новость). Если не двигалась ни одна — самый дешёвый из отслеживаемых: показать
  // хоть что-то живое лучше, чем пустую плитку.
  let hero: TrackedProduct | null = null;
  let heroMove = -1;
  for (const offers of groups.values()) {
    // Внутри группы берём предложение с лучшей ценой — к нему человек и пойдёт.
    const best = [...offers].sort((a, b) => (a.points[a.points.length - 1]?.price ?? Infinity)
                                          - (b.points[b.points.length - 1]?.price ?? Infinity))[0];
    if (!best) continue;
    const first = best.points[0]?.price ?? 0;
    const last = best.points[best.points.length - 1]?.price ?? 0;
    if (!last) continue;
    const move = first ? Math.abs(last - first) : 0;
    if (move > heroMove) { heroMove = move; hero = best; }
  }

  const money = (v: number, cur: string) => `${Math.round(v).toLocaleString('ru-RU')} ${cur === 'RUB' || !cur ? '₽' : cur}`;

  if (groups.size === 0 || !hero) {
    return (
      <Tile surface toned overImage={overImage} hero={isHero} fill={fill} onActivate={onActivate}>
        <TileCaption>Отслеживание</TileCaption>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: 'var(--fs-sm)', opacity: 0.6 }}>
          Ничего не отслеживается
        </div>
        <div style={{ flex: 'none', fontSize: 'var(--fs-xs)', opacity: 0.7 }}>
          Значок в адресной строке на карточке товара
        </div>
      </Tile>
    );
  }

  const prices = hero.points.map((p) => p.price);
  const first = prices[0] ?? 0;
  const last = prices[prices.length - 1] ?? 0;
  const diff = first ? last - first : 0;
  const down = diff < 0;
  // Тесная плитка (2×1): график и название не помещаются, остаётся цена с изменением.
  const tight = box.height < 120;
  const others = groups.size - 1;

  return (
    <Tile surface toned overImage={overImage} hero={isHero} fill={fill} onActivate={onActivate}>
      <TileCaption>Отслеживание</TileCaption>

      <div style={{ flex: 'none', display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ ...DISPLAY, fontSize: tight ? 18 : 22, fontWeight: isHero ? 700 : 600, lineHeight: 1.05 }}>
          {money(last, hero.currency)}
        </span>
        {diff !== 0 && (
          <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: down ? 'var(--tone-green)' : 'var(--tone-warm)' }}>
            {down ? '−' : '+'}{money(Math.abs(diff), hero.currency)}
          </span>
        )}
      </div>

      {!tight && (
        <div style={{
          flex: 'none', marginTop: 2, fontSize: 'var(--fs-xs)', opacity: 0.8, lineHeight: 1.25,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{hero.title}</div>
      )}

      {/* График — тот же Sparkline, что у курса и крипты: у отслеживания нет причин рисовать
          свою кривую. Направление задаёт цвет, как у крипты (рост цены товара — плохо). */}
      {!tight && prices.length >= 2 && (
        <Sparkline
          values={prices}
          height={Math.max(24, Math.min(46, box.height - 128))}
          color={down ? TONE_GREEN : TONE_WARM}
          fill={down ? FILL_GREEN : FILL_WARM}
        />
      )}

      <div style={{ flex: 1 }} />
      <div style={{ flex: 'none', fontSize: 'var(--fs-xs)', opacity: 0.7 }}>
        {hero.host}{others > 0 ? ` · ещё ${others} ${others === 1 ? 'товар' : 'товара'}` : ''}
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
export function HolidayWidget({ box, fill, overImage, hero: isHero }: WidgetProps) {
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
    <Tile surface toned overImage={overImage} hero={isHero} fill={fill}>
      <TileCaption>Ближайший праздник</TileCaption>
      {failed || !data ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', fontSize: 'var(--fs-sm)', opacity: 0.6 }}>
          {failed ? 'Не удалось узнать' : '…'}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ ...DISPLAY, fontSize: Math.round(big * (isHero ? 1.28 : 1)), fontWeight: isHero ? 700 : 600, lineHeight: 1.05 }}>
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

// ── Календарь месяца ──────────────────────────────────────────────────────────
//
// ⚠️ Отдельный виджет, а не «часы с сеткой дней». Прежний плакат месяца пытался быть сразу
// календарём и часами, и время в нём проигрывало вниманием сетке — на плитке помещается ровно
// один герой. Часы рядом свои, и это честнее: их и календарь ставят по разным причинам.
//
// ⚠️ Плитка СТЕКЛЯННАЯ (см. Tile.glass): внутри крупная типографика и тонкая сетка, и на плотной
// заливке лист читается как наклейка поверх стола, а не как его часть.
export function CalendarWidget({ fill, overImage, hero }: WidgetProps) {
  const [now, setNow] = useState(() => new Date());
  // Раз в минуту: календарю секунды не нужны вовсе, но полночь он обязан пережить сам — иначе
  // «сегодня» останется на вчерашнем числе до перезагрузки вкладки.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <Tile surface glass overImage={overImage} hero={hero} fill={fill} padding={0}>
      <CalendarFace now={now} />
    </Tile>
  );
}

// ── Таймер ────────────────────────────────────────────────────────────────────
//
// ⚠️ Состояние держит MAIN (electron/TimerService.ts), а виджет только показывает. Раньше
// счётчик жил здесь целиком, то есть досчитывал лишь пока открыта новая вкладка: ушёл на сайт —
// сработать некому. Таймер, который молчит, когда человек занят другим, бесполезен ровно в том
// случае, ради которого его и заводят.
//
// ⚠️ Тик раз в секунду остаётся ЗДЕСЬ, и это не дублирование: main знает МОМЕНТ срабатывания и
// не просыпается до него вовсе, а рисовать убывающие цифры всё равно кому-то надо.
export function TimerWidget({ box, fill, overImage, hero }: WidgetProps) {
  const [state, setState] = useState<TimerState | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    void window.oblako.getTimer().then(setState).catch(() => { /* останется пусто */ });
    return window.oblako.onTimerChanged(setState);
  }, []);

  const running = state ? timerRunning(state) : false;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  // ⚠️ Пока состояние не пришло, плитка рисуется по умолчанию, а не пустой: главный процесс
  // отвечает за миллисекунды, и мигать заглушкой на каждом открытии вкладки незачем.
  const cur: TimerState = state ?? { durationMs: TIMER_PRESETS[1]!.ms, endAt: 0, leftMs: TIMER_PRESETS[1]!.ms };
  const left = timerLeftMs(cur);
  const apply = (next: Partial<TimerState>): void => {
    void window.oblako.setTimer(next).then(setState).catch(() => { /* main ответит рассылкой */ });
  };

  const mm = Math.floor(left / 60_000);
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, '0');
  const progress = cur.durationMs > 0 ? 1 - left / cur.durationMs : 0;
  const presetId = TIMER_PRESETS.find((p) => p.ms === cur.durationMs)?.id ?? '';

  return (
    <Tile surface glass overImage={overImage} hero={hero} fill={fill} padding={0}>
      <TimerLayout
        w={box.width}
        h={box.height}
        title="таймер"
        leftLabel={`${mm}:${ss}`}
        running={running}
        progress={progress}
        presets={TIMER_PRESETS.map(({ id, label }) => ({ id, label }))}
        preset={presetId}
        // ⚠️ Выбор длительности СРАЗУ ЗАПУСКАЕТ отсчёт. Отдельная кнопка «старт» после выбора —
        // лишнее движение: человек нажимает «20», потому что хочет двадцать минут прямо сейчас.
        onPreset={(id) => {
          const ms = TIMER_PRESETS.find((p) => p.id === id)?.ms ?? cur.durationMs;
          apply({ durationMs: ms, endAt: Date.now() + ms, leftMs: 0 });
        }}
        onToggle={() => {
          if (running) apply({ durationMs: cur.durationMs, endAt: 0, leftMs: left });
          else apply({ durationMs: cur.durationMs, endAt: Date.now() + Math.max(left, 1000), leftMs: 0 });
        }}
        onStop={() => apply({ durationMs: cur.durationMs, endAt: 0, leftMs: cur.durationMs })}
      />
    </Tile>
  );
}
