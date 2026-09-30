// Статическая проверка Windows privacy-хелпера без записи в реальный clipboard пользователя.
// Запуск: node --experimental-strip-types scripts/secret-clipboard-check.mjs
import {
  WINDOWS_SECRET_CLIPBOARD_SCRIPT, encodedPowerShellCommand, nativeWindowHandleDecimal,
} from '../electron/platform/windowsSecretClipboardScript.ts';

let passed = 0;
let failed = 0;
function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

console.log('\n— native window handle —');
const handle64 = Buffer.alloc(8); handle64.writeBigUInt64LE(0x1234567890n);
const handle32 = Buffer.alloc(4); handle32.writeUInt32LE(0x12345678);
check('x64 HWND переводится без потери точности', nativeWindowHandleDecimal(handle64), '78187493520');
check('x32 HWND поддержан fallback-веткой', nativeWindowHandleDecimal(handle32), '305419896');
check('битый HWND отклоняется', nativeWindowHandleDecimal(Buffer.alloc(2)), null);

console.log('\n— Windows privacy formats —');
for (const format of [
  'ExcludeClipboardContentFromMonitorProcessing',
  'CanIncludeInClipboardHistory',
  'CanUploadToCloudClipboard',
]) check(`скрипт выставляет ${format}`, WINDOWS_SECRET_CLIPBOARD_SCRIPT.includes(format), true);
check('текст читается только из stdin', WINDOWS_SECRET_CLIPBOARD_SCRIPT.includes('OpenStandardInput'), true);
check('HWND читается из отдельной переменной', WINDOWS_SECRET_CLIPBOARD_SCRIPT.includes('OBLAKO_CLIPBOARD_OWNER'), true);
check('секрет записывается только после privacy-форматов',
  WINDOWS_SECRET_CLIPBOARD_SCRIPT.indexOf('Put(13, $unicode)') > WINDOWS_SECRET_CLIPBOARD_SCRIPT.indexOf('foreach ($name in $formats)'), true);
check('EncodedCommand декодируется без изменений',
  Buffer.from(encodedPowerShellCommand(), 'base64').toString('utf16le'), WINDOWS_SECRET_CLIPBOARD_SCRIPT);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
