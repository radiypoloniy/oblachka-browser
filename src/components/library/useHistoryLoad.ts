import { useEffect } from 'react';
import type { MutableRefObject } from 'react';

export function useHistoryLoad(load: () => Promise<void>, sequence: MutableRefObject<number>): void {
  useEffect(() => {
    void load();
    // Это счётчик запросов, не DOM-ref: инвалидируем последнее поколение при размонтировании,
    // чтобы ответ прежней вкладки/профиля не записал чужие данные в кэш.
    return () => { sequence.current += 1; };
  }, [load, sequence]);
}
