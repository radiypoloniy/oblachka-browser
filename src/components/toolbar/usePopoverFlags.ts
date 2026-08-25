import type React from 'react';
import { useEffect, useState } from 'react';

export interface PopoverFlags {
  password: boolean;
  downloads: boolean;
  clipboard: boolean;
  site: boolean;
  setPassword: (v: boolean) => void;
  setDownloads: (v: boolean) => void;
  /** Принимает и значение, и функцию от прошлого: буфер переключается тумблером. */
  setClipboard: React.Dispatch<React.SetStateAction<boolean>>;
  /** Тем же видом: состояние карточки сайта приходит ответом самого toggle. */
  setSite: React.Dispatch<React.SetStateAction<boolean>>;
  /** Закрыть все, кроме названного: двум поповерам в тулбаре одновременно места нет. */
  closeOthers: (keep: 'password' | 'downloads' | 'clipboard' | 'site') => void;
}

/**
 * Открыт ли каждый из четырёх поповеров тулбара — и синхронизация с main.
 *
 * ⚠️ Флаг здесь ЗЕРКАЛО, а не источник правды: поповер живёт своей WebContentsView, и закрыть её
 * может сам main — по Esc, по потере фокуса окна, по переключению вкладки. Без подписок на
 * «закрылся» кнопка осталась бы подсвеченной над уже исчезнувшим поповером.
 *
 * ⚠️ Подписки одинаковые по форме, но каналы разные: у каждого поповера свой менеджер в main
 * (см. *PopoverManager.ts), общего «закрылся какой-то» канала нет и заводить его незачем — он
 * потребовал бы имени поповера в полезной нагрузке, то есть того же самого другими словами.
 */
export function usePopoverFlags(): PopoverFlags {
  const [password, setPassword] = useState(false);
  const [downloads, setDownloads] = useState(false);
  const [clipboard, setClipboard] = useState(false);
  const [site, setSite] = useState(false);

  useEffect(() => window.oblako.onPasswordPopoverClosed(() => setPassword(false)), []);
  useEffect(() => window.oblako.onDownloadsPopoverClosed(() => setDownloads(false)), []);
  useEffect(() => window.oblako.onClipboardPopoverClosed(() => setClipboard(false)), []);
  useEffect(() => window.oblako.onSitePopoverClosed(() => setSite(false)), []);

  const closeOthers = (keep: 'password' | 'downloads' | 'clipboard' | 'site'): void => {
    if (keep !== 'password' && password) {
      setPassword(false);
      void window.oblako.closePasswordPopover();
    }
    if (keep !== 'downloads' && downloads) {
      setDownloads(false);
      void window.oblako.closeDownloadsPopover();
    }
    // ⚠️ У буфера и карточки сайта закрытие — ТОГГЛ того же канала, а не отдельный close:
    // состояние обоих держит main и отвечает им же.
    if (keep !== 'clipboard' && clipboard) {
      setClipboard(false);
      void window.oblako.toggleClipboardPopover();
    }
    if (keep !== 'site' && site) {
      setSite(false);
      void window.oblako.toggleSitePopover();
    }
  };

  return {
    password, downloads, clipboard, site,
    setPassword, setDownloads, setClipboard, setSite,
    closeOthers,
  };
}
