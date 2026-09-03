import { useEffect, useState } from 'react';
import { Copy, Check, X } from 'lucide-react';
import type { McpCallLog, McpServerState } from '../../../shared/ipc';
import { InkSwitch, InlineHint, MasterSwitch, MonoChip, Segmented, Subsection } from './kit';
import { CAPS, RADIUS, TEXT, pad, sp } from '../../styles/system';

// «Браузер как инструмент» — включение MCP-сервера и то, что человек обязан о нём знать.
//
// ⚠️ ЗДЕСЬ ГЛАВНОЕ — НЕ ТУМБЛЕР, А ЧЕСТНЫЙ СПИСОК. Человек включает не «интеграцию», а доступ
// чужой программы к своему живому профилю; единственный способ сделать это решение осознанным —
// показать ровно то, что уйдёт наружу, и ровно то, что не уйдёт никогда. Поэтому список
// инструментов стоит рядом с выключателем, а не в документации.
//
// ⚠️ Состояние СПРАШИВАЕТСЯ у main, а не хранится здесь: сервер могли выключить из другого окна
// настроек, и «включено» на экране при молчащем канале — худший вид неправды.

/** «5 минут назад» — точное время здесь не нужно, нужен порядок величины. */
function when(at: number): string {
  const min = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} ч назад` : `${Math.round(h / 24)} дн назад`;
}

export function McpBlock() {
  const [state, setState] = useState<McpServerState | null>(null);
  const [calls, setCalls] = useState<McpCallLog[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.oblako.getMcpState().then((s) => { if (alive) setState(s); });
    return () => { alive = false; };
  }, []);

  // Журнал обновляем, пока раздел открыт и сервер работает: это единственный способ увидеть, что
  // происходило с браузером, пока человек смотрел в другое окно.
  useEffect(() => {
    if (!state?.running) { setCalls([]); return; }
    let alive = true;
    const pull = () => {
      void window.oblako.getMcpCalls().then((c) => { if (alive) setCalls(c); });
      // ⚠️ Заодно перечитываем состояние: первое обращение НОВОЙ программы заводит её в списке
      // подключённых, и список, не знающий об этом, показывал бы «пока никто не подключён» под
      // журналом, где уже идут вызовы.
      void window.oblako.getMcpState().then((st) => { if (alive) setState(st); });
    };
    pull();
    const timer = setInterval(pull, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [state?.running]);

  const toggle = async () => {
    const next = await window.oblako.setMcpEnabled(!state?.enabled);
    setState(next);
  };

  const revoke = async (key: string) => {
    setState(await window.oblako.revokeMcpClient(key));
  };

  const stance = async (key: string, tool: string, value: 'ask' | 'allow' | 'deny') => {
    setState(await window.oblako.setMcpStance(key, tool, value));
  };

  const copy = () => {
    if (!state) return;
    void navigator.clipboard.writeText(state.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Subsection
      title="Браузер как инструмент"
      description="Внешний ИИ — Claude Desktop, Claude Code, Cursor — может спросить у браузера, что у вас открыто, прочитать текст страницы и поискать в истории. По протоколу MCP, только на этой машине."
    >
      <MasterSwitch
        on={!!state?.enabled}
        title={state?.enabled ? 'Сервер работает' : 'Выключено'}
        description={state?.enabled
          ? 'Клиент, знающий команду подключения, может обращаться к браузеру. Пока он это делает, вызовы видны в журнале ниже.'
          : 'Пока выключено, браузер наружу не отвечает вовсе: канала не существует.'}
        control={<InkSwitch on={!!state?.enabled} onChange={() => void toggle()} />}
      />

      {state?.enabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3), marginTop: sp(3) }}>
          <div>
            <span style={{ ...CAPS, color: 'var(--text-faint)' }}>Команда подключения</span>
            <div style={{
              display: 'flex', alignItems: 'center', gap: sp(2), marginTop: sp(2),
              padding: pad(2, 3), borderRadius: RADIUS.control,
              background: 'var(--surface-sunken)', border: '1px solid var(--divider)',
            }}>
              <code style={{
                flex: 1, minWidth: 0, overflowX: 'auto', whiteSpace: 'nowrap',
                fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text-body)',
              }}>{state.command}</code>
              <button
                onClick={copy}
                title="Скопировать"
                style={{
                  flex: 'none', display: 'inline-flex', border: 'none', cursor: 'default',
                  background: 'transparent', color: 'var(--text-faint)', padding: sp(1),
                  borderRadius: RADIUS.control,
                }}
              >{copied ? <Check size={15} /> : <Copy size={15} />}</button>
            </div>
            {/* ⚠️ Порта нет намеренно — и человеку это стоит сказать: именно поэтому подключение
                выглядит длинной командой, а не адресом вида localhost:порт. */}
            <InlineHint>
              Соединение идёт по локальному каналу с секретом, а не по сетевому порту: открытая
              страница до него не дотянется.
            </InlineHint>
          </div>

          <div>
            <span style={{ ...CAPS, color: 'var(--text-faint)' }}>Что доступно агенту</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), marginTop: sp(2) }}>
              {state.tools.map((t) => (
                <MonoChip key={t.name} title={`${t.name} · ${t.mode === 'read' ? 'без вопросов' : 'с подтверждением'}`}>
                  {t.mode === 'write' ? `${t.title} ·` : t.title}
                </MonoChip>
              ))}
            </div>
            {/* ⚠️ Точка у инструмента записи — не украшение: она отделяет то, что происходит
                молча, от того, что каждый раз спрашивают. */}
            <InlineHint>
              Чтение идёт без вопросов, изменения — только после подтверждения в отдельном окне.
              Пароли, куки, автозаполнение и приватные вкладки наружу не отдаются вовсе: таких
              инструментов не существует, их нельзя включить.
            </InlineHint>
          </div>

          <ClientList state={state} onRevoke={revoke} onStance={stance} />

          <div>
            <span style={{ ...CAPS, color: 'var(--text-faint)' }}>Журнал вызовов</span>
            {calls.length === 0 ? (
              <InlineHint>Пока никто не обращался.</InlineHint>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: sp(1), marginTop: sp(2) }}>
                {calls.slice(0, 8).map((c, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'baseline', gap: sp(2),
                    ...TEXT.caption, fontVariantNumeric: 'tabular-nums',
                  }}>
                    <span style={{ color: 'var(--text-faint)' }}>
                      {new Date(c.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span style={{ color: 'var(--text-strong)' }}>{c.client}</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{c.tool}</span>
                    {!c.ok && <span style={{ color: 'var(--danger-500)' }}>отказ</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Subsection>
  );
}

/**
 * Кто подключён и что ему позволено.
 *
 * ⚠️ Отдельным компонентом, потому что это отдельный вопрос: тумблер выше отвечает «отдаём ли
 * браузер наружу вообще», а здесь человек разбирается с конкретными программами. Заодно это
 * держит McpBlock в пределах, за которыми компонент перестаёт читаться целиком.
 */
function ClientList(props: {
  state: McpServerState;
  onRevoke: (key: string) => Promise<void>;
  onStance: (key: string, tool: string, value: 'ask' | 'allow' | 'deny') => Promise<void>;
}) {
  return (
          <div>
            <span style={{ ...CAPS, color: 'var(--text-faint)' }}>Подключённые программы</span>
            {props.state.clients.length === 0 ? (
              <InlineHint>
                Пока никто не подключён. Когда программа обратится впервые, браузер спросит вас
                отдельным окном.
              </InlineHint>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2), marginTop: sp(2) }}>
                {props.state.clients.map((c) => (
                  <div key={c.key} style={{
                    display: 'flex', flexDirection: 'column', gap: sp(2), padding: pad(3, 3),
                    borderRadius: RADIUS.control, background: 'var(--surface-sunken)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...TEXT.body, color: 'var(--text-strong)' }}>{c.label}</div>
                      {/* ⚠️ Имя непроверяемо, и в интерфейсе это сказано прямо: программа
                          назвалась так сама, удостоверения у неё нет. */}
                      <div style={{ ...TEXT.caption }}>
                        назвалась так сама · последнее обращение {when(c.lastSeen)}
                      </div>
                    </div>
                    <button
                      onClick={() => void props.onRevoke(c.key)}
                      title="Отключить"
                      style={{
                        flex: 'none', display: 'inline-flex', border: 'none', cursor: 'default',
                        background: 'transparent', color: 'var(--text-faint)', padding: sp(1),
                        borderRadius: RADIUS.control,
                      }}
                    ><X size={15} /></button>
                    </div>
                    {/* ⚠️ Решения по инструментам стоят ПОД программой, а не общим списком:
                        одному клиенту открытие вкладок разрешают навсегда, другому — нет, и
                        общий список это различие спрятал бы. */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(1) }}>
                      {props.state.tools.map((t) => (
                        <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
                          <span style={{ flex: 1, ...TEXT.caption, color: 'var(--text-body)' }}>
                            {t.title}
                          </span>
                          {/* ⚠️ Готовый Segmented из kit, а не свой переключатель: правило
                              настроек — только рецепты оттуда, иначе плотность и заливки
                              разъезжаются по разделам (проверяет conventions-check). */}
                          <div style={{ flex: 'none', minWidth: 210 }}>
                            <Segmented
                              value={c.stances[t.name] ?? (t.mode === 'read' ? 'allow' : 'ask')}
                              options={t.mode === 'write'
                                ? [{ id: 'ask', label: 'Спрашивать' }, { id: 'allow', label: 'Всегда' }, { id: 'deny', label: 'Никогда' }]
                                : [{ id: 'allow', label: 'Разрешено' }, { id: 'deny', label: 'Никогда' }]}
                              onChange={(v) => void props.onStance(c.key, t.name, v)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
  );
}
