import { useEffect, useState } from 'react';

/**
 * Сколько записей в буфере скопированного со страниц.
 *
 * ⚠️ Число нужно не ради числа: кнопки буфера НЕТ, пока он пуст — на чистом сеансе она была бы
 * мёртвым значком, а тулбар и так тесный (тот же приём, что у индикатора товара).
 *
 * ⚠️ Спрашиваем текущее значение СРАЗУ, не дожидаясь первого изменения: закреплённые записи
 * поднимаются с диска при старте, и без этого запроса кнопка оставалась серой до первого
 * копирования — то есть достать закреплённое, ничего не скопировав, было нельзя.
 */
export function useClipboardCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => window.oblako.onClipboardChanged(setCount), []);
  useEffect(() => { void window.oblako.getClipboardCount().then(setCount); }, []);

  return count;
}
