import { useEffect, useState } from 'react';
import type { PasswordIndicatorState } from '../../../shared/ipc';

// ── Индикатор менеджера паролей в адресной строке ────────────────────────────
//
// Ключик у строки: main сообщает, что под курсором форма входа с известным паролем, а поповер
// показывает содержимое этого состояния.
//
// ⚠️ Третий шов, вырезанный из Toolbar.tsx (после панели нетронутой строки и подсказок по тексту).
// Самый маленький и самый безопасный из оставшихся: два эффекта, одно состояние, ни одной связи
// с фокусом и черновиками — то есть ровно то, что можно снять, не трогая опасную часть файла.
//
// ⚠️ Якорь и клик мимо здесь НЕ живут — их держит useAnchoredPopover, как у трёх соседних
// поповеров тулбара. Здесь остаётся то, чего у соседей нет: СОДЕРЖИМОЕ.

/**
 * @param open    открыт ли поповер паролей прямо сейчас
 * @param setOpen закрыть его, когда индикатор погас (форма ушла со страницы)
 * @returns состояние индикатора; null — под курсором нет формы входа, ключик погашен
 */
export function usePasswordIndicator(
  open: boolean, setOpen: (v: boolean) => void,
): PasswordIndicatorState | null {
  const [state, setState] = useState<PasswordIndicatorState | null>(null);

  // ⚠️ Подписка ставится ОДИН раз на жизнь тулбара, поэтому setOpen читается из замыкания первого
  // рендера. Он приходит из usePopoverFlags и стабилен; пересоздавать подписку на каждый рендер
  // значило бы ловить окно «старый слушатель снят, новый не поставлен» ровно в момент, когда
  // страница сообщает про форму входа.
  useEffect(() => {
    return window.oblako.onPasswordIndicatorChanged((next) => {
      setState(next);
      if (!next) {
        setOpen(false);
        void window.oblako.closePasswordPopover();
      }
    });
  }, [setOpen]);

  // ⚠️ Индикатор мог смениться, пока поповер открыт (другое поле, другой аккаунт), и тогда ему
  // нужно новое состояние — иначе он показывал бы прошлое.
  useEffect(() => {
    if (!open || !state) return;
    void window.oblako.showPasswordPopover(state);
  }, [open, state]);

  return state;
}
