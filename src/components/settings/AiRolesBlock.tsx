import { OptionList, OptionRow, Segmented, Subsection } from './kit';
import { TEXT, sp } from '../../styles/system';
import { AI_ROLES, ROLE_INFO, cloudAllowed, cloudFitNote, hasChoice, LOCAL_ID } from '../../../shared/aiRouting';
import type { AiConnectionsState } from '../../../shared/ipc';

/**
 * Что чем считается — таблица ролей.
 *
 * ⚠️ ЭТО ЕДИНСТВЕННЫЙ ЭКРАН, ГДЕ ОБЕЩАНИЕ ПРИВАТНОСТИ ВИДНО ЦЕЛИКОМ, поэтому он читается как
 * таблица: строка — роль, справа — куда она ходит.
 *
 * ⚠️ Закрытые роли ПОКАЗЫВАЮТСЯ, а не прячутся. Семь строк «всегда на этой машине» работают на
 * доверие сильнее любого абзаца про приватность — спрятав их, мы оставили бы человека гадать, что
 * ещё уходит наружу. Вместо выбора у них прочерк и причина.
 *
 * ⚠️ И НИКАКОЙ ПРИТУШЕННОЙ ПОДЛОЖКИ у закрытых строк, хотя рука тянется. В настройках заливка
 * означает «выбрано» и больше ничего — правило проверяется машиной (conventions-check), и оно право:
 * серый фон читался бы как «недоступно», а роль не недоступна, она так устроена.
 *
 * ⚠️ Весь блок появляется, только когда есть ИЗ ЧЕГО выбирать. Таблица из десяти строк, где все
 * десять говорят «на этой машине», не сообщает ничего.
 */
export function AiRolesBlock({ state }: { state: AiConnectionsState | null }) {
  if (state === null || !hasChoice({ connections: state.connections })) return null;

  // ⚠️ «Здесь», а не «На этой машине»: подпись живёт в сегменте рядом с именами подключений, и
  // длинная фраза растянула бы дорожку так, что имена перестали бы читаться.
  const options = [
    { id: LOCAL_ID, label: 'Здесь' },
    ...state.connections.map((c) => ({ id: c.id, label: c.label })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(4) }}>
      <Subsection
        title="Что чем считается"
        description="Облако предлагается там, где ответ сочиняют. Там, где модель выбирает из готового набора, сильная модель сделает то же самое — только за деньги и медленнее."
      ><span /></Subsection>

      <OptionList>
        {AI_ROLES.map((role) => {
          const info = ROLE_INFO[role];
          const open = cloudAllowed(role);
          return (
            <OptionRow
              key={role}
              title={info.label}
              subtitle={open ? `Наружу уходит: ${info.leaves}` : cloudFitNote(role) ?? ''}
              actions={open ? (
                <Segmented
                  value={state.routing[role] ?? LOCAL_ID}
                  options={options}
                  onChange={(id) => void window.oblako.setAiRoute(role, id === LOCAL_ID ? null : id)}
                />
              ) : (
                <span style={{ ...TEXT.caption, fontFamily: 'var(--font-mono)' }}>—</span>
              )}
            />
          );
        })}
      </OptionList>
    </div>
  );
}
