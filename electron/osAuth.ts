import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Подтверждение личности через ОС перед показом/копированием пароля (доп. мера безопасности, как
// «введите код Windows» у Яндекса). Платформенная изоляция под macOS-порт (CLAUDE.md): наружу —
// только verifyUser(): 'ok' | 'denied' | 'unavailable'. Windows-реализация — нативный диалог
// «Безопасность Windows» (CredUIPromptForWindowsCredentials) + проверка пароля через LogonUser.
// Пароль Windows вводится в системном окне и НИКОГДА не попадает ни в наш JS, ни в IPC — валидация
// целиком внутри PowerShell-хелпера, наружу выходит только код результата.
//
// Fail-safe: 'denied' (неверный пароль/отмена) — показ запрещаем; 'unavailable' (механизм недоступен
// — не Windows, сбой запуска, невозможно провалидировать) — вызывающая сторона решает открыть (не
// лочим пользователя от собственных паролей), плюс есть тумблер в настройках.

export type OsAuthResult = 'ok' | 'denied' | 'unavailable';

// Коды из C#-хелпера ниже: 0=ok, 1=неверный пароль, 2=отмена, 3=механизм недоступен/не провалидировать.
function mapCode(code: number): OsAuthResult {
  switch (code) {
    case 0: return 'ok';
    case 1: case 2: return 'denied';
    default: return 'unavailable';
  }
}

// C#-хелпер (Add-Type в PowerShell). CREDUIWIN_GENERIC (0x1) — собрать логин/пароль; затем
// CredUnPackAuthenticationBuffer → LogonUser (LOGON32_LOGON_NETWORK=3, быстрая проверка без сессии).
// ERROR_CANCELLED(1223)→2, ERROR_LOGON_FAILURE(1326)→1, прочее→3.
function buildPsScript(caption: string, message: string): string {
  const esc = (s: string) => s.replace(/'/g, "''"); // одинарные кавычки для PowerShell-строк
  return `
$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class OblakoOsAuth {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct CREDUI_INFO { public int cbSize; public IntPtr hwndParent; public string pszMessageText; public string pszCaptionText; public IntPtr hbmBanner; }
  [DllImport("credui.dll", CharSet=CharSet.Unicode)]
  static extern int CredUIPromptForWindowsCredentials(ref CREDUI_INFO uiInfo, int authError, ref uint authPackage, IntPtr InAuthBuffer, uint InAuthBufferSize, out IntPtr refOutAuthBuffer, out uint refOutAuthBufferSize, ref bool fSave, int flags);
  [DllImport("credui.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CredUnPackAuthenticationBuffer(int dwFlags, IntPtr pAuthBuffer, uint cbAuthBuffer, StringBuilder pszUserName, ref int pcchMaxUserName, StringBuilder pszDomainName, ref int pcchMaxDomainName, StringBuilder pszPassword, ref int pcchMaxPassword);
  [DllImport("ole32.dll")] static extern void CoTaskMemFree(IntPtr ptr);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool LogonUser(string user, string domain, string pass, int logonType, int logonProvider, out IntPtr token);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  public static int Verify(string caption, string message) {
    CREDUI_INFO info = new CREDUI_INFO();
    info.cbSize = Marshal.SizeOf(typeof(CREDUI_INFO));
    info.pszCaptionText = caption;
    info.pszMessageText = message;
    info.hwndParent = IntPtr.Zero;
    uint authPackage = 0; IntPtr outBuf; uint outSize; bool save = false;
    int res = CredUIPromptForWindowsCredentials(ref info, 0, ref authPackage, IntPtr.Zero, 0, out outBuf, out outSize, ref save, 0x1);
    if (res == 1223) return 2;
    if (res != 0) return 3;
    var user = new StringBuilder(513); var dom = new StringBuilder(513); var pass = new StringBuilder(513);
    int cu = 513, cd = 513, cp = 513;
    bool ok = CredUnPackAuthenticationBuffer(0, outBuf, outSize, user, ref cu, dom, ref cd, pass, ref cp);
    if (outBuf != IntPtr.Zero) CoTaskMemFree(outBuf);
    if (!ok) return 3;
    string u = user.ToString(); string d = dom.ToString();
    string domain = string.IsNullOrEmpty(d) ? "." : d;
    if (u.Contains("@")) domain = null; // UPN — домен NULL
    IntPtr token;
    bool valid = LogonUser(u, domain, pass.ToString(), 3, 0, out token);
    int err = Marshal.GetLastWin32Error();
    if (valid) { CloseHandle(token); return 0; }
    if (err == 1326) return 1; // неверные учётные данные
    return 3;                  // не смогли провалидировать (напр. краевой случай MS-аккаунта)
  }
}
'@
Add-Type -TypeDefinition $src -Language CSharp
[OblakoOsAuth]::Verify('${esc(caption)}', '${esc(message)}')
`;
}

export function verifyUser(caption: string, message: string): Promise<OsAuthResult> {
  if (process.platform !== 'win32') return Promise.resolve('unavailable');

  return new Promise<OsAuthResult>((resolve) => {
    let tmpFile: string | null = null;
    try {
      tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oblako-osauth-')), 'auth.ps1');
      fs.writeFileSync(tmpFile, buildPsScript(caption, message), 'utf8');
    } catch {
      resolve('unavailable');
      return;
    }

    const cleanup = () => {
      try { if (tmpFile) fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true }); } catch { /* ОС уберёт */ }
    };

    // Диалог ждёт пользователя — таймаут щедрый; на превышении считаем «не подтвердил» (denied).
    const child = execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', tmpFile],
      { windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        cleanup();
        if (err) {
          // timeout киллит процесс → err.killed; трактуем как «не подтвердил».
          resolve((err as NodeJS.ErrnoException & { killed?: boolean }).killed ? 'denied' : 'unavailable');
          return;
        }
        const code = Number.parseInt(String(stdout).trim(), 10);
        resolve(Number.isNaN(code) ? 'unavailable' : mapCode(code));
      },
    );
    child.on('error', () => { cleanup(); resolve('unavailable'); });
  });
}
