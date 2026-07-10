/**
 * Разовый setup-шаг VPN, часть 2: скачивает бинарник Xray-core (ядро, спавнится дочерним
 * процессом — не npm-пакет) в resources/xray/xray.exe. Версия зафиксирована явно (не "latest") —
 * воспроизводимость сборки важнее автообновления ядра, апгрейд — правка XRAY_VERSION руками.
 *
 * Проверяет SHA256 скачанного .zip по официальному .dgst с той же страницы релиза ПЕРЕД
 * распаковкой — это исполняемый бинарник, спавнящийся с сетевым доступом, ослаблять проверку
 * ради удобства нельзя (см. CLAUDE.md — доверие к сторонним бинарникам это отдельный, больший
 * риск, чем всё, что было в проекте раньше).
 *
 * Распаковка — через встроенный Windows Expand-Archive (PowerShell), без новой npm-зависимости
 * (проект сейчас Windows-only, этот скрипт тоже, см. CLAUDE.md «Платформа»).
 *
 * Запуск: npm run download-xray
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const XRAY_DIR = path.join(__dirname, '..', 'resources', 'xray');

const XRAY_VERSION = 'v26.3.27';
const ASSET_NAME = 'Xray-windows-64.zip';
const BASE_URL = `https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/${ASSET_NAME}`;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.tmp';
    const file = fs.createWriteStream(tmp);
    https.get(url, (res) => {
      // GitHub releases отдают 302 на release-assets.githubusercontent.com
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(tmp);
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(tmp);
        return reject(new Error(`HTTP ${res.statusCode} для ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        fs.renameSync(tmp, dest);
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(tmp); } catch { /* noop */ }
      reject(err);
    });
  });
}

function downloadText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadText(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} для ${url}`));
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

fs.mkdirSync(XRAY_DIR, { recursive: true });

const zipPath = path.join(XRAY_DIR, ASSET_NAME);
const exePath = path.join(XRAY_DIR, 'xray.exe');

console.log(`Xray-core ${XRAY_VERSION} (${ASSET_NAME})`);

process.stdout.write('Скачиваю контрольную сумму (.dgst)… ');
let expectedSha256;
try {
  const dgst = await downloadText(`${BASE_URL}.dgst`);
  const m = dgst.match(/SHA2-256=\s*([0-9a-fA-F]{64})/);
  if (!m) throw new Error('SHA2-256 не найден в .dgst — формат файла изменился, проверьте вручную');
  expectedSha256 = m[1].toLowerCase();
  console.log(`✓ ${expectedSha256}`);
} catch (err) {
  console.error(`✗ Ошибка: ${err.message}`);
  process.exit(1);
}

process.stdout.write(`Скачиваю ${ASSET_NAME}… `);
try {
  await download(BASE_URL, zipPath);
  const size = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  console.log(`✓ ${size} MB`);
} catch (err) {
  console.error(`✗ Ошибка: ${err.message}`);
  process.exit(1);
}

process.stdout.write('Проверяю SHA256… ');
const actualSha256 = sha256File(zipPath);
if (actualSha256 !== expectedSha256) {
  console.error(`✗ НЕ СОВПАДАЕТ\n  ожидали: ${expectedSha256}\n  получили: ${actualSha256}`);
  console.error('Файл удалён — не используйте, качество/подлинность бинарника не подтверждены.');
  fs.unlinkSync(zipPath);
  process.exit(1);
}
console.log('✓ совпадает');

process.stdout.write('Распаковываю xray.exe… ');
try {
  // -Force: перезаписать при повторном запуске скрипта (апгрейд версии).
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -Path '${zipPath}' -DestinationPath '${XRAY_DIR}' -Force`,
  ]);
  if (!fs.existsSync(exePath)) throw new Error('xray.exe не найден в архиве после распаковки');
  console.log(`✓ ${exePath}`);
} catch (err) {
  console.error(`✗ Ошибка: ${err.message}`);
  process.exit(1);
} finally {
  // Архив и всё, кроме самого бинарника, не нужны: geoip.dat/geosite.dat — только для
  // domain/geo-based routing-правил (MVP-конфиг их не использует, см. VpnConfigBuilder.ts),
  // wintun.dll/LICENSE-wintun — TUN-режим (мы делаем только локальный SOCKS через
  // session.setProxy, TUN не нужен, см. план), xray_no_window.* — обёртки для запуска без
  // консоли, мы спавним xray.exe напрямую через child_process. Держать их в resources/ —
  // 30+ МБ мёртвого веса и лишняя поверхность в собранном приложении без всякой пользы.
  try { fs.unlinkSync(zipPath); } catch { /* noop */ }
  for (const extra of ['LICENSE', 'LICENSE-wintun.txt', 'README.md', 'geoip.dat', 'geosite.dat', 'wintun.dll', 'xray_no_window.ps1', 'xray_no_window.vbs']) {
    try { fs.unlinkSync(path.join(XRAY_DIR, extra)); } catch { /* noop */ }
  }
}

console.log('\nГотово.');
