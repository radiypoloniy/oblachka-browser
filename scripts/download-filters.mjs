/**
 * Скачивает EasyList и EasyPrivacy в resources/ для адблока.
 * Запуск: npm run download-filters
 * Файлы должны присутствовать в resources/ до запуска приложения.
 * Обновление листов из сети запланировано на Этап 3.
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESOURCES = path.join(__dirname, '..', 'resources');

const LISTS = [
  { url: 'https://easylist.to/easylist/easylist.txt',   out: 'easylist.txt' },
  { url: 'https://easylist.to/easylist/easyprivacy.txt', out: 'easyprivacy.txt' },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.tmp';
    const file = fs.createWriteStream(tmp);
    https.get(url, (res) => {
      // Обрабатываем редиректы (easylist.to делает 301)
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

fs.mkdirSync(RESOURCES, { recursive: true });

for (const { url, out } of LISTS) {
  const dest = path.join(RESOURCES, out);
  process.stdout.write(`Скачиваю ${out}… `);
  try {
    await download(url, dest);
    const size = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
    console.log(`✓ ${size} MB → ${dest}`);
  } catch (err) {
    console.error(`✗ Ошибка: ${err.message}`);
    process.exit(1);
  }
}

console.log('\nГотово. Перезапустите приложение для применения полных фильтр-листов.');
