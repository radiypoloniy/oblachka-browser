import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { RefObject } from 'react';
import type { SearchEngineId } from '../../../shared/searchEngines';
import { setDefaultSearchEngine } from '../../searchEngineSetting';

/**
 * Меню выбора поисковика у капсулы в омнибоксе.
 *
 * ⚠️ Капсула живёт ТОЛЬКО на хабе: на обычной странице в адресной строке стоит её адрес, и
 * менять там поисковик не к чему. Отсюда сброс при уходе с хаба — иначе меню осталось бы
 * висеть над чужой страницей.
 *
 * ⚠️ Своей копии выбранного движка здесь нет: `setDefaultSearchEngine` пишет в main, а обратно
 * значение приходит подпиской (см. useSearchEngine). Вторая правда на время круга IPC уже была,
 * и она давала мигание капсулы.
 */
export function useEngineMenu(isHub: boolean): {
  open: boolean;
  /** Принимает и значение, и функцию от прошлого: в разметке меню переключают тумблером. */
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  btnRef: RefObject<HTMLButtonElement>;
  pick: (id: SearchEngineId) => void;
} {
  const [open, setOpen] = useState(false);
  // ⚠️ RefObject<HTMLButtonElement>, а не <… | null>: ref уезжает прямо в JSX, а разметка в
  // React 18 принимает только первый вид.
  const btnRef = useRef<HTMLButtonElement>(null) as RefObject<HTMLButtonElement>;

  useEffect(() => { if (!isHub) setOpen(false); }, [isHub]);

  const pick = useCallback((id: SearchEngineId) => {
    setOpen(false);
    setDefaultSearchEngine(id);
  }, []);

  return { open, setOpen, btnRef, pick };
}
