// Проверяет PowerShell/C# helper системным парсером, но НЕ исполняет его и не трогает clipboard.
import { spawn } from 'node:child_process';
import { WINDOWS_SECRET_CLIPBOARD_SCRIPT } from '../electron/platform/windowsSecretClipboardScript.ts';

if (process.platform !== 'win32') {
  console.log('PowerShell syntax: пропущено (не Windows)');
  process.exit(0);
}

const parser = String.raw`
$source = [Console]::In.ReadToEnd()
$tokens = $null
$errors = $null
[Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -gt 0) {
  [Console]::Error.WriteLine(($errors | ForEach-Object { $_.Message }) -join [Environment]::NewLine)
  exit 1
}
`;

function runPowerShell(source, stdin) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(source, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded,
    ], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdin.end(stdin);
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `exit ${code}`)));
  });
}

try {
  await runPowerShell(parser, WINDOWS_SECRET_CLIPBOARD_SCRIPT);
  console.log('PowerShell syntax: ok');

  const csharp = WINDOWS_SECRET_CLIPBOARD_SCRIPT.match(/Add-Type -TypeDefinition @'\r?\n([\s\S]*?)\r?\n'@/)?.[1];
  if (!csharp) throw new Error('C# block not found');
  const compiler = '$source = [Console]::In.ReadToEnd(); Add-Type -TypeDefinition $source';
  await runPowerShell(compiler, csharp);
  console.log('PowerShell C# helper: ok');
} catch (error) {
  console.error(`PowerShell helper: FAIL\n${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
}
