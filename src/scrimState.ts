import { useEffect } from 'react';

// Учёт затемняющих слоёв поверх всего чрома (экран первого запуска, диалог импорта, модалка
// «Студии» блокнота).
//
// ⚠️ Зачем это вообще нужно. Зона системных кнопок Windows — не наш DOM, а нативный
// titleBarOverlay: Windows рисует её сама теми цветами, что мы задали через setTitleBarOverlay.
// CSS-затемнение до неё не дотягивается, и при открытой модалке светлый прямоугольник с
// «свернуть/развернуть/закрыть» оставался единственным незатемнённым местом на экране.
// Значит, о затемнении надо сказать main'у отдельно — этим и занят счётчик ниже.
//
// Счётчик, а не флаг: слои могут накладываться (диалог импорта поверх экрана первого запуска),
// и уход одного из них не должен возвращать титлбару светлый вид, пока висит второй.

let count = 0;
const listeners = new Set<(active: boolean) => void>();

function notify(): void {
  const active = count > 0;
  for (const cb of listeners) cb(active);
}

/** Пока компонент на экране — считаем, что чром затемнён. */
export function useScrim(): void {
  useEffect(() => {
    count += 1;
    notify();
    return () => { count -= 1; notify(); };
  }, []);
}

export function subscribeScrim(cb: (active: boolean) => void): () => void {
  listeners.add(cb);
  cb(count > 0);
  return () => { listeners.delete(cb); };
}

/**
 * Цвет под затемняющим слоем: тот же фон, но умноженный на непрозрачность scrim'а
 * (rgba(0,0,0,0.4) поверх непрозрачного цвета = цвет × 0.6). Считаем, а не подбираем на глаз:
 * иначе титлбар и фон разъедутся на первой же правке токенов.
 */
export function dimColor(hex: string, scrimAlpha = 0.4): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const k = 1 - scrimAlpha;
  const part = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) * k)
    .toString(16).padStart(2, '0');
  return `#${part(0)}${part(2)}${part(4)}`;
}
