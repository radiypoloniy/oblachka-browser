import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import type { PasswordIndicatorState } from '../../../shared/ipc';
import { useAnchoredPopover } from './useAnchoredPopover';
import type { PopoverFlags } from './usePopoverFlags';

/**
 * Четыре поповера тулбара: пароли, загрузки, буфер, карточка сайта.
 *
 * ⚠️ Все четыре живут ОДНОЙ механикой (useAnchoredPopover): якорь-кнопка, прямоугольник в main,
 * наблюдатель за размером и закрытие по клику мимо. Держать её четырьмя почти одинаковыми
 * кусками посреди тулбара — верный способ однажды поправить три из четырёх.
 *
 * ⚠️ Флаги (usePopoverFlags) приезжают снаружи и остаются ЗЕРКАЛОМ: поповер живёт своей
 * WebContentsView, и закрыть её может сам main. Этот хук решает только «что делать по нажатию».
 */
export function useToolbarPopovers({
  popovers, closeDropdownFully, passwordIndicator, toolbarWidth,
  passwordControlRef, downloadsControlRef, clipboardControlRef, siteControlRef,
}: {
  popovers: PopoverFlags;
  closeDropdownFully: (reason: string) => void;
  passwordIndicator: PasswordIndicatorState | null;
  /** Ширина тулбара: якоря переезжают от ресайза окна и сворачивания сайдбара. */
  toolbarWidth: number;
  passwordControlRef: React.RefObject<HTMLDivElement>;
  downloadsControlRef: React.RefObject<HTMLDivElement>;
  clipboardControlRef: React.RefObject<HTMLDivElement>;
  siteControlRef: React.RefObject<HTMLButtonElement>;
}) {
  // Четыре поповера тулбара живут одной механикой (см. useAnchoredPopover): якорь-кнопка,
  // прямоугольник в main, наблюдатель за размером и закрытие по клику мимо.
  const dismissPassword = useCallback(() => {
    popovers.setPassword(false);
    void window.oblako.closePasswordPopover();
  }, []);
  const { pushBounds: pushPasswordPopoverBounds } = useAnchoredPopover({
    anchorRef: passwordControlRef,
    open: popovers.password,
    push: (b: { x: number; y: number; width: number; height: number }) => { void window.oblako.setPasswordPopoverAnchorBounds(b); },
    onDismiss: dismissPassword,
    reflowKey: toolbarWidth,
  });

  const togglePasswordPopover = useCallback(() => {
    if (!passwordIndicator) return;
    closeDropdownFully('password-indicator');
    if (popovers.password) {
      popovers.setPassword(false);
      void window.oblako.closePasswordPopover();
      return;
    }
    pushPasswordPopoverBounds();
    popovers.setPassword(true);
    void window.oblako.showPasswordPopover(passwordIndicator);
  }, [closeDropdownFully, passwordIndicator, popovers.password, pushPasswordPopoverBounds]);

  const dismissDownloads = useCallback(() => {
    popovers.setDownloads(false);
    void window.oblako.closeDownloadsPopover();
  }, []);
  const { pushBounds: pushDownloadsPopoverBounds } = useAnchoredPopover({
    anchorRef: downloadsControlRef,
    open: popovers.downloads,
    push: (b: { x: number; y: number; width: number; height: number }) => { void window.oblako.setDownloadsPopoverAnchorBounds(b); },
    onDismiss: dismissDownloads,
    reflowKey: toolbarWidth,
  });

  const toggleDownloadsPopover = useCallback(() => {
    closeDropdownFully('downloads-button');
    // Двум поповерам в тулбаре одновременно места нет — открывая один, гасим соседей.
    popovers.closeOthers('downloads');
    if (popovers.downloads) {
      popovers.setDownloads(false);
      void window.oblako.closeDownloadsPopover();
      return;
    }
    pushDownloadsPopoverBounds();
    popovers.setDownloads(true);
    void window.oblako.showDownloadsPopover();
  }, [closeDropdownFully, popovers.password, popovers.site, popovers.downloads, popovers.clipboard, pushDownloadsPopoverBounds]);

  const toggleClipboardPopover = useCallback(() => {
    closeDropdownFully('clipboard-button');
    popovers.closeOthers('clipboard');
    const el = clipboardControlRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      window.oblako.syncClipboardPopoverBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
    }
    popovers.setClipboard((v) => !v);
    void window.oblako.toggleClipboardPopover();
  }, [closeDropdownFully, popovers.password, popovers.site, popovers.downloads]);

  // Вопрос «этот файл уже скачан» — открываем поповер загрузок ровно тем же путём, что по клику
  // (с якорем и подсветкой кнопки). Сам вопрос уже лежит в main, карточка заберёт его сама.
  useEffect(() => window.oblako.onDownloadDuplicateAsk(() => {
    pushDownloadsPopoverBounds();
    popovers.setDownloads(true);
    void window.oblako.showDownloadsPopover();
  }), [pushDownloadsPopoverBounds]);

  // ── Поповер сведений о сайте (замочек слева в омнибоксе) ──────────────────────────────────
  // Раньше замок был просто картинкой. Теперь это точка входа в «что за сайт передо мной»:
  // защищено ли соединение, что ему разрешено, сколько вырезано трекеров и что похожего вы уже
  // читали. Механика ровно та же, что у поповеров VPN и загрузок — своя вью, якорь, клик мимо.
  // ⚠️ У карточки сайта закрытие — ТОГГЛ того же канала, а не отдельный close: main держит её
  // состояние у себя и отвечает им же (см. toggleSitePopover ниже).
  const dismissSite = useCallback(() => {
    popovers.setSite(false);
    void window.oblako.toggleSitePopover();
  }, []);
  const dismissClipboard = useCallback(() => {
    popovers.setClipboard(false);
    void window.oblako.toggleClipboardPopover();
  }, []);
  // ⚠️ Наблюдатель за якорем буфера нужен и теперь, когда кнопка перестала появляться-исчезать:
  // её прямоугольник всё равно ездит от ресайза окна и сворачивания сайдбара.
  useAnchoredPopover({
    anchorRef: clipboardControlRef,
    open: popovers.clipboard,
    push: (b: { x: number; y: number; width: number; height: number }) => { window.oblako.syncClipboardPopoverBounds(b); },
    onDismiss: dismissClipboard,
    reflowKey: toolbarWidth,
  });

  const { pushBounds: pushSitePopoverBounds } = useAnchoredPopover({
    anchorRef: siteControlRef,
    open: popovers.site,
    push: (b: { x: number; y: number; width: number; height: number }) => { void window.oblako.setSitePopoverAnchorBounds(b); },
    onDismiss: dismissSite,
    reflowKey: toolbarWidth,
  });


  const toggleSitePopover = useCallback(() => {
    closeDropdownFully('site-button');
    popovers.closeOthers('site');
    pushSitePopoverBounds();
    // Состояние приходит ответом самого toggle — второго источника правды не заводим.
    void window.oblako.toggleSitePopover().then(popovers.setSite);
  }, [closeDropdownFully, popovers.password, popovers.site, popovers.downloads, popovers.clipboard, pushSitePopoverBounds]);

  // Клик по полоске сайта В ПАНЕЛИ омнибокса — открываем тот же поповер, что и замочек. Через
  // ref, а не прямой зависимостью: подписка ставится один раз, а toggleSitePopover пересоздаётся
  // при каждом изменении состояния поповеров (тот же приём, что у pickSuggestionRef ниже).
  const toggleSitePopoverRef = useRef(toggleSitePopover);
  toggleSitePopoverRef.current = toggleSitePopover;
  useEffect(() => window.oblako.onSuggestDropdownSiteInfo(() => { toggleSitePopoverRef.current(); }), []);


  return { togglePasswordPopover, toggleDownloadsPopover, toggleClipboardPopover, toggleSitePopover };
}
