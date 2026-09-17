// Проверка отчёта без сети: обычный установщик считается, blockmap и черновик — нет.
import { summarizeReleases, fetchReleases } from './release-downloads.mjs';

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}`);
}

const report = summarizeReleases([
  { tag_name: 'v0.8.3', draft: false, assets: [
    { name: 'Oblako-Setup-0.8.3.exe', download_count: 12 },
    { name: 'Oblako-Setup-0.8.3.exe.blockmap', download_count: 80 },
  ] },
  { tag_name: 'v0.8.2', draft: false, assets: [{ name: 'Oblako-Setup-0.8.2.exe', download_count: 7 }] },
  { tag_name: 'v0.9.0', draft: true, assets: [{ name: 'Oblako-Setup-0.9.0.exe', download_count: 99 }] },
]);
check('установщики по релизам', report.rows.map(({ tag, downloads }) => [tag, downloads]),
  [['v0.8.3', 12], ['v0.8.2', 7]]);
check('итого без blockmap и черновика', report.total, 19);

const pages = [];
const releaseList = await fetchReleases(async (url, options) => {
  pages.push({ url, headers: options.headers });
  return { ok: true, json: async () => [{ tag_name: 'v1' }] };
}, 'test-token');
check('API-запрос и ответ', releaseList.length, 1);
check('токен только в заголовке', pages[0].headers.Authorization, 'Bearer test-token');
check('одна неполная страница', pages.length, 1);

console.log(`Итого: ${passed} прошло, ${failed} не прошло`);
if (failed) process.exitCode = 1;
