// Браузер по умолчанию: проверка состояния и просьба к системе назначить нас.
//
// ⚠️ Главное ограничение, из-за которого здесь нет «просто сделай нас основным»: начиная с
// Windows 10 назначить браузер по умолчанию ПРОГРАММНО невозможно — UserChoice в реестре
// подписан хэшем, привязанным к пользователю и времени, и подделка его считается взломом
// (Windows такую запись сбрасывает). Ровно поэтому Chrome, Firefox и Edge в этом месте только
// открывают системные «Приложения по умолчанию». Мы делаем то же самое и говорим об этом
// человеку прямо, а не притворяемся, что нажали за него.
//
// Чтобы Oblako вообще ПОЯВИЛСЯ в том системном списке, приложение должно быть зарегистрировано
// в HKCU\Software\RegisteredApplications с Capabilities — это делает установщик
// (build/installer.nsh). В dev-режиме (запуск из node_modules/electron) регистрации нет, и это
// не поломка: с неупакованной сборкой Windows работать браузером по умолчанию и не станет.
//
// Платформенная часть заперта в этом модуле (см. CLAUDE.md, кроссплатформенность): на macOS
// тот же вопрос решается через LSSetDefaultHandlerForURLScheme, и меняться будет только тело
// функций, а не их вызовы.
import { app, shell } from 'electron';

export type DefaultBrowserRequest =
  | 'already'          // мы уже браузер по умолчанию — делать нечего
  | 'settings-opened'  // открыли системный выбор, дальше слово за человеком
  | 'unsupported';     // платформа/сборка, где просить бессмысленно (dev-режим)

// Проверяем по https: именно эта ассоциация определяет, кому система отдаёт ссылки.
// http проверять отдельно незачем — Windows назначает браузер сразу на обе схемы.
export function isDefaultBrowser(): boolean {
  try {
    return app.isDefaultProtocolClient('https');
  } catch {
    return false;
  }
}

export async function requestDefaultBrowser(): Promise<DefaultBrowserRequest> {
  if (isDefaultBrowser()) return 'already';
  if (process.platform !== 'win32') return 'unsupported';
  // Неупакованная сборка в системном списке не появится — незачем открывать окно, где нас нет.
  if (!app.isPackaged) return 'unsupported';

  // Регистрируем схемы за собой. Это НЕ делает нас браузером по умолчанию (см. выше), но
  // подтверждает системе, что мы такие ссылки открываем.
  try {
    app.setAsDefaultProtocolClient('https');
    app.setAsDefaultProtocolClient('http');
  } catch { /* реестр мог быть недоступен — системный диалог всё равно полезен */ }

  // ⚠️ Адрес с якорем на конкретное приложение (ms-settings:defaultapps?registeredAppUser=…)
  // Windows 11 понимает, а Windows 10 на нём открывает пустой раздел. Поэтому общий адрес:
  // он работает на обеих, а человеку остаётся выбрать Oblako в списке.
  await shell.openExternal('ms-settings:defaultapps');
  return 'settings-opened';
}
