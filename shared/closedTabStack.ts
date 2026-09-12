// Стек закрытых вкладок окна — то, откуда Ctrl+Shift+T берёт адрес, и то же самое
// показывает панель омнибокса в строках «Продолжить».
//
// ⚠️ Чистые функции над массивом, а не класс: проверка гоняется голым node, а TabManager
// только хранит снимок. Форма записи одна — адрес, заголовок, время закрытия: без заголовка
// строка панели вырождается в URL, без времени нельзя написать «2 мин назад».

export const CLOSED_STACK_MAX = 10;

export interface ClosedTab {
  url: string;
  title: string;
  closedAt: number;
}

/** Новые сверху стека (конец массива) — как у Ctrl+Shift+T: pop снимает последнюю. */
export function pushClosed(stack: ClosedTab[], tab: ClosedTab): ClosedTab[] {
  if (!/^https?:\/\//i.test(tab.url)) return stack;
  const next = stack.concat(tab);
  return next.length > CLOSED_STACK_MAX ? next.slice(next.length - CLOSED_STACK_MAX) : next;
}

export function popClosed(stack: ClosedTab[]): { tab: ClosedTab | undefined; rest: ClosedTab[] } {
  if (stack.length === 0) return { tab: undefined, rest: stack };
  return { tab: stack[stack.length - 1], rest: stack.slice(0, -1) };
}

/** Самые свежие первыми — так их рисует панель. */
export function peekClosed(stack: ClosedTab[]): ClosedTab[] {
  const out: ClosedTab[] = [];
  for (let i = stack.length - 1; i >= 0; i--) out.push(stack[i]);
  return out;
}
