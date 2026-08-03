import { useState } from 'react';
import type React from 'react';
import { X, Plus, Globe } from 'lucide-react';
import { APPS, AppIconBadge } from '../aiApps';
import { WIDGET_SIZES, type DesktopItem, type DesktopLayout, hasItem } from '../../newtab/desktop';

// Палитра добавления: виджеты, приложения и свои сайты.
//
// ⚠️ Уже стоящее на столе не предлагается повторно (см. hasItem): два одинаковых виджета
// погоды — не фича, а недосмотр, который человек потом молча удаляет. Сайты — исключение:
// их сколько угодно, они все разные.

// ⚠️ Кто из виджетов ходит В СЕТЬ и КУДА ИМЕННО. Именно поэтому их нет в стартовом наборе
// (см. defaultLayout в newtab/desktop.ts): стол открывается на каждой новой вкладке, и виджет
// по умолчанию означал бы, что браузер сам, без единого действия человека, регулярно
// отчитывается стороннему сервису — а погода вдобавок сообщает город.
// Имя сервиса названо прямо: общая фраза «данные могут передаваться» — это шум, который
// прокликивают не читая, и от неё нет никакой пользы ни человеку, ни нам.
const NETWORK_WIDGETS: Record<string, string> = {
  weather: 'Open-Meteo',
  rates: 'ЦБ РФ',
  crypto: 'CoinGecko',
};

const WIDGET_CHOICES: { key: string; label: string; hint: string; size: keyof typeof WIDGET_SIZES }[] = [
  { key: 'weather',  label: 'Погода',           hint: 'Прогноз на ближайшие часы', size: 'medium' },
  { key: 'clock',    label: 'Часы',             hint: 'Время и дата',              size: 'small' },
  { key: 'rates',    label: 'Курс валют',       hint: 'ЦБ РФ и график за месяц',   size: 'small' },
  { key: 'crypto',   label: 'Крипта',           hint: 'Цены в рублях и за 24 часа', size: 'small' },
  { key: 'tasks',    label: 'Дела',             hint: 'Список с галочками',        size: 'medium' },
  { key: 'topsites', label: 'Часто открываете', hint: 'Сайты из вашей истории',    size: 'medium' },
  // Ниже — те, что не ходят в сеть вовсе (см. localWidgets.tsx): в подписи это сказано прямо,
  // потому что рядом стоят виджеты с предупреждением, и разница между ними — главное, что
  // человеку стоит знать при выборе.
  { key: 'shield',   label: 'Защита',           hint: 'Адблок и VPN · без сети',    size: 'small' },
  { key: 'moon',     label: 'Луна',             hint: 'Фаза по дате · без сети',    size: 'small' },
  { key: 'downloads', label: 'Загрузки',        hint: 'Что качается · без сети',    size: 'medium' },
  { key: 'holiday',  label: 'Праздники',        hint: 'Сколько до ближайшего',      size: 'small' },
];

interface Props {
  layout: DesktopLayout;
  onAdd: (item: Omit<DesktopItem, 'id'>) => void;
  onClose: () => void;
}

export default function AddSheet({ layout, onAdd, onClose }: Props) {
  const [siteUrl, setSiteUrl] = useState('');
  const [siteName, setSiteName] = useState('');

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
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720, maxHeight: '82%', overflowY: 'auto',
          background: 'var(--surface-solid)', borderRadius: 'var(--radius-island)',
          boxShadow: 'var(--shadow-island)', padding: 20,
          display: 'flex', flexDirection: 'column', gap: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1, fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-strong)' }}>
            Добавить на экран
          </span>
          <button onClick={onClose} title="Закрыть" style={iconBtn}><X size={16} /></button>
        </div>

        <Group title="Виджеты">
          {WIDGET_CHOICES.filter((w) => !hasItem(layout, 'widget', w.key)).map((w) => (
            <Row
              key={w.key}
              title={w.label}
              // ⚠️ Про сеть сказано ЗДЕСЬ и с ИМЕНЕМ сервиса, а не общей фразой «данные могут
              // передаваться» — такую прокликивают не читая. Момент выбран тот же: человек
              // решает, ставить ли виджет, и ровно в этот момент узнаёт цену.
              hint={NETWORK_WIDGETS[w.key] ? `${w.hint} · Запрашивает данные у ${NETWORK_WIDGETS[w.key]}` : w.hint}
              warn={!!NETWORK_WIDGETS[w.key]}
              onAdd={() => onAdd({ kind: 'widget', widget: w.key, size: WIDGET_SIZES[w.size] })}
              badge={<span style={{
                width: 40, height: 40, borderRadius: 10, flex: 'none',
                background: 'var(--surface-sunken)', display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 18,
              }}>{w.key === 'weather' ? '🌤' : w.key === 'clock' ? '🕒' : w.key === 'rates' ? '₽' : w.key === 'crypto' ? '₿' : w.key === 'tasks' ? '✓' : w.key === 'shield' ? '🛡' : w.key === 'moon' ? '🌙' : w.key === 'downloads' ? '⤓' : w.key === 'holiday' ? '🎉' : '★'}</span>}
            />
          ))}
          {WIDGET_CHOICES.every((w) => hasItem(layout, 'widget', w.key)) && <Empty>Все виджеты уже на экране.</Empty>}
        </Group>

        <Group title="Приложения">
          {APPS.filter((a) => !hasItem(layout, 'app', a.id)).map((a) => (
            <Row
              key={a.id}
              title={a.label}
              hint={a.kind === 'web' ? 'Сайт в панели' : 'Встроенное приложение'}
              onAdd={() => onAdd({ kind: 'app', appId: a.id, size: { w: 1, h: 1 } })}
              badge={<AppIconBadge app={a} size={40} iconSize={22} shadow />}
            />
          ))}
          {APPS.every((a) => hasItem(layout, 'app', a.id)) && <Empty>Все приложения уже на экране.</Empty>}
        </Group>

        <Group title="Сайт">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none',
                padding: '0 16px', height: 38, borderRadius: 'var(--radius-pill)',
                border: 'none', cursor: 'default', background: 'var(--accent)', color: 'var(--on-accent)',
                fontSize: 'var(--fs-sm)', fontWeight: 500,
              }}
            ><Globe size={15} /> Добавить</button>
          </div>
        </Group>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{
        fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
        textTransform: 'uppercase', color: 'var(--text-faint)',
      }}>{title}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </div>
  );
}

function Row({ title, hint, badge, onAdd, warn }: {
  title: string; hint: string; badge: React.ReactNode; onAdd: () => void;
  /** Виджет ходит в сеть — подпись подсвечена, чтобы её увидели, а не только прочитали. */
  warn?: boolean;
}) {
  return (
    <button
      onClick={onAdd}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
        padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: 'none',
        background: 'transparent', cursor: 'default',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {badge}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 'var(--fs-xs)', color: warn ? 'var(--warning-500)' : 'var(--text-faint)' }}>{hint}</span>
      </span>
      <Plus size={16} style={{ color: 'var(--text-faint)', flex: 'none' }} />
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>{children}</span>;
}

const iconBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'default', padding: 6,
  borderRadius: 'var(--radius-sm)', color: 'var(--text-faint)', display: 'inline-flex',
};

const field: React.CSSProperties = {
  height: 38, padding: '0 12px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--divider-strong)', background: 'var(--surface-sunken)',
  color: 'var(--text-body)', fontSize: 'var(--fs-sm)', outline: 'none', minWidth: 0,
};
