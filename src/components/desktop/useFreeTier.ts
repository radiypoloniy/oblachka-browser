import { useEffect, useState } from 'react';
import { freeTierAllowed } from '../../../shared/genFree';
import { resolveRoute, LOCAL_ID, type RoutingTable } from '../../../shared/aiRouting';
import { capsFor } from '../../../shared/aiProviders';
import { aiBridge } from '../ai/bridge';
import type { AiConnectionsState } from '../../../shared/ipc';

/**
 * Соберёт ли виджет облачная модель разметкой (ярус 2) или локальная выберет тип из каталога.
 *
 * ⚠️ Спрашиваем МАРШРУТ РОЛИ, а не «есть ли вообще облако»: подпись под запросом обещает человеку,
 * ЧЕМ будет собран виджет, и обещание обязано совпасть с тем, что решит main
 * (electron/ipc/widgets.ts). Развилку по-прежнему делает main — здесь только слова.
 *
 * ⚠️ ПОДПИСКА, а не один вопрос при открытии. Метка модели стоит в той же шапке студии и меняет
 * маршрут на месте: без подписки человек переключил бы модель и читал бы под полем прежнее
 * обещание — то есть ровно ту ложь, ради которой этот хук и заведён.
 *
 * ⚠️ Правило «локально» берётся у capsFor, а не по типу подключения: Ollama на localhost — такое
 * же «здесь», как встроенная Qwen, и свободную разметку ей не поручают (см. shared/genFree.ts).
 */
export function useFreeTier(): boolean {
  const [free, setFree] = useState(false);
  useEffect(() => {
    const api = aiBridge();
    if (!api) return;
    let alive = true;
    const apply = (st: AiConnectionsState): void => {
      if (!alive) return;
      const localIds = st.connections.filter((c) => capsFor(c).local).map((c) => c.id);
      const route = resolveRoute('widgets', st.routing as RoutingTable, {
        connections: st.connections, ready: st.ready, localIds,
      });
      setFree(freeTierAllowed(route.connectionId === LOCAL_ID || localIds.includes(route.connectionId)));
    };
    void api.aiConnections().then(apply);
    const off = api.onAiConnectionsChanged(apply);
    return () => { alive = false; off(); };
  }, []);
  return free;
}
