// Прогон каталога подключений (shared/aiProviders.ts) — без electron, обычным node.
//
// Два узла, каждый из которых стоит ошибки у человека, а не строки в логе.
//
// РАЗБОР АДРЕСА решает сразу два вопроса: покажем ли мы «считается на этой машине» (Ollama на
// localhost — такое же «здесь», как встроенная Qwen) и пустим ли ключ по открытому http. Оба
// ответа выводятся из ХОСТА, а хост в URL живёт после userinfo — то есть `http://127.0.0.1@evil.com/`
// уходит на evil.com, хотя выглядит как локальный адрес. Наивное «содержит 127.0.0.1» отдало бы
// чужому серверу и метку «локально», и разрешение слать ключ открытым текстом.
//
// РЕЖИМ СХЕМЫ у «OpenAI-совместимого» по умолчанию `none`, а не `native`: за таким адресом может
// стоять прокси или самодельный шлюз, который примет запрос и молча проигнорирует response_format.
//
// Запуск: npm run ai-providers-check
import {
  isLoopbackUrl, validateConnection, capsFor, concurrencyFor, defaultSchemaMode,
  PROVIDER_PRESETS, localConnection, LOCAL_CONNECTION_ID,
} from '../shared/aiProviders.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const conn = (over) => ({
  id: 'c1', label: 'тест', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5', concurrency: 4, ...over,
});

console.log('\n— адрес указывает на эту машину —');
check('localhost', isLoopbackUrl('http://localhost:11434/v1'), true);
check('127.0.0.1', isLoopbackUrl('http://127.0.0.1:1234/v1'), true);
check('IPv6 в скобках', isLoopbackUrl('http://[::1]:11434/v1'), true);
check('поддомен .localhost', isLoopbackUrl('http://ollama.localhost/v1'), true);
check('обычный домен — нет', isLoopbackUrl('https://api.openai.com/v1'), false);
check('порт не путается с хостом', isLoopbackUrl('https://example.com:11434/v1'), false);

console.log('\n— подделки под локальный адрес —');
check('userinfo не выдаёт себя за хост', isLoopbackUrl('http://127.0.0.1@evil.com/v1'), false);
check('домен, начинающийся с localhost', isLoopbackUrl('http://localhost.evil.com/v1'), false);
check('localhost в пути — не хост', isLoopbackUrl('https://evil.com/localhost/v1'), false);
check('а вот localhost ПОСЛЕ userinfo — настоящий', isLoopbackUrl('http://user@localhost:1234/v1'), true);
// ⚠️ Не адрес — значит НЕ локальный. Ответ «да» здесь стоил бы дважды: чужая строка получила бы и
// метку «считается на этой машине», и разрешение слать ключ по открытому http.
check('строка, которая вообще не адрес', isLoopbackUrl('просто текст'), false);

console.log('\n— что пускаем в работу —');
check('https наружу — можно', validateConnection(conn()), { ok: true });
check('http наружу — ключ ушёл бы открытым', validateConnection(conn({ baseUrl: 'http://api.openai.com/v1' })),
  { ok: false, problem: 'plain-http-remote' });
check('http на loopback — можно (Ollama по https не умеет)',
  validateConnection(conn({ baseUrl: 'http://localhost:11434/v1' })), { ok: true });
check('чужая схема', validateConnection(conn({ baseUrl: 'ftp://example.com' })), { ok: false, problem: 'bad-scheme' });
check('не адрес вовсе', validateConnection(conn({ baseUrl: 'api.openai.com' })), { ok: false, problem: 'bad-url' });
// Схема есть, хоста нет — разбор обязан отказать, а не поехать дальше с пустым хостом.
check('схема без хоста', validateConnection(conn({ baseUrl: 'http://' })), { ok: false, problem: 'bad-url' });
check('незакрытая скобка IPv6', validateConnection(conn({ baseUrl: 'http://[::1' })), { ok: false, problem: 'bad-url' });
check('пустой адрес', validateConnection(conn({ baseUrl: '   ' })), { ok: false, problem: 'empty-url' });
check('без модели', validateConnection(conn({ model: ' ' })), { ok: false, problem: 'empty-model' });

console.log('\n— сколько запросов разом —');
check('ноль нельзя', validateConnection(conn({ concurrency: 0 })), { ok: false, problem: 'bad-concurrency' });
check('дробное нельзя', validateConnection(conn({ concurrency: 1.5 })), { ok: false, problem: 'bad-concurrency' });
check('семнадцать нельзя', validateConnection(conn({ concurrency: 17 })), { ok: false, problem: 'bad-concurrency' });
check('единица можно', validateConnection(conn({ concurrency: 1 })), { ok: true });
check('шестнадцать можно', validateConnection(conn({ concurrency: 16 })), { ok: true });

console.log('\n— у локальной модели предел один, что бы ни записали —');
check('локальная всегда 1', concurrencyFor(conn({ kind: 'local', concurrency: 8 })), 1);
check('облачная берёт своё число', concurrencyFor(conn({ concurrency: 8 })), 8);
// Ноль сюда доехать не должен (validateConnection его не пускает), но если доехал — очередь на
// ноль запросов означала бы, что подключение молча не работает вовсе.
check('ноль поднимается до единицы', concurrencyFor(conn({ concurrency: 0 })), 1);

console.log('\n— чем провайдер держит структуру —');
check('локальная — грамматика', defaultSchemaMode('local'), 'grammar');
check('Anthropic — инструмент', defaultSchemaMode('anthropic'), 'tool');
check('Gemini — нативная схема', defaultSchemaMode('gemini'), 'native');
check('совместимый — пессимизм по умолчанию', defaultSchemaMode('openai-compatible'), 'none');
check('но проба может поднять режим',
  capsFor(conn({ schema: 'native' })).schema, 'native');

console.log('\n— метка маршрута —');
check('встроенная Qwen — здесь', capsFor(localConnection('qwen3-4b')), { schema: 'grammar', stream: true, local: true });
check('Ollama на localhost — тоже здесь',
  capsFor(conn({ baseUrl: 'http://localhost:11434/v1' })).local, true);
check('OpenAI — не здесь целиком', capsFor(conn()), { schema: 'none', stream: true, local: false });
check('локальное подключение зовётся одинаково везде', localConnection('m').id, LOCAL_CONNECTION_ID);

console.log('\n— заготовки адресов —');
for (const p of PROVIDER_PRESETS) {
  check(`пресет «${p.label}» пригоден как есть`,
    validateConnection({ id: p.id, label: p.label, kind: p.kind, baseUrl: p.baseUrl, model: p.sampleModel, concurrency: 4 }),
    { ok: true });
}
check('открытый http только у локальных раннеров',
  PROVIDER_PRESETS.filter((p) => p.baseUrl.startsWith('http://')).map((p) => p.id),
  ['ollama', 'lmstudio']);
check('ключ не нужен ровно им же',
  PROVIDER_PRESETS.filter((p) => !p.needsKey).map((p) => p.id),
  ['ollama', 'lmstudio']);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
