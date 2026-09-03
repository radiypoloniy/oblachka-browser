import { useEffect, useState } from 'react';
import { Plug } from 'lucide-react';
import type { McpCallLog, McpServerState } from '../../shared/ipc';
import {
  FactGrid, GroupCap, Row, Rows, SideNav, SplitView, type LibrarySummary,
} from './library/kit';
import { RADIUS, TEXT, motion, pad, sp } from '../styles/system';

// Раздел «Агенты» — что внешние программы делали с браузером и что им позволено.
//
// ⚠️ ЭТО ПЕРЕЕЗД ИЗ НАСТРОЕК, и он по делу. Сначала список подключённых программ, их права по
// каждому инструменту и журнал обращений жили в блоке настроек — и раздували его до экрана,
// который надо листать. Настройки отвечают на вопрос «включено ли и как подключиться»; «кто
// приходил и что делал» — это библиотека, ровно как история, загрузки и отслеживание.
//
// ⚠️ Раздел живёт в том же острове, что история: рельса вверху, сводка числами, список строками.
// Своего вида не заводим — иначе четвёртый раздел библиотеки выглядел бы гостем в ней.

const STANCE_LABEL: Record<string, string> = {
  ask: 'Спрашивать',
  allow: 'Можно',
  deny: 'Никогда',
};

export default function Agents({ query, onSummary }: {
  query: string;
  onSummary: (s: LibrarySummary) => void;
}) {
  const [state, setState] = useState<McpServerState | null>(null);
  const [calls, setCalls] = useState<McpCallLog[]>([]);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = () => {
      void window.oblako.getMcpState().then((s) => { if (alive) setState(s); });
      void window.oblako.getMcpCalls().then((c) => { if (alive) setCalls(c); });
    };
    pull();
    // Обращения приходят пушем, но пока раздел открыт, обновляем и по времени: «последнее
    // обращение 3 мин назад» иначе застывает.
    const off = window.oblako.onMcpActivity(() => pull());
    const timer = setInterval(pull, 5000);
    return () => { alive = false; off(); clearInterval(timer); };
  }, []);

  const clients = state?.clients ?? [];
  const shown = calls.filter((c) => {
    if (picked && c.client.toLowerCase() !== picked) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return c.client.toLowerCase().includes(q) || c.tool.toLowerCase().includes(q);
  });

  // ⚠️ Сводка считается ЗДЕСЬ, из уже загруженного: раздел знает свои числа, оболочка — нет.
  useEffect(() => {
    onSummary({
      hero: state?.enabled ? String(clients.length) : '—',
      heroLabel: state?.enabled
        ? (clients.length === 1 ? 'программа подключена' : 'программ подключено')
        : 'сервер выключен',
    });
  }, [onSummary, state?.enabled, clients.length]);

  if (state && !state.enabled) {
    return (
      <div style={{ padding: pad(6) }}>
        <GroupCap
          title="Браузер наружу не отдаётся"
          note="Включить можно в настройках, раздел «AI» — там же лежит команда подключения."
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(4), paddingTop: sp(4) }}>
      <div style={{ padding: `0 ${sp(4)}px` }}>
        <FactGrid facts={[
          { label: 'Подключено', value: String(clients.length || '—'), hint: 'спрашивали разрешение лично', active: clients.length > 0 },
          { label: 'Обращений', value: String(calls.length), hint: 'за время работы браузера' },
          { label: 'Отказов', value: String(calls.filter((c) => !c.ok).length), hint: 'не разрешили или не смогли' },
          { label: 'Канал', value: 'Без порта', hint: 'локальный, с секретом', active: true },
        ]} />
      </div>

      <SplitView
        side={(
          <SideNav
            caption="Программы"
            items={[
              { key: '', label: 'Все обращения' },
              ...clients.map((c) => ({
                key: c.key,
                label: c.label,
                note: String(calls.filter((x) => x.client.toLowerCase() === c.key).length || ''),
              })),
            ]}
            activeKey={picked ?? ''}
            onPick={(k) => setPicked(k || null)}
          />
        )}
      >
        {picked
          ? <ClientRights state={state} clientKey={picked} onChange={setState} />
          : null}
        <GroupCap
          title={picked ? 'Обращения этой программы' : 'Все обращения'}
          note={shown.length === 0 ? 'пока пусто' : undefined}
        />
        <Rows>
          {shown.map((c, i) => (
            <Row
              key={i}
              lead={new Date(c.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              title={c.tool}
              subtitle={c.client}
              // ⚠️ Отказ — СЛОВОМ и цветом текста, без заливки строки: заливка в системе значит
              // «выбрано», и крашеная строка читалась бы как выделенная человеком.
              meta={c.ok
                ? undefined
                : <span style={{ color: 'var(--danger-500)', fontWeight: 600 }}>{c.note ?? 'отказ'}</span>}
            />
          ))}
        </Rows>
      </SplitView>
    </div>
  );
}

/**
 * Права одной программы.
 *
 * ⚠️ Показываются, только когда программа ВЫБРАНА слева. Общий список «все программы × все
 * инструменты» — это таблица, которую никто не читает; человек приходит сюда с вопросом про
 * конкретную программу.
 */
function ClientRights({ state, clientKey, onChange }: {
  state: McpServerState | null;
  clientKey: string;
  onChange: (s: McpServerState) => void;
}) {
  const client = state?.clients.find((c) => c.key === clientKey);
  if (!state || !client) return null;

  const set = (tool: string, value: 'ask' | 'allow' | 'deny') => {
    void window.oblako.setMcpStance(client.key, tool, value).then(onChange);
  };

  return (
    <div style={{ marginBottom: sp(4) }}>
      <GroupCap
        title={client.label}
        note="назвалась так сама · проверить это мы не можем"
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: sp(1), padding: pad(2, 4) }}>
        {state.tools.map((t) => {
          const value = client.stances[t.name] ?? (t.mode === 'read' && !isSensitive(t.name) ? 'allow' : 'ask');
          const options: ('ask' | 'allow' | 'deny')[] = t.mode === 'write' || isSensitive(t.name)
            ? ['ask', 'allow', 'deny']
            : ['allow', 'deny'];
          return (
            <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: sp(3), minHeight: 34 }}>
              <span style={{
                flex: 1, minWidth: 0, ...TEXT.body,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{t.title}</span>
              <div style={{
                display: 'inline-flex', padding: 2, gap: 2, flex: 'none',
                background: 'var(--surface-sunken)', borderRadius: RADIUS.pill,
              }}>
                {options.map((o) => (
                  <button
                    key={o}
                    onClick={() => set(t.name, o)}
                    style={{
                      padding: `${sp(1)}px ${sp(3)}px`, border: 'none', cursor: 'default',
                      borderRadius: RADIUS.pill,
                      background: value === o ? 'var(--surface)' : 'transparent',
                      boxShadow: value === o ? 'var(--shadow-card)' : 'none',
                      color: value === o ? 'var(--text-strong)' : 'var(--text-muted)',
                      fontWeight: value === o ? 600 : 400,
                      ...TEXT.caption,
                      transition: motion.hover('background', 'color'),
                    }}
                  >{STANCE_LABEL[o]}</button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * ⚠️ Чувствительное чтение узнаём по ИМЕНИ, а не по флагу из main: контракт отдаёт наружу только
 * режим, а заводить ради одного признака ещё одно поле в состоянии — дороже, чем эта строка.
 * Если таких инструментов станет больше, признак поедет в контракт целиком.
 */
function isSensitive(name: string): boolean {
  return name === 'page.read_url';
}

/** Значок раздела для рельсы библиотеки. */
export const AgentsIcon = Plug;
