// Прогон слияния нашей записи в конфиг чужого MCP-клиента (shared/mcpClientConfig.ts).
//
// Здесь проверяется САМОЕ ОПАСНОЕ место фичи «подключить в один клик»: мы правим файл, который
// человек настраивал руками и в котором лежат ЧУЖИЕ серверы. Потерять их — значит молча сломать
// ему рабочий инструмент, и узнает он об этом не сразу.
//
// Отсюда три группы случаев:
//   • чужое сохраняется — соседние серверы, соседние ключи корня, порядок;
//   • своё обновляется — повторное нажатие не плодит дублей, переехавший путь переписывается,
//     а «уже настроено ровно так» отличается от «настроено иначе» (иначе кнопка врёт);
//   • сомнительное не трогаем — JSONC (комментарии допускают и Cursor, и VS Code), обрывок файла,
//     корень-массив, секция, занятая не объектом. Переписав такой файл своим сериализованным
//     JSON, мы съели бы и комментарии, и порядок ключей.
//
// Запуск: node scripts/mcp-config-check.mjs
import {
  mergeMcpServer, serverBlockText, specById, MCP_CLIENT_SPECS, MCP_SERVER_NAME,
} from '../shared/mcpClientConfig.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}\n         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

const entry = {
  type: 'stdio',
  command: 'C:\\App\\oblako.exe',
  args: ['C:\\App\\resources\\mcp\\shim.mjs', '--endpoint', '\\\\.\\pipe\\oblako-mcp'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
};
const other = { ...entry, command: 'C:\\Old\\oblako.exe' };

const parse = (res) => (res.ok ? JSON.parse(res.text) : null);

console.log('\n— каталог клиентов —');
check('трое, и Claude Code среди них нет', MCP_CLIENT_SPECS.map((s) => s.id),
  ['claude-desktop', 'cursor', 'vscode']);
check('VS Code держит серверы под своим ключом', specById('vscode')?.section, 'servers');
check('Claude Desktop и Cursor — под общим', [specById('claude-desktop')?.section, specById('cursor')?.section],
  ['mcpServers', 'mcpServers']);
check('неизвестный клиент — null', specById('notepad'), null);

console.log('\n— файла нет или он пуст —');
const created = mergeMcpServer(null, 'mcpServers', entry);
check('план — создать', created.ok && created.plan, 'create');
check('структура целиком', parse(created), { mcpServers: { oblako: entry } });
check('пустая строка — то же самое', mergeMcpServer('', 'mcpServers', entry).plan, 'create');
check('одни пробелы — тоже', mergeMcpServer('   \n\t ', 'mcpServers', entry).plan, 'create');
check('перевод строки в конце есть', created.ok && created.text.endsWith('}\n'), true);

console.log('\n— чужое не теряется —');
const withOthers = JSON.stringify({
  mcpServers: {
    filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
    github: { command: 'docker', args: ['run', 'ghcr.io/github/github-mcp-server'] },
  },
}, null, 2);
const added = mergeMcpServer(withOthers, 'mcpServers', entry);
check('план — дописать', added.ok && added.plan, 'add');
check('соседние серверы на месте', Object.keys(parse(added).mcpServers), ['filesystem', 'github', 'oblako']);
check('чужая запись не тронута', parse(added).mcpServers.filesystem,
  { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] });
const withRootKeys = JSON.stringify({ globalShortcut: 'Alt+Space', mcpServers: {}, theme: 'dark' }, null, 2);
const kept = mergeMcpServer(withRootKeys, 'mcpServers', entry);
check('соседние ключи корня на месте', Object.keys(parse(kept)), ['globalShortcut', 'mcpServers', 'theme']);
check('их значения не тронуты', parse(kept).globalShortcut, 'Alt+Space');
check('секции ещё не было — заводим', Object.keys(parse(mergeMcpServer('{}', 'mcpServers', entry)).mcpServers), ['oblako']);

console.log('\n— своё обновляется, а не плодится —');
const already = mergeMcpServer(JSON.stringify({ mcpServers: { oblako: entry } }), 'mcpServers', entry);
check('уже ровно так — писать нечего', already.ok && already.plan, 'same');
const moved = mergeMcpServer(JSON.stringify({ mcpServers: { oblako: other } }), 'mcpServers', entry);
check('путь переехал — переписываем', moved.ok && moved.plan, 'replace');
check('и переписываем на новый', parse(moved).mcpServers.oblako.command, entry.command);
check('дубля не появилось', Object.keys(parse(moved).mcpServers), ['oblako']);
check('порядок соседей сохраняется при замене',
  Object.keys(parse(mergeMcpServer(
    JSON.stringify({ mcpServers: { a: { command: 'a' }, oblako: other, b: { command: 'b' } } }),
    'mcpServers', entry,
  )).mcpServers), ['a', 'oblako', 'b']);
check('чужое имя записи не задевается',
  Object.keys(parse(mergeMcpServer(
    JSON.stringify({ mcpServers: { 'oblako-old': other } }), 'mcpServers', entry,
  )).mcpServers), ['oblako-old', 'oblako']);

console.log('\n— VS Code: другой ключ секции —');
const code = mergeMcpServer(JSON.stringify({ servers: { pylance: { command: 'py' } } }), 'servers', entry);
check('пишем в servers', Object.keys(parse(code).servers), ['pylance', 'oblako']);
check('mcpServers при этом не заводим', parse(code).mcpServers, undefined);

console.log('\n— сомнительное не трогаем —');
check('JSONC с комментарием',
  mergeMcpServer('{\n  // мой сервер\n  "mcpServers": {}\n}', 'mcpServers', entry),
  { ok: false, problem: 'not-json' });
check('хвостовая запятая',
  mergeMcpServer('{ "mcpServers": {}, }', 'mcpServers', entry), { ok: false, problem: 'not-json' });
check('обрывок файла',
  mergeMcpServer('{ "mcpServers": {', 'mcpServers', entry), { ok: false, problem: 'not-json' });
check('корень — массив',
  mergeMcpServer('[]', 'mcpServers', entry), { ok: false, problem: 'not-object' });
check('корень — число',
  mergeMcpServer('42', 'mcpServers', entry), { ok: false, problem: 'not-object' });
check('корень — null',
  mergeMcpServer('null', 'mcpServers', entry), { ok: false, problem: 'not-object' });
check('секция занята массивом',
  mergeMcpServer('{ "mcpServers": [] }', 'mcpServers', entry), { ok: false, problem: 'section-not-object' });
check('секция занята строкой',
  mergeMcpServer('{ "mcpServers": "нет" }', 'mcpServers', entry), { ok: false, problem: 'section-not-object' });
check('секция занята null',
  mergeMcpServer('{ "mcpServers": null }', 'mcpServers', entry), { ok: false, problem: 'section-not-object' });

console.log('\n— блок для ручной вставки —');
check('это валидный JSON', JSON.parse(serverBlockText('mcpServers', entry)), { mcpServers: { oblako: entry } });
check('чужого в нём нет', Object.keys(JSON.parse(serverBlockText('servers', entry)).servers), [MCP_SERVER_NAME]);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
