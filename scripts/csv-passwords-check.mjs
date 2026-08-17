// Прогон разбора CSV-экспорта паролей (shared/csvPasswords.ts) — без electron, обычным node.
//
// Почему под проверкой: это единственный путь переноса паролей из современного Chrome (его пароли
// с диска не читаются, см. разбор в самом модуле), и разбор идёт РУКАМИ, без CSV-библиотеки. А
// значит все углы RFC 4180 — кавычки, запятая и перевод строки внутри поля, удвоенная кавычка,
// CRLF, BOM — наши, и ломаются они молча: пароль с запятой уехал бы в соседнюю колонку, и человек
// узнал бы об этом, только когда не смог войти на сайт. Поэтому углы зафиксированы числом.
//
// Запуск: npm run csv-passwords-check  (или общий npm test)
import { parseCsvPasswords } from '../shared/csvPasswords.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

console.log('\n— формат Chrome/Edge/Brave —');
{
  // Ровно то, что отдаёт chrome://password-manager → «Экспорт».
  const csv = 'name,url,username,password,note\n'
    + 'Example,https://example.com/,user@example.com,secret123,\n'
    + 'GitHub,https://github.com/,octocat,hunter2,заметка\n';
  check('три колонки url/username/password читаются', parseCsvPasswords(csv), [
    { url: 'https://example.com/', username: 'user@example.com', password: 'secret123' },
    { url: 'https://github.com/', username: 'octocat', password: 'hunter2' },
  ]);
}

console.log('\n— порядок колонок берётся из заголовка, не из позиции (Firefox) —');
{
  // Firefox кладёт те же url/username/password, но в другом порядке и с другими соседями.
  const csv = '"url","username","password","httpRealm","formActionOrigin","guid"\n'
    + '"https://a.test/","alice","pw-a","","https://a.test/","{1}"\n';
  check('колонки найдены по имени', parseCsvPasswords(csv), [
    { url: 'https://a.test/', username: 'alice', password: 'pw-a' },
  ]);
}

console.log('\n— RFC 4180: запятая, кавычки и перевод строки внутри поля —');
{
  // Пароль с запятой ОБЯЗАН быть в кавычках — иначе он и есть тот баг, ради которого эта проверка.
  check('запятая внутри поля не рвёт строку',
    parseCsvPasswords('name,url,username,password\nX,https://c.test/,bob,"p,a,ss"\n'),
    [{ url: 'https://c.test/', username: 'bob', password: 'p,a,ss' }]);
  // Удвоенная кавычка "" внутри поля = одна кавычка.
  check('удвоенная кавычка становится одной',
    parseCsvPasswords('url,username,password\nhttps://d.test/,eve,"pa""ss"\n'),
    [{ url: 'https://d.test/', username: 'eve', password: 'pa"ss' }]);
  // Перевод строки внутри кавычек — часть значения, а не конец записи.
  check('перевод строки внутри поля не рвёт запись',
    parseCsvPasswords('url,username,password,note\nhttps://e.test/,sam,pw,"строка1\nстрока2"\n'),
    [{ url: 'https://e.test/', username: 'sam', password: 'pw' }]);
}

console.log('\n— перевод строк и BOM —');
{
  check('CRLF читается как LF',
    parseCsvPasswords('url,username,password\r\nhttps://f.test/,u,pw\r\n'),
    [{ url: 'https://f.test/', username: 'u', password: 'pw' }]);
  check('BOM в начале не ломает заголовок',
    parseCsvPasswords('﻿name,url,username,password\nX,https://g.test/,u,pw\n'),
    [{ url: 'https://g.test/', username: 'u', password: 'pw' }]);
  check('последняя строка без завершающего перевода читается',
    parseCsvPasswords('url,username,password\nhttps://h.test/,u,pw'),
    [{ url: 'https://h.test/', username: 'u', password: 'pw' }]);
}

console.log('\n— что отбрасывается —');
{
  check('строка без пароля пропущена',
    parseCsvPasswords('url,username,password\nhttps://i.test/,u,\nhttps://j.test/,u2,pw2\n'),
    [{ url: 'https://j.test/', username: 'u2', password: 'pw2' }]);
  check('строка без url пропущена',
    parseCsvPasswords('url,username,password\n,u,pw\nhttps://k.test/,u2,pw2\n'),
    [{ url: 'https://k.test/', username: 'u2', password: 'pw2' }]);
  check('пустой файл — пустой результат', parseCsvPasswords(''), []);
  check('только заголовок — пусто', parseCsvPasswords('url,username,password\n'), []);
  // ⚠️ Не тот CSV (нет колонок url/password) — НЕ тащим мусор молча, отдаём пусто.
  check('CSV без нужных колонок отвергается целиком',
    parseCsvPasswords('foo,bar,baz\n1,2,3\n'), []);
}

console.log('\n— края значений —');
{
  // Пароль с краевыми пробелами: их НЕ обрезаем (могут быть частью пароля). url/username обрезаем.
  check('пробелы пароля сохранены, url/username обрезаны',
    parseCsvPasswords('url,username,password\n  https://l.test/  ,  ann  ,"  pw  "\n'),
    [{ url: 'https://l.test/', username: 'ann', password: '  pw  ' }]);
  // Колонки username может не быть вовсе — тогда пустая строка, а не падение.
  check('отсутствие колонки username → пустой логин',
    parseCsvPasswords('url,password\nhttps://m.test/,pw\n'),
    [{ url: 'https://m.test/', username: '', password: 'pw' }]);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
