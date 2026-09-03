import { useEffect, useRef, useState } from 'react';
import { CAPS, RADIUS, sp, pad } from '../../styles/system';
import type { AiConnectionsState } from '../../../shared/ipc';

/**
 * Какая модель отвечает в чате — и переключение на месте.
 *
 * ⚠️ ОДНА МЕТКА НА ВСЕ ЧАТЫ: панель, хаб новой вкладки, блокнот (у него центральная колонка — тот
 * же чат хаба) и узел графа. Все они ходят через runChatMessage, то есть через роль «Чат», поэтому
 * и переключатель у них обязан быть один: две метки, меняющие один маршрут, разъезжались бы на
 * первом же переключении в соседнем окне.
 *
 * ⚠️ МЕТКИ НЕТ, ПОКА НЕЧЕГО ВЫБИРАТЬ. Без подключений ответ всегда локальный, и элемент, умеющий
 * ровно одно значение, — не выбор, а лишняя строка, которую надо прочитать и понять. В этом
 * состоянии композитор выглядит ровно как до появления слоя моделей.
 *
 * ⚠️ Язык — МЕТКА, а не кнопка: моноширинная капса на мягкой подложке, без рамки (рецепт `.chip`
 * дизайн-проекта, у нас — CAPS). Первая версия была предложением в пилюле с обводкой, то есть
 * формой кнопки, и вставала рядом с «отправить» вторым действием. Плакатного цвета здесь нет и
 * быть не может: панель и поповер — хром над чужим сайтом, тон там запрещён.
 *
 * ⚠️ Меняет МАРШРУТ РОЛИ «Чат», то есть то же самое, что таблица в настройках, — просто под рукой.
 * Выбор «только для этой беседы» честно не сделан: он требует протащить исключение через отправку
 * и хранение переписки, а притвориться, что переключатель локальный, когда он глобальный, хуже,
 * чем не иметь его вовсе.
 */
export function ModelChip({ align = 'left' }: { align?: 'left' | 'right' }) {
  const [state, setState] = useState<AiConnectionsState | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const api = bridge();
    if (!api) return;
    let alive = true;
    void api.aiConnections().then((s) => { if (alive) setState(s); });
    const off = api.onAiConnectionsChanged((s) => { if (alive) setState(s); });
    return () => { alive = false; off(); };
  }, []);

  // Клик мимо закрывает меню — иначе оно остаётся висеть поверх переписки.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  if (state === null || state.connections.length === 0) return null;

  const current = state.routing['chat'] ?? 'local';
  const chosen = state.connections.find((c) => c.id === current);
  const label = chosen?.label ?? 'На этой машине';
  const local = chosen === undefined || chosen.kind === 'local';

  const pick = (id: string): void => {
    setOpen(false);
    // ⚠️ Состояние правим СРАЗУ, не дожидаясь пуша из main. Пуш приходит и он же источник истины,
    // но между кликом и им — целый круг через IPC и запись на диск, а метка, которая после нажатия
    // ещё мгновение показывает прежнее имя, читается как не сработавшая кнопка.
    setState((s) => (s === null ? s : { ...s, routing: { ...s.routing, chat: id } }));
    void bridge()?.setAiRoute('chat', id === 'local' ? null : id);
  };

  return (
    <div ref={box} style={{ position: 'relative', flexShrink: 0, minWidth: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Кто отвечает в чате"
        style={{
          ...CAPS,
          display: 'flex', alignItems: 'center', gap: sp(1) + 2,
          maxWidth: 190, padding: pad(1, 2), border: 'none',
          borderRadius: RADIUS.pill, background: open ? 'var(--surface-hover)' : 'var(--surface-sunken)',
          // Служебный факт по умолчанию тише; выбранное человеком наливается чернилами.
          color: chosen ? 'var(--text-strong)' : 'var(--text-muted)',
          cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden',
        }}
      >
        <Dot local={local} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      </button>

      {open && (
        // ⚠️ Раскрывается ВВЕРХ: метка стоит у нижнего края композитора, и вниз списку места нет.
        <div style={{
          position: 'absolute', bottom: `calc(100% + ${sp(1) + 2}px)`, zIndex: 10, minWidth: 210,
          ...(align === 'right' ? { right: 0 } : { left: 0 }),
          background: 'var(--surface-solid)', border: '1px solid var(--glass-edge)',
          borderRadius: RADIUS.box, boxShadow: 'var(--shadow-card)', padding: sp(1),
        }}>
          <Item label="На этой машине" local checked={local} onPick={() => pick('local')} />
          {state.connections.map((c) => (
            <Item
              key={c.id}
              label={c.label}
              sub={c.model}
              local={c.kind === 'local'}
              checked={c.id === current}
              onPick={() => pick(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Мост до main. ⚠️ Их ДВА и оба законны: панель живёт своим `window.aiPanel` (отдельный preload,
 * отдельный бандл), хаб/блокнот/граф — общим `window.oblako`. Методы у них одноимённые и ходят по
 * ОДНИМ каналам (shared/ipc), поэтому компоненту достаточно взять тот, что есть в этом окне.
 */
interface ConnectionsBridge {
  aiConnections: () => Promise<AiConnectionsState>
  setAiRoute: (role: string, connectionId: string | null) => Promise<boolean>
  onAiConnectionsChanged: (cb: (state: AiConnectionsState) => void) => () => void
}

function bridge(): ConnectionsBridge | null {
  const w = window as unknown as { aiPanel?: ConnectionsBridge; oblako?: ConnectionsBridge };
  return w.aiPanel ?? w.oblako ?? null;
}

/**
 * ⚠️ Смысл несёт и форма, а не только цвет: «здесь» — залитая точка, «облако» — кольцо. Два оттенка
 * на шести пикселях различит не каждый глаз и не каждый монитор.
 */
function Dot({ local }: { local: boolean }) {
  const color = local ? 'var(--dot-local)' : 'var(--dot-cloud)';
  return (
    <span style={{
      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
      background: local ? color : 'transparent',
      border: local ? 'none' : `1.5px solid ${color}`,
    }} />
  );
}

/** Строка меню — обычным шрифтом: это выбор, а не метка. Имя модели моноширинным, вторым планом. */
function Item({ label, sub, local, checked, onPick }: {
  label: string; sub?: string; local: boolean; checked: boolean; onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      style={{
        display: 'flex', alignItems: 'center', gap: sp(2), width: '100%',
        padding: pad(1, 2), borderRadius: RADIUS.control, border: 'none',
        background: checked ? 'var(--selected)' : 'transparent',
        color: 'var(--text-strong)', fontSize: 'var(--fs-sm)', fontWeight: 600,
        cursor: 'pointer', textAlign: 'left',
      }}
    >
      <Dot local={local} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {sub && (
        <span style={{
          marginLeft: 'auto', paddingLeft: sp(2), color: 'var(--text-faint)',
          fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', fontWeight: 400, whiteSpace: 'nowrap',
        }}>{sub}</span>
      )}
    </button>
  );
}
