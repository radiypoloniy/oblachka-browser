import { app, type Session } from 'electron';

// Как браузер представляется сайтам.
//
// Зачем этот файл вообще есть: дефолтный UA Electron палит себя дважды — вписывает
// токен `Electron/40.x` и отдаёт ПОЛНУЮ версию движка (`Chrome/144.0.7559.236`),
// тогда как настоящий Chrome с 2022 года шлёт редуцированную `Chrome/144.0.0.0`.
// Любой антибот режет по этим двум признакам ещё до выполнения JS — у нас на этом
// намертво вставала капча Wildberries («Подозрительная активность», rwb.ru), при
// том что с того же IP другие браузеры пускало.
//
// Major версии берём из живого движка, а не хардкодим: если заявленная версия
// разъедется с реальным Chromium после апгрейда Electron — это сам по себе сигнал
// бота, а руками синхронизировать её никто не вспомнит.

// Платформенная часть UA. Вынесена отдельно, чтобы при macOS-порте правилась одна
// строка, а не поиск ОС-специфики по проекту (см. CLAUDE.md, кроссплатформенность).
// Значения — те, что реально шлёт Chrome: на Apple Silicon он всё равно пишет
// `Intel Mac OS X 10_15_7`, а на Windows 11 — `Windows NT 10.0` (обе строки заморожены).
function platformToken(): string {
  switch (process.platform) {
    case 'darwin':
      return 'Macintosh; Intel Mac OS X 10_15_7';
    case 'linux':
      return 'X11; Linux x86_64';
    default:
      return 'Windows NT 10.0; Win64; x64';
  }
}

export function chromeUserAgent(): string {
  const major = process.versions.chrome.split('.')[0];
  return (
    `Mozilla/5.0 (${platformToken()}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${major}.0.0.0 Safari/537.36`
  );
}

// Зовётся ДО app.whenReady() и до создания любых сессий: userAgentFallback —
// глобальный дефолт, его наследуют и defaultSession, и инкогнито-партиция.
// Точечные переопределения поверх (мобильный UA веб-приложений в WebAppManager)
// продолжают работать как раньше — они ставятся на конкретный webContents.
export function applyChromeUserAgent(): void {
  app.userAgentFallback = chromeUserAgent();
}

// ─── Клиентские подсказки (Sec-CH-UA) ───────────────────────────────────────
//
// ВТОРАЯ, независимая от строки UA идентификация браузера. Замерено на живой машине
// (эхо-сервер + один и тот же localhost-адрес):
//   Edge      → sec-ch-ua: "Not=A?Brand";v="99", "Microsoft Edge";v="151", "Chromium";v="151"
//               sec-ch-ua-mobile: ?0 | sec-ch-ua-platform: "Windows"
//   Electron  → НИ ОДНОГО из трёх заголовков, ни с нашей подменой UA, ни без неё.
// То есть подсказки гасит не applyChromeUserAgent(), их не шлёт сам Electron.
//
// Почему это чинить обязательно: мы представляемся строкой `Chrome/144.0.0.0`, а
// настоящий Chrome шлёт эти заголовки на КАЖДЫЙ запрос с 2022 года. «Chrome, который
// молчит про Sec-CH-UA» — это не Chrome, и проверка на встроенный браузер ловит нас
// раньше любого JS. Живой симптом: вход в аккаунт Google/YouTube отвечает «This browser
// or app may not be secure» при том, что сам сайт работает нормально.
//
// ⚠️ Мобильность и платформа выводятся из UA САМОГО запроса, а не из process.platform:
// веб-приложения панели и графа ставят себе мобильный UA на конкретный webContents
// (MOBILE_UA в WebAppManager.ts), и жёсткое "Windows" в подсказках противоречило бы
// строке UA у них — а расхождение этих двух источников само по себе признак подделки.
function brandList(): string {
  const major = process.versions.chrome.split('.')[0];
  // Порядок и GREASE-бренд взяты те же, что генерирует наш собственный движок для
  // navigator.userAgentData (замерено: `Not(A:Brand` v8, `Chromium` v144) — так заголовок
  // и JS-сторона расходятся минимально. `Google Chrome` добавлен, чтобы подсказки
  // соглашались со строкой UA, которая уже называет нас Chrome.
  return `"Not(A:Brand";v="8", "Chromium";v="${major}", "Google Chrome";v="${major}"`;
}

function platformHint(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    default:
      return 'Windows';
  }
}

// Вешается на сессию один раз. onBeforeSendHeaders свободен: адблок использует только
// onBeforeRequest/onHeadersReceived (проверено по @ghostery/adblocker-electron), так что
// мы ничей обработчик не вытесняем — но второго слушателя здесь заводить нельзя, Electron
// держит на сессию ровно один.
export function applyClientHints(sess: Session): void {
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    // Если Electron когда-нибудь начнёт слать подсказки сам — не дублируем и не спорим с ним.
    if (headers['Sec-CH-UA'] === undefined && headers['sec-ch-ua'] === undefined) {
      const ua = headers['User-Agent'] ?? headers['user-agent'] ?? '';
      const mobile = /\bMobile\b/.test(ua);
      headers['Sec-CH-UA'] = brandList();
      headers['Sec-CH-UA-Mobile'] = mobile ? '?1' : '?0';
      headers['Sec-CH-UA-Platform'] = `"${mobile ? 'Android' : platformHint()}"`;
    }
    callback({ requestHeaders: headers });
  });
}
