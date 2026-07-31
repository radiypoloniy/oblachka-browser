import { app } from 'electron';

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
