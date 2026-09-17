// Совпадение повторной загрузки (shared/downloadMatch.ts) — голый node.
//
// Случаи из жизни: картинка ChatGPT с SAS в query — тот же файл; rutracker dl.php?t= —
// разные раздачи; download.torrent одного размера — не близнецы.
//
// Запуск: npm test -- download-match
import {
  downloadUrlKey, sameDownloadUrl, genericDownloadName, sameDownloadFile,
} from '../shared/downloadMatch.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

console.log('\n— подписанный CDN режет билет, путь остаётся —');
{
  const a = 'https://cdn.example.com/files/img-abc.png?st=2026-01-01&se=2026-01-02&sig=AAAA&sp=r';
  const b = 'https://cdn.example.com/files/img-abc.png?st=2026-02-01&se=2026-02-02&sig=BBBB&sp=r';
  check('один ключ', downloadUrlKey(a), downloadUrlKey(b));
  check('считаются тем же адресом', sameDownloadUrl(a, b), true);
  check('S3 X-Amz тоже билет',
    sameDownloadUrl(
      'https://s3.amazonaws.com/bucket/doc.pdf?X-Amz-Algorithm=AWS4&X-Amz-Signature=1&id=keep',
      'https://s3.amazonaws.com/bucket/doc.pdf?X-Amz-Algorithm=AWS4&X-Amz-Signature=2&id=keep',
    ), true);
}

console.log('\n— у трекера номер раздачи в query, его резать нельзя —');
{
  const a = 'https://rutracker.org/forum/dl.php?t=111';
  const b = 'https://rutracker.org/forum/dl.php?t=222';
  check('разные ключи', downloadUrlKey(a) === downloadUrlKey(b), false);
  check('не тот же адрес', sameDownloadUrl(a, b), false);
  check('повтор той же раздачи', sameDownloadUrl(a, `${a}&uk=deadbeef`), true);
}

console.log('\n— не http не склеиваются —');
{
  check('blob пустой ключ', downloadUrlKey('blob:https://x/1'), '');
  check('разные blob не пара', sameDownloadUrl('blob:https://x/1', 'blob:https://x/2'), false);
  check('строка в строку — та же загрузка', sameDownloadUrl('https://a.example/x', 'https://a.example/x'), true);
}

console.log('\n— общее имя не доказывает тот же файл —');
{
  check('download.torrent общее', genericDownloadName('download.torrent'), true);
  check('file (1).zip общее', genericDownloadName('file (1).zip'), true);
  check('фильм.torrent своё', genericDownloadName('[rutracker.org].t111.torrent'), false);
  check('два download.torrent одного размера — не пара',
    sameDownloadFile('download.torrent', 18000, 'download.torrent', 18000), false);
  check('два отчёта одного размера — пара',
    sameDownloadFile('отчёт.pdf', 12000, 'отчёт.pdf', 12000), true);
  check('ноль байт не пара', sameDownloadFile('отчёт.pdf', 0, 'отчёт.pdf', 0), false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
