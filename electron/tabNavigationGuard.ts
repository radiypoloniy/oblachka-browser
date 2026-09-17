import type { WebContents } from 'electron';
import { isGuestNavigable } from '../shared/guestNavigation';

/**
 * Запрет привилегированных схем в гостевой странице. Хук не проверяет текущего владельца вкладки:
 * после передачи в другое окно запрет обязан остаться на том же WebContents.
 *
 * ⚠️ Обе подписки обязательны: will-navigate не перехватывает серверный редирект.
 * `file:` разрешается лишь из другого `file:` самим isGuestNavigable; программная загрузка из
 * омнибокса через loadURL этим хуком не затрагивается.
 */
export function wireTabNavigationGuard(wc: WebContents): void {
  const guard = (event: Electron.Event, target: string): void => {
    if (!isGuestNavigable(target, wc.getURL())) {
      event.preventDefault();
      console.warn('[TabMgr] навигация на привилегированную схему запрещена:', target.slice(0, 120));
    }
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
}
