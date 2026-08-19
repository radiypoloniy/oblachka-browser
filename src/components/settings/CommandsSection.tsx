import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { CommandsSnapshot } from '../../../shared/ipc';
import type { CommandDef, OmniboxDoorMode } from '../../../shared/commands';
import { describeNeeds, TOOL_LABELS } from '../../../shared/commands';
import { IconBtn, Subsection, InlineHint, OptionList, OptionRow, settingsBox } from './kit';
import { sp, pad } from '../../styles/system';

// ── Секция «Команды» — список того, что человек может вызвать, и дверь в адресной строке.
// Устройство слоя целиком — docs/commands-architecture.md.
//
// ⚠️ Формы создания команды здесь НЕТ и не должно быть. Команды заводятся из РЕЗУЛЬТАТА («сохранить
// как команду» в карточке ответа, этап 2), а не из настроек: человек не садится придумывать
// команды, он формулирует задачу по делу и сохраняет то, что сработало. Настройки — место, где
// видно, что уже наработано и что пора выбросить.

const DOOR_OPTIONS: { id: OmniboxDoorMode; label: string; hint: string }[] = [
  { id: 'always', label: 'Предлагать по фразе', hint: 'Набранная фраза становится строкой «Сделать» в подсказках' },
  { id: 'slash', label: 'Только по «/»', hint: 'Обычный ввод адресную строку не трогает вовсе' },
  { id: 'off', label: 'Не предлагать', hint: 'Команды останутся на выделении и в правилах' },
];

export default function CommandsSection() {
  const [snapshot, setSnapshot] = useState<CommandsSnapshot>({ door: 'always', items: [] });

  useEffect(() => {
    let mounted = true;
    void window.oblako.listCommands().then((s) => { if (mounted) setSnapshot(s); });
    const unsub = window.oblako.onCommandsChanged((s) => { if (mounted) setSnapshot(s); });
    return () => { mounted = false; unsub(); };
  }, []);

  // Один источник правды — push из main: после мутации локальный список не правим руками.
  async function setDoor(mode: OmniboxDoorMode) { await window.oblako.setCommandsDoor(mode); }
  async function remove(id: string) { await window.oblako.removeCommand(id); }

  return (
    <Subsection
      title="Команды"
      description="Одна фраза — одно действие браузера. Что команда увидит, написано в её строке."
    >
      <OptionList>
        {DOOR_OPTIONS.map((o) => (
          <OptionRow
            key={o.id}
            title={o.label}
            subtitle={o.hint}
            active={snapshot.door === o.id}
            selectable
            onClick={() => void setDoor(o.id)}
          />
        ))}
      </OptionList>

      {/* ⚠️ Подпись про выключатель стоит ПОД ним и говорит прямо, что именно гаснет: человек,
          выключающий строку в адресной строке, не должен гадать, остались ли у него команды. */}
      <InlineHint>
        Выключатель гасит одну дверь, а не сами команды: они остаются на выделении, в правилах и
        в этом списке.
      </InlineHint>

      <div style={{ ...settingsBox, padding: 0, marginTop: sp(3) }}>
        {snapshot.items.length === 0 ? (
          <div style={{ padding: sp(3), fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
            Пока пусто.
          </div>
        ) : snapshot.items.map((c, i) => (
          <CommandRow key={c.id} cmd={c} first={i === 0} onRemove={() => void remove(c.id)} />
        ))}
      </div>
    </Subsection>
  );
}

function CommandRow({ cmd, first, onRemove }: { cmd: CommandDef; first: boolean; onRemove: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: sp(3), padding: pad(3, 4),
      borderTop: first ? 'none' : '1px solid var(--divider)',
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
          {cmd.name}
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          {/* Права словами, а не значками: «увидит: открытые вкладки» человек прочитает один раз
              и запомнит, а значок пришлось бы расшифровывать каждый раз. */}
          {describeNeeds(cmd)}
          {cmd.tools.length > 0 && ` · сможет: ${cmd.tools.map((t) => TOOL_LABELS[t]).join(', ')}`}
        </div>
      </div>

      {/* ⚠️ Счётчик — не статистика, а подсказка к уборке: список команд единственное место в
          браузере, которое зарастает по вине самого человека. */}
      <span style={{
        fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {cmd.runs > 0 ? `${cmd.runs} раз` : 'ни разу'}
      </span>

      {/* Встроенную удалить нельзя — её можно только не вызывать; кнопки у неё нет вовсе. */}
      {!cmd.builtin && (
        <IconBtn title="Удалить команду" onClick={onRemove}>
          <Trash2 size={15} />
        </IconBtn>
      )}
    </div>
  );
}
