// Скрипт не содержит пользовательских данных. Пароль передаётся отдельным бинарным stdin,
// HWND — не секрет и передаётся аргументом. EncodedCommand нужен только для надёжного quoting.
export const WINDOWS_SECRET_CLIPBOARD_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class OblakoSecretClipboardNative {
  [DllImport("user32.dll", SetLastError=true)] public static extern bool OpenClipboard(IntPtr hWndNewOwner);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool CloseClipboard();
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EmptyClipboard();
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern uint RegisterClipboardFormat(string name);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetClipboardData(uint format, IntPtr memory);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GlobalLock(IntPtr memory);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GlobalUnlock(IntPtr memory);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GlobalFree(IntPtr memory);

  public static bool Put(uint format, byte[] bytes) {
    IntPtr memory = GlobalAlloc(0x42, (UIntPtr)bytes.Length);
    if (memory == IntPtr.Zero) return false;
    IntPtr target = GlobalLock(memory);
    if (target == IntPtr.Zero) { GlobalFree(memory); return false; }
    Marshal.Copy(bytes, 0, target, bytes.Length);
    GlobalUnlock(memory);
    if (SetClipboardData(format, memory) == IntPtr.Zero) { GlobalFree(memory); return false; }
    return true;
  }
}
'@

$stream = New-Object System.IO.MemoryStream
[Console]::OpenStandardInput().CopyTo($stream)
$text = [Text.Encoding]::UTF8.GetString($stream.ToArray())
$owner = [IntPtr]::new([Int64]::Parse($env:OBLAKO_CLIPBOARD_OWNER, [Globalization.CultureInfo]::InvariantCulture))

$opened = $false
for ($i = 0; $i -lt 12 -and -not $opened; $i++) {
  $opened = [OblakoSecretClipboardNative]::OpenClipboard($owner)
  if (-not $opened) { Start-Sleep -Milliseconds 20 }
}
if (-not $opened) { throw 'clipboard busy' }

try {
  if (-not [OblakoSecretClipboardNative]::EmptyClipboard()) { throw 'cannot empty clipboard' }
  $zero = [BitConverter]::GetBytes([UInt32]0)
  $formats = @(
    'ExcludeClipboardContentFromMonitorProcessing',
    'CanIncludeInClipboardHistory',
    'CanUploadToCloudClipboard'
  )
  foreach ($name in $formats) {
    $format = [OblakoSecretClipboardNative]::RegisterClipboardFormat($name)
    if ($format -eq 0 -or -not [OblakoSecretClipboardNative]::Put($format, $zero)) {
      throw 'cannot set privacy format'
    }
  }
  # Секрет кладём ПОСЛЕДНИМ: если хотя бы один privacy-format не установился, текста в
  # clipboard ещё нет и fallback не превратит частичный сбой в утечку через историю Windows.
  $unicode = [Text.Encoding]::Unicode.GetBytes($text + [char]0)
  if (-not [OblakoSecretClipboardNative]::Put(13, $unicode)) { throw 'cannot set unicode text' }
} finally {
  [void][OblakoSecretClipboardNative]::CloseClipboard()
}
`;

export function nativeWindowHandleDecimal(handle: Buffer): string | null {
  if (handle.length >= 8) return handle.readBigUInt64LE(0).toString(10);
  if (handle.length >= 4) return String(handle.readUInt32LE(0));
  return null;
}

export function encodedPowerShellCommand(script = WINDOWS_SECRET_CLIPBOARD_SCRIPT): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}
