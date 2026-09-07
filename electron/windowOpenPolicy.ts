import type { PostBody, Referrer, WebContentsView } from 'electron';
import { isExternalAppUrl } from './ExternalProtocol';
import { hostOfUrl } from '../shared/rules';

// Политика window.open / target=_blank: новая вкладка вместо окна, кроме настоящих попапов.
//
// ⚠️ Отдельным файлом, а не методом TabManager, по той же причине, что и pageContextMenu.ts: это
// ЗАМКНУТОЕ РЕШЕНИЕ («окно или вкладка, и в какой сессии»), которое ничего не знает про дерево
// вкладок, split, усыпление и автосейв. С менеджером его связывают четыре вызова при семидесяти
// строках разбора — самый узкий шов, какой в TabManager остался после меню.

export interface WindowOpenHost {
  /** Ссылка в чужое приложение (sbolpay:, tg:) — её открывает не браузер, а ОС. */
  externalOpen(url: string, fromUrl: string, wcId: number): void;
  /** Приватна ли вкладка, из которой открывают: приватная открывает приватную. */
  isIncognito(tabId: string): boolean;
  /** Новая вкладка. Возвращает id — он нужен для учёта происхождения. */
  openTab(
    url: string,
    background: boolean,
    ephemeral: boolean,
    incognito: boolean,
    postBody?: PostBody,
    referrer?: Referrer,
  ): string;
  /** Запомнить, с какого сайта и из какой вкладки родилась новая. */
  noteOpened(openedId: string, fromHost: string, openerId: string): void;
}

export function wireWindowOpenPolicy(host: WindowOpenHost, id: string, view: WebContentsView): void {
  const wc = view.webContents;

  // Политика окон: target=_blank / window.open -> НОВАЯ ВКЛАДКА, не окно — КРОМЕ настоящих
  // попапов (см. ниже). disposition='background-tab' = средний клик/Ctrl+клик → фон (стандарт браузеров).
  wc.setWindowOpenHandler(({ url, frameName, disposition, features, postBody, referrer }) => {
    // Ссылка в чужое приложение (sbolpay:, tg:, …) может прийти и сюда — платёжные страницы
    // часто открывают её новым окном, а не переходом. Вкладку по такой схеме заводить нельзя:
    // Chromium её не откроет, останется пустая вкладка с ошибкой.
    if (isExternalAppUrl(url)) {
      host.externalOpen(url, wc.getURL(), wc.id);
      return { action: 'deny' };
    }
    // OAuth-попап (Google/Firebase и т.п.) открывается ИМЕННО так: window.open(url, name,
    // 'width=…,height=…') → disposition='new-window' + width/height в features. Это единственный
    // надёжный сигнал «это попап, а не просто открытие в новой вкладке» — обычные target=_blank/
    // window.open(url) без размерных фич дают 'foreground-tab'/'background-tab'/'default'.
    //
    // Такому попапу нужно НАСТОЯЩЕЕ дочернее окно с живым window.opener — OAuth-провайдер в конце
    // шлёт window.opener.postMessage(token) родителю. Если вместо этого создать нашу вкладку
    // (как раньше), opener окажется пустым и логин молча не долетит до родителя (см. диагностику
    // прошлого шага). Поэтому здесь action:'allow' — Chromium сам создаёт связанное окно;
    // details.features уже содержит width/height, Electron распарсит их сам.
    // ⚠️ ИМЕНОВАННОЕ окно — тоже настоящее окно, а не наша вкладка. Имя в window.open(url, 'pay')
    // сайт даёт не для красоты: по нему он потом ищет своё окно и разговаривает с ним через
    // window.opener/postMessage. Нашей вкладке opener взять неоткуда, и разговор обрывается —
    // ровно так ломаются возвраты со страниц оплаты («деньги списались, магазин не узнал»).
    // Служебные имена (_blank и товарищи) именами не считаются: там handle никому не нужен.
    const RESERVED = new Set(['', '_blank', '_self', '_top', '_parent']);
    const named = !RESERVED.has((frameName || '').toLowerCase());
    const sized = /(?:^|,)\s*(width|height)\s*=/.test(features);
    const wantsRealWindow = named || (disposition === 'new-window' && sized);
    if (wantsRealWindow) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true, // не наш кастомный хром — просто обычное окно ОС без лишнего UI
          // Менеджер паролей, шаг 2: сканер форм (CONTENT_PRELOAD_PATH) сюда НЕ подключаем —
          // это окно вне tabMap/wirePageEvents (сторонний OAuth-провайдер, не сайт пользователя),
          // осознанно за скобками v1, см. план.
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    // ⚠️ postBody и referrer передаём ОБЯЗАТЕЛЬНО, и это ОДНА починка в двух половинах: отказав
    // Chromium в его окне (action:'deny'), мы переоткрываем адрес своим loadURL, то есть начинаем
    // навигацию с нуля — всё, что Chromium к ней подготовил, остаётся здесь, в details.
    // Без тела POST формы с target=_blank вырождался в GET, и шлюз возвращал человека в магазин
    // вместо страницы банка (воспроизведено на стенде, оплата по СБП). Без Referer панели биллинга
    // (BILLmanager и родня), сверяющие источник, видят POST «ниоткуда» и показывают
    // «Подтверждение опасной операции» вместо оплаты — симптом плавал, сайты без сверки работали.
    // Полей у details ровно шесть, и теперь не теряется ни одно: url, frameName, features и
    // disposition разобраны выше, postBody и referrer уходят во вкладку.
    const openedId = host.openTab(
      url,
      disposition === 'background-tab',
      disposition === 'new-window',
      host.isIncognito(id), // приватная вкладка открывает приватную
      postBody,
      referrer,
    );
    // «Перешёл по ссылке с сайта X» — для новой вкладки источник это страница, которая её
    // открыла: своего предыдущего адреса у неё ещё нет.
    host.noteOpened(openedId, hostOfUrl(wc.getURL()), id);
    return { action: 'deny' };
  });
  // Настоящее окно OAuth-попапа (action:'allow' выше) Electron создаёт и закрывает сам —
  // оно НЕ регистрируется в tabMap/nodes, никак не завязано на автосейв/дерево вкладок Oblako.
}
