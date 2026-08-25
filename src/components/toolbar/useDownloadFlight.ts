import { useEffect, useState } from 'react';

/** Сколько длится полёт файла в кнопку загрузок. Совпадает с CSS-анимацией в разметке. */
const FLIGHT_MS = 820;

/**
 * Анимация «файл прилетел в кнопку загрузок».
 *
 * ⚠️ Состояние живёт ровно столько, сколько играет анимация, и это не небрежность: держать флаг
 * после окончания незачем, а CSS-анимация без размонтирования не перезапустится на вторую
 * загрузку подряд — вторая просто не была бы видна.
 *
 * @param tick счётчик начатых загрузок; 0 — стартовое значение, загрузок ещё не было.
 */
export function useDownloadFlight(tick: number): boolean {
  const [flying, setFlying] = useState(false);

  useEffect(() => {
    if (tick === 0) return;
    setFlying(true);
    const t = setTimeout(() => setFlying(false), FLIGHT_MS);
    return () => clearTimeout(t);
  }, [tick]);

  return flying;
}
