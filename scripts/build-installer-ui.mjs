// Собирает лицо установщика (маленький WinForms+WebView2 exe) в build/oblako-setup-ui.exe.
// NSIS кладёт его в пакет и показывает на первом запуске Setup — сам мастер при этом молчит.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUB = join(ROOT, 'build', 'installer-stub');
const FONTS_SRC = join(ROOT, 'src', 'assets', 'fonts');
const FONTS_DST = join(STUB, 'ui', 'fonts');
const OUT = join(ROOT, 'build', 'oblako-setup-ui.exe');

mkdirSync(FONTS_DST, { recursive: true });
for (const f of [
  'golos-text-cyrillic.woff2',
  'golos-text-latin.woff2',
  'unbounded-cyrillic.woff2',
  'unbounded-latin.woff2',
]) {
  const from = join(FONTS_SRC, f);
  if (!existsSync(from)) {
    console.error(`[installer-ui] нет шрифта ${f} — npm run download-fonts`);
    process.exit(1);
  }
  copyFileSync(from, join(FONTS_DST, f));
}

const pub = spawnSync(
  'dotnet',
  [
    'publish',
    join(STUB, 'InstallerStub.csproj'),
    '-c', 'Release',
    '-r', 'win-x64',
    '--self-contained', 'true',
    '-p:PublishSingleFile=true',
    '-o', join(STUB, 'publish'),
  ],
  { stdio: 'inherit' },
);
if (pub.status !== 0) process.exit(pub.status ?? 1);

const built = join(STUB, 'publish', 'oblako-setup-ui.exe');
if (!existsSync(built)) {
  console.error('[installer-ui] publish не положил oblako-setup-ui.exe');
  process.exit(1);
}
copyFileSync(built, OUT);
console.log(`[installer-ui] ${OUT}`);
