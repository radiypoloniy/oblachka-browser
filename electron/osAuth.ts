import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Подтверждение личности через ОС перед показом/копированием пароля (доп. мера безопасности, как
// «код Windows» у Яндекса). Платформенная изоляция под macOS-порт (CLAUDE.md): наружу — только
// verifyUser(): 'ok' | 'denied' | 'unavailable'.
//
// Windows-реализация — Windows Hello (WinRT UserConsentVerifier.RequestVerificationAsync): PIN,
// биометрия ИЛИ пароль — что настроено у пользователя. Это единственный способ, который валидирует
// современный вход (PIN/Microsoft-аккаунт); прежний CredUIPromptForWindowsCredentials + LogonUser
// НЕ работал: LogonUser не проверяет PIN/MSA и всегда возвращал ошибку → фича молча пропускала.
// WinRT дёргаем из PowerShell через нативный доступ к типу ([Type,Assembly,ContentType=
// WindowsRuntime]) и AsTask-рефлексию для ожидания IAsyncOperation — Add-Type с C# тут не годится
// (не находит WinMD-ссылки).
//
// Fail-safe: 'denied' (отмена/исчерпаны попытки/таймаут) — показ запрещаем; 'unavailable' (Hello
// не настроен/недоступен/сбой) — вызывающая сторона разрешает (не лочим доступ к своим паролям),
// плюс есть тумблер в настройках.

export type OsAuthResult = 'ok' | 'denied' | 'unavailable';

// Строки — значения enum UserConsentVerificationResult (+ наш 'Timeout'). Verified → пустил;
// отмена/исчерпание/таймаут → отказ; всё прочее (нет устройства, не настроено, запрещено политикой,
// занято) → механизм недоступен, наверх это трактуется как «разрешить» (fail-open).
function mapResult(token: string): OsAuthResult {
  switch (token) {
    case 'Verified': return 'ok';
    case 'Canceled': case 'RetriesExhausted': case 'Timeout': return 'denied';
    default: return 'unavailable';
  }
}

function buildPsScript(message: string): string {
  const msg = message.replace(/'/g, "''"); // экранируем одинарные кавычки для PowerShell-строки
  // `-like 'IAsyncOperation?1'` вместо `-eq 'IAsyncOperation`+"`"+`1'` — чтобы не тащить бэктик в
  // JS-шаблон (он бы оборвал template literal). ? матчит ровно символ арности (бэктик).
  return [
    `$ErrorActionPreference='Stop'`,
    // Win32-хелпер: диалог Hello создаётся системным брокером и без окна-владельца (powershell
    // скрыт) не выходит на передний план — висит в таскбаре. Вытаскиваем окно диалога учётных
    // данных (класс 'Credential Dialog Xaml Host') на передний план, пока пользователь не ответил.
    `Add-Type -Namespace OblakoFg -Name Win -MemberDefinition @'`,
    `[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string a, string b);`,
    `[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);`,
    `'@`,
    `[void][Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]`,
    `Add-Type -AssemblyName System.Runtime.WindowsRuntime`,
    `$asTaskGeneric=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation?1' })[0]`,
    `$op=[Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('${msg}')`,
    `$asTask=$asTaskGeneric.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult])`,
    `$task=$asTask.Invoke($null,@($op))`,
    // Поллим появление окна диалога и разово выводим его вперёд; дальше просто ждём ответа.
    `$brought=$false; $deadline=(Get-Date).AddSeconds(90)`,
    `while(-not $task.IsCompleted -and (Get-Date) -lt $deadline){`,
    `  if(-not $brought){ $h=[OblakoFg.Win]::FindWindow('Credential Dialog Xaml Host',$null); if($h -ne [IntPtr]::Zero){ [void][OblakoFg.Win]::SetForegroundWindow($h); $brought=$true } }`,
    `  Start-Sleep -Milliseconds 100`,
    `}`,
    `if($task.IsCompleted){ $task.Result.ToString() } else { 'Timeout' }`,
  ].join('\n');
}

export function verifyUser(_caption: string, message: string): Promise<OsAuthResult> {
  if (process.platform !== 'win32') return Promise.resolve('unavailable');

  return new Promise<OsAuthResult>((resolve) => {
    let tmpFile: string | null = null;
    try {
      tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oblako-osauth-')), 'auth.ps1');
      // ВАЖНО: BOM. Windows PowerShell 5.1 читает .ps1 без BOM в системной ANSI-кодировке — тогда
      // кириллица в сообщении бьётся и ломает парсер (строка с апострофом → «missing )»). BOM
      // заставляет PowerShell распознать UTF-8.
      fs.writeFileSync(tmpFile, '﻿' + buildPsScript(message), 'utf8');
    } catch {
      resolve('unavailable');
      return;
    }

    const cleanup = () => {
      try { if (tmpFile) fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true }); } catch { /* ОС уберёт */ }
    };

    // Hello-запрос ждёт пользователя — таймаут щедрый (> внутреннего Wait в скрипте). Превышение —
    // «не подтвердил» (denied), а не fail-open.
    const child = execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', tmpFile],
      { windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        cleanup();
        if (err) {
          resolve((err as NodeJS.ErrnoException & { killed?: boolean }).killed ? 'denied' : 'unavailable');
          return;
        }
        // Берём последнюю непустую строку вывода — на случай варнингов WinRT-проекции выше.
        const lines = String(stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const token = lines.length ? lines[lines.length - 1]! : '';
        resolve(token ? mapResult(token) : 'unavailable');
      },
    );
    child.on('error', () => { cleanup(); resolve('unavailable'); });
  });
}
