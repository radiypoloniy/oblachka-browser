// Ключ страницы (shared/pageKey.ts) — без electron, обычным node.
//
// ⚠️ Случаи из ЖИЗНИ, а не выдуманные. Первый — прямо из боевой базы закладок: карточка товара
// Ozon с метками шаринга `at`/`sh`. Человек сохранил страницу, открыл её из панели, звезда не
// загорелась, повторное нажатие создало дубль — потому что сравнение шло точной строкой, а Ozon
// переписывает метки при каждом открытии.
//
// ⚠️ Половина проверок здесь — про то, что ключ НЕ схлопывает разные страницы. Это важнее
// первой половины: ложное «уже в закладках» хуже, чем отсутствующая звезда, потому что оно ещё
// и подменяет чужую запись при добавлении.
//
// Запуск: npm test -- page-key
import { pageKey, samePage } from '../shared/pageKey.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

console.log('\n— тот самый случай из жалобы —');
{
  // Обе ссылки — одна карточка товара, метки разные (взяты из боевой базы).
  const saved = 'https://www.ozon.ru/product/installyatsiya-3385584686/?at=1s6j1RVnBMIPIZzpp_vRY7aU3NrU9PZ0&sh=_nfDRaYPVg';
  const opened = 'https://www.ozon.ru/product/installyatsiya-3385584686/?at=7QWERTYuiop1234567890abcdefGHIJ&sh=ZZtopQQ';
  check('сохранённая и открытая — одна страница', samePage(saved, opened), true);
  check('ключ без меток шаринга', pageKey(saved), 'https://www.ozon.ru/product/installyatsiya-3385584686');
  check('поддомен наследует правила площадки',
    samePage('https://m.ozon.ru/product/x-1/?at=AAA', 'https://m.ozon.ru/product/x-1/?at=BBB'), true);
}

console.log('\n— общий шум режется везде —');
{
  check('utm-набор', pageKey('https://habr.com/ru/post/1/?utm_source=tg&utm_medium=post&utm_campaign=x'),
    'https://habr.com/ru/post/1');
  check('рекламные клики', pageKey('https://shop.com/item?gclid=abc&yclid=def&fbclid=ghi'), 'https://shop.com/item');
  check('фрагмент не влияет', samePage('https://a.com/doc#part2', 'https://a.com/doc'), true);
  check('завершающий слэш не влияет', samePage('https://a.com/article/', 'https://a.com/article'), true);
  check('регистр схемы и хоста', samePage('HTTPS://A.COM/Page', 'https://a.com/Page'), true);
}

console.log('\n— и НЕ режется то, что значимо —');
{
  check('запрос поиска — разные страницы',
    samePage('https://yandex.ru/images/search?text=A', 'https://yandex.ru/images/search?text=B'), false);
  check('видео на ютубе — разные страницы',
    samePage('https://www.youtube.com/watch?v=aaa', 'https://www.youtube.com/watch?v=bbb'), false);
  check('регистр ПУТИ значим', samePage('https://a.com/Page', 'https://a.com/page'), false);
  check('www и без www — разные (как в Chrome)',
    samePage('https://www.a.com/p', 'https://a.com/p'), false);
  check('`at` на чужом сайте не трогаем',
    samePage('https://calendar.com/day?at=2026-08-25', 'https://calendar.com/day?at=2026-08-26'), false);
  check('порядок параметров не нормализуется',
    samePage('https://a.com/p?x=1&y=2', 'https://a.com/p?y=2&x=1'), false);
  check('разные протоколы — разные страницы', samePage('http://a.com/p', 'https://a.com/p'), false);
}

console.log('\n— вырожденное —');
{
  check('пустая строка', pageKey(''), '');
  check('не адрес вовсе — возвращается как есть', pageKey('какой-то текст'), 'какой-то текст');
  check('ключ существует всегда', typeof pageKey('mailto:a@b.c'), 'string');
  check('корень с слэшем и без', samePage('https://a.com/', 'https://a.com'), true);
}

console.log(`\nИтого: ${passed} ок, ${failed} провалено\n`);
process.exit(failed === 0 ? 0 : 1);
