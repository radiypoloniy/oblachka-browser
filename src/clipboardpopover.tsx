import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Clipboard, Copy, Check, Trash2, X, ChevronDown, ChevronRight, CornerUpRight, Link2, Pin, PinOff } from 'lucide-react';
import type { ClipboardEntry, ClipboardRevealResult } from '../shared/ipc';
// ⚠️ Поверхность оверлея (непрозрачная), а не островная плита: карточка живёт в своей вью над
// страницей, где backdrop-filter не работает вовсе, и полупрозрачность означала бы
// просвечивающий текст сайта. Разбор — у --overlay-plate в styles/tokens/colors.css.
import { overlayPlate } from './styles/island';
import SiteFavicon from './components/SiteFavicon';
import './styles/global.css';
import { installOverlayReveal } from './overlayReveal';
import { OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics';
import { CAPS, DISPLAY_ROW, RADIUS, TEXT, sp } from './styles/system';
import { latestCopy } from '../shared/clipboardOrder';

// Поповер буфера скопированного со страниц.
//
// ⚠️ Список сгруппирован ПО САЙТАМ, а не идёт сплошняком по времени. Человек помнит не «третье
// сверху», а «я это копировал на Хабре» — сайт и есть та зацепка, по которой запись находят.
//
// ⚠️ Показываем ОБРЕЗАННЫЙ текст: скопированное бывает длинным (абзац, таблица), и сплошная
// простыня превращает список в нечитаемое полотно. Раскрыть можно, но это отдельное действие —
// как и скопировать, для которого раскрывать не требуется вовсе.
//
// ⚠️ Сайт в заголовке группы — ЗНАЧОК И КРУПНОЕ ИМЯ, а не серая подпись мелким кеглем. Группировка
// по сайтам и есть главная зацепка списка («я это копировал на Хабре»), а оформленная как служебная
// пометка, она читалась последней — глаз шёл по одинаковым абзацам текста, ничем не разделённым.

declare global {
  interface Window {
    clipboardPopover: {
      list: () => Promise<ClipboardEntry[]>;
      put: (id: number) => Promise<void>;
      putLink: (id: number, url: string) => Promise<void>;
      openSource: (id: number) => Promise<ClipboardRevealResult>;
      favicon: (host: string) => Promise<string | null>;
      pin: (id: number, on: boolean) => Promise<boolean>;
      remove: (id: number) => Promise<void>;
      clear: () => Promise<void>;
      getEnabled: () => Promise<boolean>;
      setEnabled: (on: boolean) => Promise<void>;
      close: () => void;
      reportHeight: (px: number) => void;
      onShow: (cb: () => void) => () => void;
    };
  }
}


const CARD_WIDTH = 380;
// Сколько строк текста видно в свёрнутом виде.
const PREVIEW_LINES = 2;

function timeAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин`;
  const hours = Math.round(mins / 60);
  return `${hours} ч`;
}

function ClipboardPopoverApp() {
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  const [enabled, setEnabled] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);

  const reload = () => { void window.clipboardPopover.list().then(setEntries); };
  useEffect(() => window.clipboardPopover.onShow(reload), []);
  useEffect(() => { reload(); void window.clipboardPopover.getEnabled().then(setEnabled); }, []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => window.clipboardPopover.reportHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [entries.length]);

  // Группировка по сайту с сохранением порядка «свежие сверху»: первая встреча сайта задаёт его
  // место в списке. Адрес первой записи держим ради значка: FaviconService берёт иконку по хосту,
  // а хост у группы один на все записи.
  // ⚠️ Закреплённое идёт СВОЕЙ секцией сверху, а не первым внутри группы своего сайта. Смысл
  // закрепления — «эта запись всегда на виду», а группировка по сайту его бы размыла: закреплённое
  // осталось бы перемешанным со свежими копиями того же сайта.
  // ⚠️ Самая свежая запись поднимается ГЕРОЕМ и ниже больше не показывается. «Взять только что
  // скопированное» — главный сценарий поповера, а до этого последняя запись ничем не отличалась
  // от предпоследней: человек искал её глазами среди одинаковых абзацев.
  // ⚠️ НЕ entries[0]. orderCopies ставит первым ЗАКРЕПЛЁННОЕ, и «просто первый элемент» оказывался
  // закреплённой записью: она показывалась под подписью «последнее» и пропадала из своего раздела.
  // Правило и случаи — в shared/clipboardOrder.ts под scripts/clipboard-order-check.mjs.
  const hero = latestCopy(entries);
  const pinned = entries.filter((e) => e.pinned);
  const groups: { host: string; url: string; items: ClipboardEntry[] }[] = [];
  for (const e of entries) {
    if (e.pinned || e.id === hero?.id) continue;
    const host = e.host || 'без адреса';
    const g = groups.find((x) => x.host === host);
    if (g) g.items.push(e);
    else groups.push({ host, url: e.url, items: [e] });
  }

  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div ref={cardRef} style={{
        width: CARD_WIDTH, ...overlayPlate,
        borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-overlay)',
        // ⚠️ Своего фона тут БЫТЬ НЕ ДОЛЖНО: он перебивал overlayPlate выше и возвращал
        // полупрозрачный материал, из-за чего буфер остался единственным просвечивающим поповером
        // после общей правки. Причём shorthand `background` сбрасывал заодно и зерно
        // (оно приходит через backgroundImage) — то есть карточка теряла и плотность, и фактуру.
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 10px 10px 14px', borderBottom: '1px solid var(--divider)',
        }}>
          <Clipboard size={14} style={{ color: 'var(--text-faint)', flex: 'none' }} />
          <span style={{ ...CAPS, flex: 1 }}>Скопировано со страниц</span>
          {/* ⚠️ Кнопка называет то, что делает: закреплённое она НЕ трогает (см. clearCopies).
              И появляется только когда есть что убирать — при списке из одних закреплённых она
              была бы кнопкой без действия. Стереть вообще всё, включая закреплённое, умеет
              выключатель ниже: там обещание другое — «не веди историю». */}
          {entries.some((e) => !e.pinned) && (
            <button
              title={entries.some((e) => e.pinned) ? 'Очистить незакреплённое' : 'Очистить всё'}
              onClick={() => { void window.clipboardPopover.clear().then(reload); }}
              style={iconBtn}
            ><Trash2 size={13} /></button>
          )}
          <button title="Закрыть" onClick={() => window.clipboardPopover.close()} style={iconBtn}><X size={13} /></button>
        </div>

        {hero && <HeroCopy entry={hero} onChanged={reload} />}

        <div style={{ maxHeight: 420, overflow: 'auto', padding: 6 }}>
          {entries.length === 0 && (
            <div style={{ padding: '22px 12px', textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
              {enabled
                ? 'Скопируйте что-нибудь на странице — попадёт сюда'
                : 'История копирования выключена'}
            </div>
          )}
          {pinned.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {/* Подпись говорит про перезапуск прямым текстом: это единственное место, где буфер
                  отступает от обещания «только на сеанс», и человек должен знать об этом там же,
                  где закрепляет, а не в настройках. */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '8px 8px 5px',
              }}>
                <Pin size={14} style={{ color: 'var(--text-faint)', flex: 'none' }} />
                <span style={{
                  ...DISPLAY_ROW,
                }}>Закреплённое</span>
                <span style={{ ...TEXT.caption, color: 'var(--text-faint)', marginLeft: 'auto' }}>
                  переживает перезапуск
                </span>
              </div>
              {pinned.map((e) => <Row key={e.id} entry={e} onChanged={reload} />)}
            </div>
          )}
          {groups.map((g) => (
            <div key={g.host} style={{ marginBottom: 6 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '8px 8px 5px',
              }}>
                <SiteFavicon url={g.url} size={18} loadIcon={window.clipboardPopover.favicon} />
                {/* ⚠️ Имя сайта — ДИСПЛЕЙНОЙ: группировка по сайтам и есть главная зацепка списка
                    («я это копировал на Хабре»), и заголовок группы обязан читаться раньше самих
                    записей, а не наравне с ними. */}
                <span style={{
                  ...DISPLAY_ROW,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{g.host}</span>
              </div>
              {g.items.map((e) => <Row key={e.id} entry={e} onChanged={reload} />)}
            </div>
          ))}
        </div>

        {/* ⚠️ Выключатель прямо здесь, а не в настройках: человек вспоминает о слежке за
            копированием ровно в тот момент, когда видит список. Выключение стирает собранное. */}
        {/* ⚠️ ТУМБЛЕР, а не кнопка с формулировкой. Раньше строка называлась «Не вести историю
            копирования», то есть состояние читалось ТОЛЬКО из отрицания: чтобы понять, ведём ли
            мы её сейчас, надо было мысленно перевернуть надпись. Это было единственное двойное
            отрицание в продукте. Теперь подпись называет предмет, а положение говорит состояние. */}
        <button
          role="switch"
          aria-checked={enabled}
          onClick={() => {
            const next = !enabled;
            setEnabled(next);
            void window.clipboardPopover.setEnabled(next).then(reload);
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: sp(2), padding: `${sp(2)}px ${sp(4)}px`,
            border: 'none', borderTop: '1px solid var(--divider)', background: 'transparent',
            cursor: 'default', textAlign: 'left', width: '100%',
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', ...TEXT.body, fontWeight: 550, color: 'var(--text-strong)' }}>
              История копирования
            </span>
            <span style={{ display: 'block', ...TEXT.caption, color: 'var(--text-muted)' }}>
              {enabled ? 'Собирается на этот сеанс' : 'Выключена — собранное стёрто'}
            </span>
          </span>
          <span style={{
            position: 'relative', width: 38, height: 21, flex: 'none', borderRadius: RADIUS.pill,
            background: enabled ? 'var(--text-strong)' : 'var(--surface-sunken)',
            transition: 'background var(--dur-base) var(--ease-standard)',
          }}>
            <span style={{
              position: 'absolute', top: 3, left: 3, width: 15, height: 15, borderRadius: '50%',
              background: 'var(--app-bg)',
              transform: enabled ? 'translateX(17px)' : 'none',
              transition: 'transform var(--dur-base) var(--ease-out)',
            }} />
          </span>
        </button>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24, padding: 0, border: 'none', flex: 'none',
  borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-faint)', cursor: 'default',
};

// Домен для подписи ссылки — то же «без www», что у заголовков групп выше.
const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

// Самая свежая запись — герой карточки.
//
// ⚠️ Залита ЧЕРНИЛАМИ, а не тоном и не акцентом: это не «выбрано» и не статус, а «вот оно, бери».
// Чернила здесь законны по той же причине, что и в поповере замочка, — они контраст, а не цвет,
// а поповер лежит поверх чужого сайта, где плакатному тону места нет.
function HeroCopy({ entry, onChanged }: { entry: ClipboardEntry; onChanged: () => void }) {
  const [copied, setCopied] = useState(false);
  const take = () => {
    void window.clipboardPopover.put(entry.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
      onChanged();
    });
  };
  return (
    <div style={{ padding: `${sp(2)}px ${sp(3)}px ${sp(3)}px`, borderBottom: '1px solid var(--divider)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(2), padding: `0 ${sp(1)}px ${sp(1)}px` }}>
        <span style={{ ...CAPS, flex: 1 }}>
          последнее{entry.host ? ` · ${entry.host}` : ''}
        </span>
        <span style={{ ...TEXT.caption, color: 'var(--text-faint)' }}>{timeAgo(entry.at)}</span>
      </div>
      <button
        onClick={take}
        title="Скопировать снова"
        style={{
          display: 'flex', alignItems: 'flex-start', gap: sp(2), width: '100%', textAlign: 'left',
          padding: `${sp(2)}px ${sp(3)}px`, border: 'none', borderRadius: RADIUS.box, cursor: 'default',
          background: 'var(--text-strong)', color: 'var(--app-bg)',
          font: 'inherit',
        }}
      >
        <span style={{
          flex: 1, minWidth: 0, ...TEXT.body, color: 'inherit', lineHeight: 1.35,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{entry.text}</span>
        <span style={{ flex: 'none', opacity: 0.75, marginTop: 2 }}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </span>
      </button>
    </div>
  );
}

function Row({ entry, onChanged }: { entry: ClipboardEntry; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  // Полка закреплённого полна — показываем прямо в строке, где нажимали.
  const [pinFull, setPinFull] = useState(false);
  const links = entry.links ?? [];

  // ⚠️ Копирование НЕ требует раскрытия: чаще всего человек и так знает, что копировал, и лишний
  // шаг «раскрой, чтобы взять» превратил бы список в препятствие.
  const take = () => {
    void window.clipboardPopover.put(entry.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8,
        padding: '7px 8px', borderRadius: 'var(--radius-sm)',
        background: hovered ? 'var(--surface-hover)' : 'transparent',
      }}
    >
      <button title={open ? 'Свернуть' : 'Показать целиком'} onClick={() => setOpen((v) => !v)}
        style={{ ...iconBtn, width: 18, height: 18, marginTop: 1 }}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>

      <div onClick={take} style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--fs-sm)', color: 'var(--text-body)', lineHeight: 1.35,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          ...(open ? {} : {
            display: '-webkit-box', WebkitLineClamp: PREVIEW_LINES, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }),
        }}>{entry.text}</div>
        {/* ⚠️ Ссылки внутри копии — ОТДЕЛЬНАЯ строка, а не значок в подписи. Смысл записи меняется:
            «абзац текста» и «абзац текста, который ведёт вот сюда» — разные вещи, и вторую человек
            берёт из списка именно ради адреса. Свёрнуто показываем счётчик, раскрыто — сами
            адреса: в свёрнутом виде строка обязана оставаться в две строки текста. */}
        {links.length > 0 && !open && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3,
            fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
          }}>
            <Link2 size={11} />
            {links.length === 1 ? hostOf(links[0]!.url) : `ссылок: ${links.length}`}
          </div>
        )}
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
          {timeAgo(entry.at)}{entry.title ? ` · ${entry.title.slice(0, 40)}` : ''}
        </div>
        {pinFull && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
            Закреплённых уже максимум — открепите что-нибудь
          </div>
        )}
        {links.length > 0 && open && (
          <div
            onClick={(e) => e.stopPropagation()} // клик по строке копирует запись целиком — здесь это не то
            style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 }}
          >
            {links.map((l) => (
              <button
                key={l.url}
                title="Скопировать адрес"
                onClick={() => {
                  void window.clipboardPopover.putLink(entry.id, l.url).then(() => {
                    setCopiedLink(l.url);
                    setTimeout(() => setCopiedLink(null), 1200);
                  });
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, width: '100%',
                  padding: '3px 5px', border: 'none', borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface-sunken)', cursor: 'pointer', textAlign: 'left',
                  fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-sans)',
                  color: copiedLink === l.url ? 'var(--dot-local)' : 'var(--text-muted)',
                }}
              >
                {copiedLink === l.url ? <Check size={11} /> : <Link2 size={11} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.text || l.url}
                </span>
                <span style={{
                  marginLeft: 'auto', flex: 'none', color: 'var(--text-faint)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '45%',
                }}>{hostOf(l.url)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ⚠️ Закрепление видно ВСЕГДА у закреплённой записи, а не только под курсором, в отличие от
          соседних кнопок: это состояние записи, а не действие над ней. Погаснув вместе с остальными,
          оно оставило бы человека без единственного признака «эта переживёт перезапуск». */}
      <div style={{
        display: 'flex', gap: 2, flex: 'none',
        visibility: hovered || copied || entry.pinned ? 'visible' : 'hidden',
      }}>
        <button
          title={entry.pinned ? 'Открепить' : 'Закрепить — переживёт перезапуск'}
          onClick={() => {
            void window.clipboardPopover.pin(entry.id, !entry.pinned).then((ok) => {
              // false = полка полна. Молчать тут нельзя: человек уверен, что запись сохранена.
              if (!ok && !entry.pinned) setPinFull(true);
              setTimeout(() => setPinFull(false), 2000);
              onChanged();
            });
          }}
          style={{ ...iconBtn, color: entry.pinned ? 'var(--accent)' : 'var(--text-faint)' }}
        >
          {entry.pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
        {/* ⚠️ Переход к источнику — ОТДЕЛЬНАЯ кнопка, а не клик по строке: клик уже занят
            копированием, и это правильный порядок. За копией сюда приходят каждый раз, за
            «покажи, откуда это» — изредка, и подменять частое действие редким нельзя. */}
        {/^https?:\/\//i.test(entry.url) && (
          <button title="Открыть страницу и подсветить" onClick={() => { void window.clipboardPopover.openSource(entry.id); }}
            style={iconBtn}><CornerUpRight size={13} /></button>
        )}
        <button title="Скопировать" onClick={take} style={{ ...iconBtn, color: copied ? 'var(--dot-local)' : 'var(--text-faint)' }}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        <button title="Убрать из списка" onClick={() => { void window.clipboardPopover.remove(entry.id).then(onChanged); }}
          style={iconBtn}><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

installOverlayReveal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClipboardPopoverApp />
  </React.StrictMode>,
);
