import { useEffect, useState } from 'react';
import { btnGhost, CapsLabel, Fact, FactGrid } from './kit';
import { sp } from '../../styles/system';
import { formatCost, formatTokens, sumUsage, totalTokens, type AiUsage } from '../../../shared/aiUsage';
import { LOCAL_CONNECTION_ID } from '../../../shared/aiProviders';
import type { AiConnectionsState } from '../../../shared/ipc';

/**
 * Сколько израсходовано: запросы, токены, деньги.
 *
 * ⚠️ БРАУЗЕР НЕ СЧИТАЕТ ЦЕНУ, а показывает ту, что вернул провайдер. Стоимость зависит от модели,
 * тарифа, скидок и кэша промпта; прайс-лист внутри браузера устарел бы раньше следующей версии —
 * та же причина, по которой здесь нет каталога моделей. Стоимость сейчас возвращает по сути один
 * OpenRouter; у остальных плитка честно говорит, что провайдер её не сообщает, и показывает токены.
 *
 * ⚠️ Плитки, а не таблица. Вопрос у человека ровно один и общий — «сколько уходит», — а разбивка по
 * подключениям стоит рядом, в карточках. Таблица на четыре строки заняла бы полэкрана ради того же
 * ответа.
 *
 * ⚠️ Встроенная модель в счёте ЕСТЬ, хотя денег не стоит. Без неё не с чем сравнить облако, а
 * «сколько на самом деле ушло наружу» — как раз тот вопрос, ради которого счёт и заведён.
 */
export function AiUsageBlock({ state }: { state: AiConnectionsState | null }) {
  const [usage, setUsage] = useState<Record<string, AiUsage> | null>(null);

  useEffect(() => {
    let alive = true;
    void window.oblako.aiUsage().then((u) => { if (alive) setUsage(u); });
    return () => { alive = false; };
  }, [state]);

  if (usage === null) return null;

  const ids = Object.keys(usage);
  const cloudIds = ids.filter((id) => id !== LOCAL_CONNECTION_ID);
  const total = sumUsage(ids.map((id) => usage[id]));
  const cloud = sumUsage(cloudIds.map((id) => usage[id]));

  // Пока ни одного запроса не было, плитки сообщали бы четыре нуля — это не сводка, а шум.
  if (total.requests === 0) return null;

  const local = usage[LOCAL_CONNECTION_ID];

  async function reset(): Promise<void> {
    await window.oblako.resetAiUsage();
    setUsage(await window.oblako.aiUsage());
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3) }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: sp(3) }}>
        <CapsLabel>Расход {since(total.since)}</CapsLabel>
        <button onClick={() => void reset()} style={{ ...btnGhost, marginLeft: 'auto', fontSize: 'var(--fs-xs)' }}>
          Обнулить счёт
        </button>
      </div>

      <FactGrid>
        <Fact
          label="Запросов"
          hint={cloudIds.length === 0 ? 'все — на этой машине' : `наружу ушло ${cloud.requests}`}
          value={String(total.requests)}
          active
        />
        <Fact
          label="Токенов наружу"
          hint={cloud.requests === 0 ? 'облако не использовалось' : `на приём ${formatTokens(cloud.completionTokens)}`}
          value={formatTokens(totalTokens(cloud))}
        />
        <Fact
          label="Потрачено"
          // ⚠️ «Провайдер не сообщает» — не отговорка, а факт: цену возвращает по сути один
          // OpenRouter. Показать вместо неё «$0» значило бы соврать в самом чувствительном месте.
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
  return `с ${new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
}
