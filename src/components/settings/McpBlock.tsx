import { useEffect, useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import type { McpServerState } from '../../../shared/ipc';
import { Fact, FactGrid, InkSwitch, InlineHint, MasterSwitch, Subsection, btnGhost } from './kit';
import { CAPS, RADIUS, pad, sp } from '../../styles/system';

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

export function McpBlock() {
  const [state, setState] = useState<McpServerState | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.oblako.getMcpState().then((s) => { if (alive) setState(s); });
    return () => { alive = false; };
  }, []);

  // ⚠️ Состояние перечитывается по обращениям, а не по таймеру: единственное, что здесь может
  // измениться само, — число подключённых программ, и меняется оно ровно в момент вызова.
  useEffect(() => window.oblako.onMcpActivity(() => {
    void window.oblako.getMcpState().then(setState);
  }), []);

  const toggle = async () => setState(await window.oblako.setMcpEnabled(!state?.enabled));

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
              hint={state.clients.length
                ? state.clients.map((c) => c.label).join(', ')
                : 'первая программа спросит сама'}
              value={state.clients.length || 'Никого'}
              active={state.clients.length > 0}
            />
            <Fact
              label="Доступно"
              hint={`${state.tools.filter((t) => t.mode === 'read').length} на чтение, остальные с вопросом`}
              value={state.tools.length}
            />
            <Fact label="Канал" hint="локальный, с секретом" value="Без порта" active />
          </FactGrid>

          <CommandLine command={state.command} copied={copied} onCopy={copy} />

          {/* ⚠️ Настройки отвечают на «включено ли и как подключиться». Кто приходил, что делал и
              что кому позволено — это накопленное, то есть библиотека: раздел «Агенты» рядом с
              историей и загрузками. Здесь только дверь туда. */}
          <button
            onClick={() => void window.oblako.createSpecialTab('history', 'agents')}
            style={{ ...btnGhost, alignSelf: 'flex-start', display: 'inline-flex', gap: sp(2) }}
          >
            <ExternalLink size={15} />
            Обращения и права программ
          </button>
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
