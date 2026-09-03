import { btnGhost, CapsLabel, Fact, FactGrid } from './kit';
import { sp } from '../../styles/system';
import { emptyUsage, formatCost, formatTokens, sumUsage, totalTokens, type AiUsage } from '../../../shared/aiUsage';
import { LOCAL_CONNECTION_ID } from '../../../shared/aiProviders';
import type { AiConnectionsState } from '../../../shared/ipc';

/**
 * Сколько израсходовано: запросы, токены, деньги.
 *
 * ⚠️ БЛОК НЕ ПРЯЧЕТСЯ ПРИ ПУСТОМ СЧЁТЕ, и это исправление живой жалобы «плиток нет». Первая версия
 * скрывалась, пока не сделано ни одного запроса — «четыре нуля это не сводка, а шум». Рассуждение
 * верное для ленты и неверное здесь: за плитками человек идёт СПЕЦИАЛЬНО, и невидимы они выходили
 * ровно в тот момент, когда их пришли искать. Есть подключение — блок на месте, с честным нулём.
 *
 * ⚠️ БРАУЗЕР НЕ СЧИТАЕТ ЦЕНУ, а показывает ту, что вернул провайдер. Стоимость зависит от модели,
 * тарифа, скидок и кэша промпта; прайс-лист внутри браузера устарел бы раньше следующей версии —
 * та же причина, по которой здесь нет каталога моделей. Стоимость сейчас возвращает по сути один
 * OpenRouter; у остальных плитка честно говорит, что провайдер её не сообщает.
 *
 * ⚠️ ПРОЧЕРК И НОЛЬ — РАЗНОЕ. «0 запросов» правда: счёт ведётся и пока пуст. «—» в деньгах не ноль,
 * а «провайдер цену не сообщает»: «$0» там означало бы «бесплатно» в самом чувствительном месте.
 *
 * ⚠️ Встроенная модель в счёте ЕСТЬ, хотя денег не стоит. Без неё не с чем сравнить облако, а
 * «сколько на самом деле ушло наружу» — как раз тот вопрос, ради которого счёт и заведён.
 */
export function AiUsageBlock({ state, usage, onReset }: {
  state: AiConnectionsState | null;
  usage: Record<string, AiUsage> | null;
  onReset: () => void;
}) {
  if (state === null || usage === null) return null;

  const ids = Object.keys(usage);
  const cloudIds = ids.filter((id) => id !== LOCAL_CONNECTION_ID);
  const total = sumUsage(ids.map((id) => usage[id]));
  const cloud = cloudIds.length === 0 ? emptyUsage(0) : sumUsage(cloudIds.map((id) => usage[id]));
  const local = usage[LOCAL_CONNECTION_ID];

  // Без единого подключения и без единого запроса сводка сообщала бы четыре прочерка ни о чём.
  // Появилось подключение — блок стоит всегда, даже пустой: за ним приходят специально.
  if (state.connections.length === 0 && total.requests === 0) return null;

  async function reset(): Promise<void> {
    await window.oblako.resetAiUsage();
    onReset();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(3) }}>
        <CapsLabel>Расход{since(total.since)}</CapsLabel>
        {total.requests > 0 && (
          <button onClick={() => void reset()} style={{ ...btnGhost, marginLeft: 'auto', fontSize: 'var(--fs-xs)' }}>
            Обнулить счёт
          </button>
        )}
      </div>

      <FactGrid>
        <Fact
          label="Запросов"
          hint={total.requests === 0 ? 'счёт начнётся с первого ответа'
            : cloudIds.length === 0 ? 'все — на этой машине' : `наружу ушло ${cloud.requests}`}
          value={String(total.requests)}
          active={total.requests > 0}
        />
        <Fact
          label="Токенов наружу"
          hint={cloud.requests === 0 ? 'облако ещё не отвечало' : `на приём ${formatTokens(cloud.completionTokens)}`}
          value={formatTokens(totalTokens(cloud))}
        />
        <Fact
          label="Потрачено"
          hint={cloud.costKnown ? 'по данным провайдера' : 'провайдер не сообщает цену'}
          value={cloud.costKnown ? formatCost(cloud.cost) : '—'}
        />
        <Fact
          label="На этой машине"
          hint={local === undefined ? 'не использовалась' : `запросов ${local.requests}`}
          value={local === undefined ? '—' : formatTokens(totalTokens(local))}
        />
      </FactGrid>
    </div>
  );
}

/** ⚠️ «с 3 сентября», а не «03.09.2026»: это подпись к сводке, а не поле в таблице. */
function since(ts: number): string {
  if (!ts) return '';
  return ` с ${new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
}
