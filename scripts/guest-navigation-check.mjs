// Сторож запрета привилегированных схем в гостевой вкладке (shared/guestNavigation.ts).
//
// ⚠️ Случаи здесь — не выдуманные, а из аудита безопасности 21.08 (находка 7): страница в
// обычной вкладке уводила себя на `oblako-chrome://` и получала наш интерфейс в своём процессе.
// Каждый обход, который вспомнился при написании гварда, записан ниже случаем — именно затем,
// чтобы следующая правка «заодно упростим разбор адреса» уронила проверку, а не защиту.
//
// Запуск: npm test -- guest (или node scripts/guest-navigation-check.mjs)
import { isGuestNavigable } from '../shared/guestNavigation.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const HTTPS = 'https://example.com/page';
const FILE = 'file:///C:/docs/index.html';

console.log('— обычная навигация не сломана —');
check('http', isGuestNavigable('http://example.com/', HTTPS), true);
check('https', isGuestNavigable('https://example.com/', HTTPS), true);
check('about:blank', isGuestNavigable('about:blank', HTTPS), true);
check('blob (скачивание, предпросмотр)', isGuestNavigable('blob:https://example.com/uuid', HTTPS), true);
check('регистр схемы не важен', isGuestNavigable('HTTPS://example.com/', HTTPS), true);

console.log('\n— привилегированные схемы приложения закрыты —');
check('oblako-chrome (интерфейс браузера)', isGuestNavigable('oblako-chrome://localhost/index.html', HTTPS), false);
check('oblako-model (файлы моделей с диска)', isGuestNavigable('oblako-model://any/model.gguf', HTTPS), false);

console.log('\n— опасные схемы системы закрыты —');
check('javascript:', isGuestNavigable('javascript:alert(1)', HTTPS), false);
check('ms-msdt: (RCE через диагностику Windows)', isGuestNavigable('ms-msdt:/id', HTTPS), false);
check('search-ms:', isGuestNavigable('search-ms:query=x', HTTPS), false);
// ⚠️ Проверка ЧЁРНОГО списка была бы дырой: неизвестная схема обязана запрещаться сама, без
// перечисления. Этот случай ловит переход на белый список обратно.
check('незнакомая чужая схема', isGuestNavigable('zoommtg://join', HTTPS), false);

console.log('\n— file: только с file: —');
check('локальный документ ссылается на соседний', isGuestNavigable('file:///C:/docs/next.html', FILE), true);
check('сайт тянет браузер к диску', isGuestNavigable('file:///C:/Windows/system.ini', HTTPS), false);
check('сайт тянет к сетевой шаре', isGuestNavigable('file://attacker/share/x', HTTPS), false);

console.log('\n— обходы разбора адреса —');
// ⚠️ Пробел и управляющие символы перед схемой браузер игнорирует, а наивная проверка префикса
// нет: это самый ходовой способ обойти фильтр схем.
check('ведущий пробел', isGuestNavigable('  javascript:alert(1)', HTTPS), false);
check('перевод строки внутри', isGuestNavigable('\njavascript:alert(1)', HTTPS), false);
check('табуляция', isGuestNavigable('\toblako-chrome://localhost/', HTTPS), false);
check('пустая строка', isGuestNavigable('', HTTPS), false);
check('относительный адрес (схемы нет)', isGuestNavigable('/next/page', HTTPS), false);
check('протокол-относительный адрес', isGuestNavigable('//example.com/x', HTTPS), false);
// ⚠️ Текущий адрес тоже недоверенный: если он не разобрался, послабление file→file не даётся.
check('file-цель при мусорном текущем', isGuestNavigable('file:///C:/x.html', 'не адрес'), false);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
