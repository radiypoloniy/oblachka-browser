import { useEffect, useRef, useState } from 'react';

// Управляет ли браузером прямо сейчас внешний агент (см. electron/mcp/).
//
// ⚠️ Хук, а не проп через Toolbar, и это не только правило храповика. Метка не имеет отношения к
// адресной строке и её состоянию: она про то, что происходит СНАРУЖИ окна. Протаскивать её через
// компонент, который про внешние программы ничего не знает, значило бы связать два несвязанных
// куска ради одной строки.
//
// ⚠️ Живёт по ПУШУ, а не по опросу: вызов приходит редко, а метка обязана появляться в момент
// вызова. Опрос раз в секунду — это работа, которая идёт всегда, ради события, которого почти
// никогда нет.

/** Сколько метка держится после последнего вызова. Меньше — мигает, больше — врёт про «сейчас». */
const HOLD_MS = 6000;

export interface McpAgentState {
  /** Идёт обращение прямо сейчас (последние секунды). */
  active: boolean;
  /** Как назвалась программа — для подсказки. */
  client: string;
  /** Что она позвала последним. */
  tool: string;
}

export function useMcpAgent(): McpAgentState {
  const [state, setState] = useState<McpAgentState>({ active: false, client: '', tool: '' });
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const off = window.oblako.onMcpActivity((call) => {
      setState({ active: true, client: call.client, tool: call.tool });
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(
        () => setState((s) => ({ ...s, active: false })),
        HOLD_MS,
      );
    });
    return () => {
      off();
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  return state;
}
