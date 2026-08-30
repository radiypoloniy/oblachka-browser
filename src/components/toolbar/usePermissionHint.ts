import { useEffect, useState } from 'react';

/**
 * Что показать на щите про текущий сайт: 'ask' — вопрос висит без ответа, 'blocked' — сайту
 * молча отказали по прежнему решению.
 *
 * ⚠️ Заведено под живую жалобу «не понимаю, почему те или иные действия не проходят». Запомненный
 * запрет отвечает сайту `false` и не показывает ничего: кнопка на странице просто не работает.
 * Точка на щите — единственный след, и она же ведёт туда, где чинится: поповер сайта умеет
 * откатывать решения.
 *
 * ⚠️ Запрос по origin, а не подписка на состояние: у main нет причин знать, какая вкладка сейчас
 * активна в каждом окне, а хром и так пересчитывает адрес на каждой навигации. Push из main —
 * это только сигнал «перечитай», без данных.
 */
export function usePermissionHint(url: string): 'ask' | 'blocked' | null {
  const [hint, setHint] = useState<'ask' | 'blocked' | null>(null);

  useEffect(() => {
    let alive = true;
    let origin = '';
    try { origin = new URL(url).origin; } catch { origin = ''; }
    const read = () => {
      if (!origin) { setHint(null); return; }
      void window.oblako.permissionHint(origin).then((h) => { if (alive) setHint(h); });
    };
    read();
    const off = window.oblako.onPermissionHintChanged(read);
    return () => { alive = false; off(); };
  }, [url]);

  return hint;
}
