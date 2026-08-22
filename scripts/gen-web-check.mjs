// Виджет по ссылке человека (shared/genWeb.ts) — без сети и без модели.
//
// Зачем: по этой ссылке ходит браузер пользователя. Ошибка в допуске адреса — это не кривая
// плитка, а запрос на 192.168.1.1 с его машины; ошибка в разборе фида — тихо пустая лента.
//   npm test -- gen-web
import {
  parseFeedItems, looksLikeFeed, resolveJsonPath, displayableValue,
  jsonSample, jsonLeafPaths, GEN_FEED_MAX_ITEMS,
} from '../shared/genWeb.ts';
// ⚠️ Проверка адреса живёт в genSpec.ts, а не рядом с остальным web-кодом: два модуля из
// shared/ не могут ссылаться друг на друга (проверки гоняют их голым node). Разбор — там,
// допуск — здесь; см. шапку genWeb.ts.
import { isAllowedGenUrl } from '../shared/genSpec.ts';

let passed = 0;
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  ✗ ${name}\n      получили ${JSON.stringify(got)}\n      ждали    ${JSON.stringify(want)}`); }
  else { passed++; console.log(`  ✓ ${name}`); }
};
const checkTrue = (name, got) => check(name, !!got, true);

console.log('\n── какие адреса пускаем ──');
checkTrue('обычный https', isAllowedGenUrl('https://example.com/feed.xml'));
checkTrue('http не пускаем', !isAllowedGenUrl('http://example.com/feed.xml'));
checkTrue('file не пускаем', !isAllowedGenUrl('file:///C:/secrets.txt'));
checkTrue('мусор не пускаем', !isAllowedGenUrl('не ссылка'));
// ⚠️ Виджет, ходящий на 192.168.1.1, — это не виджет, а сканер локальной сети с машины человека.
checkTrue('localhost закрыт', !isAllowedGenUrl('https://localhost/api'));
checkTrue('127.0.0.1 закрыт', !isAllowedGenUrl('https://127.0.0.1/api'));
checkTrue('192.168.x закрыт', !isAllowedGenUrl('https://192.168.1.1/'));
checkTrue('10.x закрыт', !isAllowedGenUrl('https://10.0.0.5/'));
checkTrue('172.16-31 закрыт', !isAllowedGenUrl('https://172.20.0.1/'));
checkTrue('172.32 — уже публичный, пускаем', isAllowedGenUrl('https://172.32.0.1/'));
checkTrue('169.254 (link-local) закрыт', !isAllowedGenUrl('https://169.254.169.254/latest/meta-data/'));
checkTrue('.local закрыт', !isAllowedGenUrl('https://printer.local/status'));

console.log('\n── разбор фида ──');
{
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
    <title>Лента сайта</title>
    <item><title>Первая новость</title><link>https://a.example/1</link><pubDate>Fri, 22 Aug 2026 09:00:00 GMT</pubDate></item>
    <item><title><![CDATA[Вторая &amp; главная]]></title><link>https://a.example/2</link></item>
  </channel></rss>`;
  const items = parseFeedItems(rss);
  check('две записи', items.length, 2);
  check('заголовок', items[0].title, 'Первая новость');
  check('ссылка', items[0].link, 'https://a.example/1');
  checkTrue('дата разобрана', typeof items[0].at === 'number');
  // ⚠️ CDATA и сущности — не экзотика, а норма для русских лент.
  check('CDATA развёрнут', items[1].title, 'Вторая & главная');
  checkTrue('это фид', looksLikeFeed(rss));
}
{
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>Запись Atom</title><link href="https://b.example/x"/><updated>2026-08-22T09:00:00Z</updated></entry>
  </feed>`;
  const items = parseFeedItems(atom);
  // ⚠️ У Atom ссылка живёт АТРИБУТОМ, а не текстом тега — на этом ломаются наивные разборы.
  check('Atom: ссылка из href', items[0].link, 'https://b.example/x');
  check('Atom: заголовок', items[0].title, 'Запись Atom');
  checkTrue('это фид', looksLikeFeed(atom));
}
{
  const many = `<rss><channel>${'<item><title>т</title></item>'.repeat(60)}</channel></rss>`;
  check('лента обрезана', parseFeedItems(many).length, GEN_FEED_MAX_ITEMS);
  check('пустой ввод', parseFeedItems(''), []);
  checkTrue('обычная страница фидом не считается', !looksLikeFeed('<!doctype html><html><body>hi</body></html>'));
  // Запись без заголовка показывать нечем — пропускаем, а не рисуем пустую строку.
  check('запись без заголовка пропущена', parseFeedItems('<rss><item><link>https://a/b</link></item></rss>').length, 0);
}

console.log('\n── путь в JSON ──');
{
  const data = { rates: { USD: { value: 82.919999999 } }, list: [{ price: 5 }, { price: 7 }], ok: true };
  check('вложенный ключ', resolveJsonPath(data, 'rates.USD.value'), 82.919999999);
  check('индекс массива', resolveJsonPath(data, 'list[0].price'), 5);
  check('точечная запись индекса', resolveJsonPath(data, 'list.1.price'), 7);
  check('нет такого ключа', resolveJsonPath(data, 'rates.EUR.value'), undefined);
  check('выход за массив', resolveJsonPath(data, 'list[9].price'), undefined);
  check('пустой путь', resolveJsonPath(data, ''), undefined);

  // ⚠️ Хвост плавающей точки на плитке читается как поломка: 82.91999999999999.
  check('число округлено до сотых', displayableValue(82.919999999), '82.92');
  check('строка подрезана', displayableValue(' очень   длинная строка '), 'очень длинная строка');
  check('булево по-русски', displayableValue(true), 'да');
  // Объект показать нечем — это провал выбора пути, а не «пустая плитка».
  check('объект не показать', displayableValue({ a: 1 }), null);
  check('массив не показать', displayableValue([1, 2]), null);
  check('пустая строка не значение', displayableValue('   '), null);
}

console.log('\n── образец для промпта ──');
{
  const big = { a: { b: { c: { d: { e: 1 } } } }, arr: [1, 2, 3, 4, 5], s: 'x'.repeat(200) };
  const sample = jsonSample(big);
  // ⚠️ Контекст у локальной модели один на всё приложение: ответы API на сотни килобайт слать
  // целиком нельзя. Модели нужны КЛЮЧИ, а не данные.
  check('массив урезан', sample.arr.length, 2);
  check('строка урезана', sample.s.length, 40);
  check('глубина ограничена', sample.a.b.c.d, '…');

  const paths = jsonLeafPaths({ rates: { USD: { value: 1 }, EUR: { value: 2 } }, meta: { at: 'now' } });
  checkTrue('путь до числа найден', paths.includes('rates.USD.value'));
  checkTrue('путь до строки найден', paths.includes('meta.at'));
  checkTrue('веток не бесконечно', paths.length <= 40);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
