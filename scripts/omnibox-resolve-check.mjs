// Порядок эвристик омнибокса (shared/omniboxResolve.ts) — без electron, голым node.
//
// ⚠️ Эталон — литералы, не те же константы, из которых собран результат. Иначе сдвиг
// «файл после хоста» сократится в равенстве и проверка останется зелёной.
//
// Запуск: npm test -- omnibox-resolve
import { resolveOmniboxInput } from '../shared/omniboxResolve.ts';

let passed = 0;
let failed = 0;
function check(what, actual, expected) {
  const ok = actual === expected;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

const bangs = { yt: 'https://www.youtube.com/results?search_query=' };
function resolveBang(s) {
  const m = /^!yt(?:\s+(.*))?$/i.exec(s.trim());
  if (!m) return null;
  return m[1] ? bangs.yt + encodeURIComponent(m[1]) : 'https://www.youtube.com/';
}
const files = {
  'C:\\tmp\\page.html': 'file:///C:/tmp/page.html',
};
const deps = {
  resolveBang,
  fileUrl: (s) => files[s] ?? null,
  buildSearchUrl: (q) => `https://example-search.test/?q=${encodeURIComponent(q)}`,
};

console.log('\n— пустое и готовая схема —');
check('пробелы → about:blank', resolveOmniboxInput('   ', deps), 'about:blank');
check('https не трогаем', resolveOmniboxInput('https://news.test/a', deps), 'https://news.test/a');
check('file:// не трогаем', resolveOmniboxInput('file:///C:/tmp/page.html', deps), 'file:///C:/tmp/page.html');
check('about:blank как схема', resolveOmniboxInput('about:blank', deps), 'about:blank');

console.log('\n— бэнг раньше схемы и хоста —');
check('!yt с запросом', resolveOmniboxInput('!yt котики', deps),
  'https://www.youtube.com/results?search_query=%D0%BA%D0%BE%D1%82%D0%B8%D0%BA%D0%B8');
check('!yt без запроса — домой', resolveOmniboxInput('!yt', deps), 'https://www.youtube.com/');
check('неизвестный !foo уходит в поиск', resolveOmniboxInput('!foo котики', deps),
  'https://example-search.test/?q=!foo%20%D0%BA%D0%BE%D1%82%D0%B8%D0%BA%D0%B8');

console.log('\n— файл раньше «похоже на хост» —');
check('существующий C:\\...\\page.html → file://, не https://C:',
  resolveOmniboxInput('C:\\tmp\\page.html', deps), 'file:///C:/tmp/page.html');
check('тот же путь без файла на диске остаётся хост-эвристикой',
  resolveOmniboxInput('C:\\missing\\page.html', deps), 'https://C:\\missing\\page.html');

console.log('\n— хост или поиск —');
check('localhost', resolveOmniboxInput('localhost:3000/app', deps), 'https://localhost:3000/app');
check('IPv4', resolveOmniboxInput('127.0.0.1', deps), 'https://127.0.0.1');
check('домен', resolveOmniboxInput('example.com', deps), 'https://example.com');
check('фраза с пробелом — поиск', resolveOmniboxInput('погода завтра', deps),
  'https://example-search.test/?q=%D0%BF%D0%BE%D0%B3%D0%BE%D0%B4%D0%B0%20%D0%B7%D0%B0%D0%B2%D1%82%D1%80%D0%B0');

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
