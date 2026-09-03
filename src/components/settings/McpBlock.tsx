import { useEffect, useState } from 'react';
import { Copy, Check, Plug, X } from 'lucide-react';
import type { McpCallLog, McpServerState } from '../../../shared/ipc';
import {
  Fact, FactGrid, InkSwitch, InlineHint, MasterSwitch, Segmented, SpotCard, Subsection, btnGhost,
} from './kit';
import { CAPS, RADIUS, TEXT, pad, sp } from '../../styles/system';

// «Браузер как инструмент» — включение MCP-сервера и то, что человек обязан о нём знать.
//
// ⚠️ ЗДЕСЬ ГЛАВНОЕ — НЕ ТУМБЛЕР, А ЧЕСТНЫЙ СПИСОК. Человек включает не «интеграцию», а доступ
// чужой программы к своему живому профилю; единственный способ сделать это решение осознанным —
// показать ровно то, что уйдёт наружу, и ровно то, что не уйдёт никогда.
//
// ⚠️ ЯЗЫК БЛОКА — ТОТ ЖЕ, ЧТО У ОСТАЛЬНЫХ НАСТРОЕК, и это пришлось чинить отдельно. Первая версия
// была набрана серыми плашками собственного изготовления: плитки фактов, карточки сущностей и тон
// раздела — весь словарь настроек — не использовались вовсе, и блок читался чужим куском. Правило
// простое: сущность — SpotCard с пятном, число — Fact, выбор — Segmented; своих заливок нет.
//
// ⚠️ Состояние СПРАШИВАЕТСЯ у main, а не хранится здесь: сервер могли выключить из другого окна
// настроек, и «включено» на экране при молчащем канале — худший вид неправды.

/** Пятна карточек программ. ⚠️ Из набора значков настроек — своего цвета блок не заводит. */
const CLIENT_STAIN = ['var(--tile-blue)', 'var(--tile-teal)', 'var(--tile-orange)', 'var(--tile-green)'];

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

  const toggle = async () => setState(await window.oblako.setMcpEnabled(!state?.enabled));
  const revoke = async (key: string) => setState(await window.oblako.revokeMcpClient(key));
  const stance = async (key: string, tool: string, value: 'ask' | 'allow' | 'deny') => {
    setState(await window.oblako.setMcpStance(key, tool, value));
  };

  const copy = () => {
    if (!state) return;
    void navigator.clipboard.writeText(state.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const today = calls.filter((c) => Date.now() - c.at < 24 * 3600_000).length;

  return (
    <Subsection
      title="Браузер как инструмент"
      description="Внешний ИИ — Claude Desktop, Claude Code, Cursor — может спросить у браузера, что у вас открыто, прочитать текст страницы и поискать в истории. По протоколу MCP, только на этой машине."
    >
      <MasterSwitch
        on={!!state?.enabled}
        title={state?.enabled ? 'Сервер работает' : 'Выключено'}
        description={state?.enabled
          ? 'Программа, знающая команду подключения, может обратиться к браузеру. Каждое обращение видно меткой в тулбаре и в журнале.'
          : 'Пока выключено, браузер наружу не отвечает вовсе: канала не существует.'}
        control={<InkSwitch on={!!state?.enabled} onChange={() => void toggle()} />}
      />

      {state?.enabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: sp(6), marginTop: sp(4) }}>
          {/* ⚠️ Плитки отвечают на вопросы, ради которых сюда и заходят: кто подключён, много ли
              берут и точно ли это не открытый в сеть порт. */}
          <FactGrid>
            <Fact
              label="Подключено"
              hint={state.clients.length ? 'спрашивали разрешение лично' : 'первая спросит сама'}
              value={state.clients.length || 'Никого'}
              active={state.clients.length > 0}
            />
            <Fact label="Обращений за сутки" hint="из журнала ниже" value={today} />
            <Fact
              label="Доступно"
              hint={`${state.tools.filter((t) => t.mode === 'read').length} на чтение, остальные с вопросом`}
              value={state.tools.length}
            />
            <Fact label="Канал" hint="локальный, с секретом" value="Без порта" active />
          </FactGrid>

          <CommandLine command={state.command} copied={copied} onCopy={copy} />
          <ClientList state={state} onRevoke={revoke} onStance={stance} />
          <CallLog calls={calls} />
        </div>
      )}
    </Subsection>
  );
}

/**
 * Строка подключения.
 *
 * ⚠️ В рамке чернилами, как InkFrame, а не в серой плашке: это то, что человек берёт и уносит в
 * другую программу, — единственное место блока, где текст важнее оформления.
 */
function CommandLine({ command, copied, onCopy }: {
  command: string; copied: boolean; onCopy: () => void;
}) {
  return (
    <div>
      <span style={{ ...CAPS, color: 'var(--text-faint)', display: 'block', marginBottom: sp(2) }}>Команда подключения</span>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: sp(3),
        padding: pad(3), borderRadius: RADIUS.box, border: '2px solid var(--text-strong)',
      }}>
        {/* ⚠️ ПЕРЕНОСИТСЯ, а не едет по горизонтали. Полоса прокрутки внутри поля выглядит
            поломкой, и главное — команду в ней не видно целиком, а её берут глазами перед тем,
            как вставить. Ломаем по любому символу: это путь, а не текст. */}
        <code style={{
          flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5,
          fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text-strong)',
        }}>{command}</code>
        <button onClick={onCopy} style={{ ...btnGhost, flex: 'none', display: 'inline-flex', gap: sp(2) }}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      {/* ⚠️ Порта нет намеренно — и человеку это стоит сказать: именно поэтому подключение
          выглядит длинной командой, а не адресом вида localhost:порт. */}
      <InlineHint>
        Соединение идёт по локальному каналу с секретом, а не по сетевому порту: открытая страница
        до него не дотянется. Пароли, куки, автозаполнение и приватные вкладки наружу не отдаются
        вовсе — таких инструментов не существует, их нельзя включить.
      </InlineHint>
    </div>
  );
}

/**
 * Кто подключён и что ему позволено.
 *
 * ⚠️ Программа — СУЩНОСТЬ, а не строка списка, поэтому карточка с пятном, как у профиля и сайта.
 * Это не украшение: решения по инструментам принимаются для каждой отдельно, и человек должен
 * видеть, что «разрешать всегда» он выдал вот этой программе, а не вообще.
 */
function ClientList(props: {
  state: McpServerState;
  onRevoke: (key: string) => Promise<void>;
  onStance: (key: string, tool: string, value: 'ask' | 'allow' | 'deny') => Promise<void>;
}) {
  const { state } = props;
  return (
    <div>
      <span style={{ ...CAPS, color: 'var(--text-faint)', display: 'block', marginBottom: sp(2) }}>Подключённые программы</span>
      {state.clients.length === 0 ? (
        <InlineHint>
          Пока никто не подключён. Когда программа обратится впервые, браузер спросит вас карточкой
          в правом верхнем углу — она же перечислит, что программа сможет видеть.
        </InlineHint>
      ) : (
        // ⚠️ Колонкой, а не SpotGrid: внутри карточки шесть строк с переключателем на три
        // положения, и в половинной колонке сетки они бы поехали. Сетка хороша для однородных
        // плиток — здесь карточка сама по себе широкая.
        <div style={{ marginTop: sp(2), display: 'flex', flexDirection: 'column', gap: sp(3) }}>
            {state.clients.map((c, i) => (
              <SpotCard
                key={c.key}
                stain={CLIENT_STAIN[i % CLIENT_STAIN.length]}
                eyebrow="внешний агент"
                icon={(
                // ⚠️ Значок ПЛАШКОЙ, а не голым глифом: рядом с дисплейным именем в 26 кегле
                // одиночная иконка выглядит случайно приклеенной (так и вышло на первом кадре).
                <span style={{
                  width: 40, height: 40, borderRadius: RADIUS.control, flex: 'none',
                  display: 'grid', placeItems: 'center',
                  background: 'var(--surface-sunken)', color: 'var(--text-strong)',
                }}><Plug size={20} /></span>
              )}
                title={c.label}
                // ⚠️ «Назвалась так сама» стоит прямо под именем: карточка не выдаёт чужое
                // представление за удостоверение личности.
                subtitle={`назвалась так сама · ${when(c.lastSeen)}`}
                actions={(
                  <button
                    onClick={() => void props.onRevoke(c.key)}
                    title="Отключить программу"
                    style={{ ...btnGhost, display: 'inline-flex', padding: sp(2) }}
                  ><X size={15} /></button>
                )}
              >
                <ToolStances client={c} state={state} onStance={props.onStance} />
              </SpotCard>
            ))}
        </div>
      )}
    </div>
  );
}

/** Решения по инструментам одной программы. */
function ToolStances({ client, state, onStance }: {
  client: McpServerState['clients'][number];
  state: McpServerState;
  onStance: (key: string, tool: string, value: 'ask' | 'allow' | 'deny') => Promise<void>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
      {state.tools.map((t) => (
        <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: sp(3) }}>
          <span style={{
            flex: 1, minWidth: 0, ...TEXT.body, color: 'var(--text-body)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{t.title}</span>
          {/* ⚠️ Готовый Segmented из kit, а не свой переключатель: правило настроек — только
              рецепты оттуда, иначе плотность и заливки разъезжаются по разделам. */}
          <div style={{ flex: 'none', minWidth: 210 }}>
            <Segmented
              value={client.stances[t.name] ?? (t.mode === 'read' ? 'allow' : 'ask')}
              options={t.mode === 'write'
                ? [{ id: 'ask', label: 'Спрашивать' }, { id: 'allow', label: 'Всегда' }, { id: 'deny', label: 'Никогда' }]
                : [{ id: 'allow', label: 'Можно' }, { id: 'deny', label: 'Никогда' }]}
              onChange={(v) => void onStance(client.key, t.name, v)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Что уже происходило.
 *
 * ⚠️ Отказ помечается СЛОВОМ и цветом текста, а не заливкой строки: заливка в системе означает
 * «выбрано», и крашеная строка журнала читалась бы как выделенная человеком.
 */
function CallLog({ calls }: { calls: McpCallLog[] }) {
  return (
    <div>
      <span style={{ ...CAPS, color: 'var(--text-faint)', display: 'block', marginBottom: sp(2) }}>Журнал обращений</span>
      {calls.length === 0 ? (
        <InlineHint>Пока никто не обращался.</InlineHint>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: sp(1), marginTop: sp(2) }}>
          {calls.slice(0, 8).map((c, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'baseline', gap: sp(3),
              ...TEXT.body, fontVariantNumeric: 'tabular-nums',
            }}>
              <span style={{
                color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)',
              }}>
                {new Date(c.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span style={{ color: 'var(--text-strong)' }}>{c.client}</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
              }}>{c.tool}</span>
              {!c.ok && (
                <span style={{ marginLeft: 'auto', color: 'var(--danger-500)', fontWeight: 600 }}>
                  отказ
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
