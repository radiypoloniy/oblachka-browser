// Прогон каталога правил-автоматизаций (shared/rules.ts).
//
// Зачем отдельным скриптом: validateRule — единственная дверь, через которую в систему попадает
// ответ МОДЕЛИ, то есть текст, придуманный маленькой языковой моделью. Такую границу положено
// проверять запуском, а не чтением. Модуль намеренно без импортов electron, поэтому гоняется
// обычным node (--experimental-strip-types, Node 22.6+).
//
//   npm run rules-check
import { validateRule, describeRule, normalizeRuleDomain, hostMatchesDomain, hostOfUrl, sameRule }
  from '../shared/rules.ts';

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  ✗ ${name}\n      получили ${JSON.stringify(got)}\n      ждали    ${JSON.stringify(want)}`); }
  else console.log(`  ✓ ${name}`);
};

console.log('\n── домены ──');
check('голый домен', normalizeRuleDomain('habr.com'), 'habr.com');
check('полный адрес', normalizeRuleDomain('https://www.habr.com/ru/all/?a=1#x'), 'habr.com');
check('порт и регистр', normalizeRuleDomain('HTTPS://Habr.COM:8443'), 'habr.com');
check('логин в адресе', normalizeRuleDomain('https://user:pass@habr.com/x'), 'habr.com');
check('корневая точка', normalizeRuleDomain('habr.com.'), 'habr.com');
check('не домен — фраза', normalizeRuleDomain('открывай в группе'), null);
check('не домен — одно слово', normalizeRuleDomain('habr'), null);
check('не домен — пусто', normalizeRuleDomain('   '), null);

console.log('\n── совпадение хоста ──');
check('сам домен', hostMatchesDomain('habr.com', 'habr.com'), true);
check('поддомен', hostMatchesDomain('m.habr.com', 'habr.com'), true);
check('www', hostMatchesDomain('www.habr.com', 'habr.com'), true);
check('чужой домен с тем же хвостом', hostMatchesDomain('nothabr.com', 'habr.com'), false);
check('чужой домен', hostMatchesDomain('example.com', 'habr.com'), false);
check('хост из адреса', hostOfUrl('https://www.VTB.ru/personal'), 'vtb.ru');
check('не http — не сайт', hostOfUrl('file:///C:/x.html'), '');
check('мусор вместо адреса', hostOfUrl('не адрес'), '');

console.log('\n── валидация (граница доверия) ──');
const base = { trigger: { kind: 'site', domain: 'vtb.ru' }, action: { kind: 'vpn-on' }, phrase: 'на банках включай впн' };
const ok = validateRule(base, { id: 'r1' });
check('правило принято', !!ok, true);
check('домен нормализован', validateRule({ ...base, trigger: { kind: 'site', domain: 'https://WWW.vtb.ru/x' } }, { id: 'r1' })?.trigger.domain, 'vtb.ru');
check('включено по умолчанию', ok?.enabled, true);
check('выключено, если сказано явно', validateRule({ ...base, enabled: false }, { id: 'r1' })?.enabled, false);

check('выдуманное действие отвергнуто', validateRule({ ...base, action: { kind: 'delete-history' } }, { id: 'r1' }), null);
check('выдуманный триггер отвергнут', validateRule({ ...base, trigger: { kind: 'every-monday', domain: 'vtb.ru' } }, { id: 'r1' }), null);
check('группа без имени отвергнута', validateRule({ ...base, action: { kind: 'group' } }, { id: 'r1' }), null);
check('группа с пробелами вместо имени отвергнута', validateRule({ ...base, action: { kind: 'group', groupName: '   ' } }, { id: 'r1' }), null);
check('домен-фраза отвергнут', validateRule({ ...base, trigger: { kind: 'site', domain: 'все банки' } }, { id: 'r1' }), null);
check('без id отвергнуто', validateRule(base), null);
check('мусор отвергнут', validateRule('привет', { id: 'r1' }), null);
check('null отвергнут', validateRule(null, { id: 'r1' }), null);
check('лишние поля не переезжают', Object.keys(validateRule({ ...base, evil: 1 }, { id: 'r1' }) ?? {}).includes('evil'), false);

const longName = 'ааааааааааааааааааааааааааааааааааааа';
check('длинное имя группы обрезано', validateRule({ ...base, action: { kind: 'group', groupName: longName } }, { id: 'r1' })?.action.groupName?.length, 24);

console.log('\n── описание для человека ──');
check(
  'сайт + VPN',
  describeRule(validateRule(base, { id: 'r1' })),
  'Когда открываю страницу на vtb.ru — включать VPN и перезагружать страницу',
);
check(
  'ссылка + группа',
  describeRule(validateRule({ trigger: { kind: 'link-from', domain: 'habr.com' }, action: { kind: 'group', groupName: 'Хабр' } }, { id: 'r2' })),
  'Когда перехожу по ссылке с habr.com — класть вкладку в группу «Хабр»',
);

console.log('\n── дубли ──');
const r1 = validateRule(base, { id: 'a' });
const r2 = validateRule({ ...base, phrase: 'другими словами то же самое' }, { id: 'b' });
check('та же пара «триггер+действие» — дубль', sameRule(r1, r2), true);
check('другой домен — не дубль', sameRule(r1, validateRule({ ...base, trigger: { kind: 'site', domain: 'sber.ru' } }, { id: 'c' })), false);
check(
  'разные имена групп — не дубль',
  sameRule(
    validateRule({ trigger: { kind: 'site', domain: 'habr.com' }, action: { kind: 'group', groupName: 'Работа' } }, { id: 'd' }),
    validateRule({ trigger: { kind: 'site', domain: 'habr.com' }, action: { kind: 'group', groupName: 'Чтение' } }, { id: 'e' }),
  ),
  false,
);

console.log(failed === 0 ? '\nВСЁ ПРОШЛО\n' : `\nПРОВАЛОВ: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
