import { execFileSync } from 'node:child_process';

// Windows DPAPI-разворачивание (CryptUnprotectData) для расшифровки мастер-ключа паролей Chromium
// из Local State. В Node нет встроенного CryptUnprotectData, а тащить нативную зависимость ради
// одного вызова на импорт — избыточно (см. CLAUDE.md: не добавлять зависимости без явной нужды).
// Поэтому шеллимся в PowerShell к [ProtectedData]::Unprotect — блоб маленький (ключ ~32-100 байт),
// вызов ОДИН на весь импорт паролей.
//
// Платформенная изоляция (прицел на macOS-порт, CLAUDE.md): DPAPI — Windows-специфика. На macOS
// Chromium хранит ключ в Keychain — там будет другая реализация этого же интерфейса. Общий код
// импорта паролей (ChromiumPasswordReader) знает только dpapiUnprotect(): Buffer|null.

// CurrentUser scope — Chrome шифрует encrypted_key именно в контексте текущего пользователя
// (для v10/v11). Мы запускаемся тем же пользователем, поэтому Unprotect проходит без прав SYSTEM.
export function dpapiUnprotect(data: Buffer): Buffer | null {
  if (process.platform !== 'win32') return null; // macOS/Linux — не DPAPI, отдельная реализация позже
  try {
    // Блоб передаём через переменную окружения, а не аргументом командной строки — так нет проблем
    // с экранированием/длиной и байты не мелькают в списке процессов.
    const script =
      '$b=[Convert]::FromBase64String($env:OBLAKO_DPAPI_BLOB);' +
      '$d=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,' +
      "[System.Security.Cryptography.DataProtectionScope]::CurrentUser);" +
      '[Convert]::ToBase64String($d)';
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        env: { ...process.env, OBLAKO_DPAPI_BLOB: data.toString('base64') },
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
      },
    );
    const b64 = out.trim();
    if (!b64) return null;
    return Buffer.from(b64, 'base64');
  } catch (e) {
    console.warn('[Import] DPAPI unprotect не удался:', (e as Error).message);
    return null;
  }
}
