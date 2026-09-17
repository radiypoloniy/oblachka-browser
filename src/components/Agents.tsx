import { useEffect, useMemo, useState } from 'react';
import { Plug } from 'lucide-react';
import type { McpCallLog, McpServerState } from '../../shared/ipc';
import {
  FactGrid, GroupCap, Row, Rows, SideNav, SplitView, type LibrarySummary,
} from './library/kit';
import { RADIUS, TEXT, motion, pad, sp } from '../styles/system';
import { clientKey } from '../../shared/mcpPolicy'; import { useLanguage } from '../i18n';

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

  /**
   * Кто стучался и остался неподключённым.
   *
   * ⚠️ Считается из ЖУРНАЛА, а не из отдельного списка «ожидающих», и это осознанно: список
   * ожидающих был бы третьим хранилищем состояния о клиентах рядом с двумя имеющимися, причём
   * состоянием, которое некому чистить. В журнале ответ уже есть — «звали, отказали в подключении».
   */
  const pending = useMemo(() => {
    // ⚠️ Список берём из state, а не из `clients` выше: тот пересобирается на каждом рендере, и
    // memo с ним в зависимостях не держал бы ничего (см. react-hooks/exhaustive-deps).
    const approved = new Set((state?.clients ?? []).map((c) => c.key));
    const seen = new Map<string, string>();
    for (const c of calls) {
      if (c.note !== 'not-connected') continue;
      const key = clientKey(c.client);
      if (!approved.has(key)) seen.set(key, c.client);
    }
    return [...seen].map(([key, label]) => ({ key, label }));
  }, [calls, state]);

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

        {picked === null && pending.length > 0 && (
          <PendingClients items={pending} onChange={setState} />
        )}
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
  const { t } = useLanguage();
  const client = state?.clients.find((c) => c.key === clientKey);
  if (!state || !client) return null;

  const set = (tool: string, value: 'ask' | 'allow' | 'deny') => {
    void window.oblako.setMcpStance(client.key, tool, value).then(onChange);
  };

  return (
    <div style={{ marginBottom: sp(4) }}>
      <GroupCap
        title={client.label}
        // ⚠️ Профиль стоит рядом с именем не для полноты: разрешение живёт ТОЛЬКО в нём, и человек
        // должен видеть, какому именно профилю он открыл дверь. В другом браузер этой программе не
        // ответит вовсе.
        note={client.profileName
          ? t('профиль «{name}» · назвалась так сама, проверить это мы не можем', { name: client.profileName })
          : t('назвалась так сама · проверить это мы не можем')}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: sp(1), padding: pad(2, 4) }}>
        {state.tools.map((tool) => {
          const value = client.stances[tool.name] ?? (tool.mode === 'read' && !isSensitive(tool.name) ? 'allow' : 'ask');
          const options: ('ask' | 'allow' | 'deny')[] = tool.mode === 'write' || isSensitive(tool.name)
            ? ['ask', 'allow', 'deny']
            : ['allow', 'deny'];
          return (
            <div key={tool.name} style={{ display: 'flex', alignItems: 'center', gap: sp(3), minHeight: 34 }}>
              <span style={{
                flex: 1, minWidth: 0, ...TEXT.body,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{tool.title}</span>
              <div style={{
                display: 'inline-flex', padding: 2, gap: 2, flex: 'none',
                background: 'var(--surface-sunken)', borderRadius: RADIUS.pill,
              }}>
                {options.map((o) => (
                  <button
                    key={o}
                    onClick={() => set(tool.name, o)}
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
                  >{t(STANCE_LABEL[o] ?? o)}</button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <AllowedSites client={client} onChange={onChange} />
    </div>
  );
}

/**
 * Белый список сайтов программы.
 *
 * ⚠️ ОБЕЩАНИЕ СИЛЬНОЕ И ПРОСТОЕ: «этой программе — только docs и github». Агенту нельзя в почту,
 * даже если он попросит и человек машинально нажмёт «разрешить»: спрашивать никто не будет —
 * адреса вне списка для этого клиента просто не существует.
 *
 * ⚠️ ПУСТО ОЗНАЧАЕТ «БЕЗ ОГРАНИЧЕНИЙ», и это сказано прямо. Иначе человек, увидев пустое поле,
 * решит, что программа уже ограничена, — и это худший вид неправды в интерфейсе про доступ.
 *
 * ⚠️ Правки применяются ПО КНОПКЕ, а не по каждому нажатию клавиши: список правил — не тумблер,
 * а текст, и записывать его в момент, когда человек ещё дописывает домен, значило бы применять
 * половину его решения.
 */
function AllowedSites({ client, onChange }: {
  client: McpServerState['clients'][number];
  onChange: (s: McpServerState) => void;
}) {
  const { t } = useLanguage(); const saved = (client.domains ?? []).join('\n');
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState(false);
  // Программу переключили слева — показываем её список, а не остатки прошлой.
  useEffect(() => { setText((client.domains ?? []).join('\n')); }, [client.key, client.domains]);

  const dirty = text.trim() !== saved.trim();
  const apply = () => {
    setBusy(true);
    const rules = text.split(/[\n,;]+/).map((r) => r.trim()).filter(Boolean);
    void window.oblako.setMcpDomains(client.key, rules).then((s) => { onChange(s); setBusy(false); });
  };

  return (
    <div style={{ padding: pad(2, 4), display: 'flex', flexDirection: 'column', gap: sp(2) }}>
      <GroupCap
        title="Разрешённые сайты"
        note={client.domains?.length
          ? 'программа не видит ничего, кроме перечисленного'
          : 'пусто — ограничений нет, программе видны любые сайты'}
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(6, Math.max(2, text.split('\n').length + 1))}
        placeholder={'github.com\ndocs.python.org'}
        spellCheck={false}
        style={{
          ...TEXT.body, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)',
          padding: pad(2, 3), borderRadius: RADIUS.control, resize: 'vertical',
          border: '1.5px solid var(--divider-strong)', background: 'transparent',
          color: 'var(--text-strong)', outline: 'none',
        }}
      />
      <div style={{ display: 'flex', gap: sp(3), alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={apply}
          disabled={!dirty || busy}
          style={{
            ...TEXT.body, padding: pad(1, 3), borderRadius: RADIUS.control, cursor: 'default',
            border: '1px solid var(--divider-strong)', background: 'transparent',
            opacity: !dirty || busy ? 0.5 : 1, transition: motion.hover('background'),
          }}
        >{busy ? t('Применяю…') : t('Применить')}</button>
        {/* ⚠️ Про поддомены и про звёздочку сказано здесь, а не в документации: человек пишет
            правила прямо тут, и узнать про них он может только отсюда. */}
        <span style={{ ...TEXT.caption, color: 'var(--text-faint)' }}>
          По домену на строку. Поддомены входят: github.com покрывает api.github.com.
          Звёздочки не поддерживаются — «docs.*» совпал бы с docs.чей-угодно-сайт.
        </span>
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
  return name === 'page_read_url';
}

/** Значок раздела для рельсы библиотеки. */
export const AgentsIcon = Plug;

/**
 * Программы, которые стучались и остались за дверью.
 *
 * ⚠️ Заведено по живому случаю, и случай вскрыл порок конструкции, а не мелочь. Карточка
 * подтверждения появляется в окне браузера — а человек в момент вызова смотрит в ту программу, из
 * которой спрашивает. Он не видит карточки, агент отвечает «не подключено», и фича выглядит
 * сломанной: «не работает, какие вкладки у меня открыты».
 *
 * ⚠️ Кнопка даёт ТО ЖЕ САМОЕ согласие, что и карточка, — просто позже и там, куда человек дошёл
 * сам. Поэтому рядом стоит та же оговорка, что и в правах: имя программы ничем не подтверждено,
 * она назвалась им сама. Предлагать доверять строке из чужого запроса, не сказав этого, нельзя.
 */
function PendingClients({ items, onChange }: {
  items: { key: string; label: string }[];
  onChange: (s: McpServerState) => void;
}) {
  return (
    <div style={{ marginBottom: sp(4) }}>
      <GroupCap
        title="Стучались, но не подключены"
        note="карточка ждала в окне браузера — можно подключить и отсюда"
      />
      <Rows>
        {items.map((p) => (
          <Row
            key={p.key}
            lead={<Plug size={16} style={{ color: 'var(--text-faint)' }} />}
            title={p.label}
            subtitle="назвалась так сама · проверить это мы не можем"
            actions={(
              <button
                onClick={() => { void window.oblako.approveMcpClient(p.key, p.label).then(onChange); }}
                style={{
                  ...TEXT.body, padding: pad(1, 3), border: '1px solid var(--divider-strong)',
                  borderRadius: RADIUS.control, background: 'transparent', cursor: 'default',
                  transition: motion.hover('background'),
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >Подключить</button>
            )}
          />
        ))}
      </Rows>
    </div>
  );
}
