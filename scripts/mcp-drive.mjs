// Живой MCP-сервер: канал поднимается, протокол отвечает, политика держит.
// Не *-check.mjs — поднимает настоящее приложение, в npm test не входит.
//
// ⚠️ Ради чего заведён, если есть mcp-policy-check. Тот держит ЧИСТУЮ ЛОГИКУ: какой инструмент к
// какому режиму относится, что спрашивать, какой адрес пропускать. Он ничего не знает о том,
// поднялся ли именованный канал, принят ли токен, дошёл ли вызов до TabManager и вернулся ли
// ответ в форме, которую поймёт чужой клиент. Между «правило верное» и «браузер отвечает» лежит
// весь electron/mcp/, а его не проверяет ничто, кроме глаза.
//
// ⚠️ Разговор идёт ПО НАСТОЯЩЕМУ КАНАЛУ, а не мимо него: скрипт подключается к тому же
// именованному каналу, что и шим, и говорит тем же кадрированием. Иначе проверка отвечала бы на
// вопрос «работает ли dispatch», а не «работает ли сервер».
//
// ⚠️ НИ ОДНОГО ВОПРОСА ЧЕЛОВЕКУ. Драйвер идёт заранее подтверждённым клиентом (файл клиентов
// кладётся в профиль стенда до первого вызова) и трогает только те инструменты, у которых нет
// состояния 'ask'. Иначе на экране повисла бы карточка, а прогон стоял бы минуту до таймаута —
// то есть проверка проверяла бы терпение, а не сервер.
//
// ⚠️ Профиль изолированный (withStand), боевые данные не открываются.
//
// Запуск: npm run drive -- mcp
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { withStand, wait } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, good, detail = '') => {
  if (good) ok++; else bad++;
  console.log(`${good ? '  ok  ' : ' FAIL '} ${what}${detail && !good ? `\n         ${detail}` : ''}`);
};

/** Имя, которым драйвер представляется. Ключ клиента — оно же в нижнем регистре (clientKey). */
const CLIENT = 'Drive Probe';

/** Разговор по каналу: строка на сообщение, ответы сопоставляются по id. */
function talk(pipe, token) {
  const socket = net.connect(pipe);
  const waiting = new Map();
  let buffer = '';
  let authed = null;

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    let cut = buffer.indexOf('\n');
    while (cut !== -1) {
      const line = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 1);
      let msg = null;
      try { msg = JSON.parse(line); } catch { /* мусор в канале — пусть упадёт ожидание по таймауту */ }
      if (msg?.auth) authed?.(msg.auth === 'ok');
      else if (msg?.id !== undefined) waiting.get(msg.id)?.(msg);
      cut = buffer.indexOf('\n');
    }
  });

  const ready = new Promise((resolve, reject) => {
    authed = resolve;
    socket.on('connect', () => socket.write(`${JSON.stringify({ auth: token })}\n`));
    socket.on('error', reject);
    setTimeout(() => reject(new Error('канал не ответил на токен')), 8000);
  });

  let nextId = 1;
  const send = (method, params) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      waiting.set(id, resolve);
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(() => reject(new Error(`нет ответа на ${method}`)), 20000);
    });
  };

  return { ready, send, close: () => socket.destroy() };
}

// ⚠️ Модуль берём ИЗ КЭША CommonJS, а не require по пути: require отдал бы ВТОРУЮ копию с пустым
// состоянием — сервер в ней не запущен, и включать было бы нечего. Ключи кэша на Windows идут с
// обратными слэшами, поэтому перед сравнением разделитель приводим (тот же приём, что в
// ai-activity-drive.mjs).
const MOD = (tail) => `(() => {
  const cache = process.mainModule.constructor._cache;
  const key = Object.keys(cache).find((k) => k.split(String.fromCharCode(92)).join('/').endsWith(${JSON.stringify(tail)}));
  return key ? cache[key].exports : null;
})()`;

/** Текст результата инструмента — то, что увидит модель. */
const textOf = (res) => res?.result?.content?.[0]?.text ?? '';

await withStand(async (ctx) => {
  // ⚠️ Сервер включаем ИЗ MAIN, а не правкой настроек: настройка читается на старте, а стенд уже
  // поднят. Путь к модулю — через process.mainModule.require (в контексте main нет require).
  const turnedOn = await ctx.evalMain(`(() => {
    const m = ${MOD('mcp/index.js')};
    if (!m) return 'модуль mcp не найден в кэше';
    m.setMcpEnabled(true);
    return true;
  })()`);
  check('сервер включается из main', turnedOn === true);

  // Точка подключения — тот же файл, который читает шим.
  const endpointFile = path.join(ctx.profile, 'mcp-endpoint.json');
  for (let i = 0; i < 40 && !fs.existsSync(endpointFile); i++) await wait(100);
  check('точка подключения записана в профиль', fs.existsSync(endpointFile), endpointFile);
  if (!fs.existsSync(endpointFile)) return;

  const endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'));
  check('канал именованный, а не сетевой порт', String(endpoint.pipe).startsWith('\\\\.\\pipe\\'), endpoint.pipe);
  check('токен длинный', String(endpoint.token || '').length >= 32);

  // ⚠️ Клиента подтверждаем ФАЙЛОМ, как это сделал бы человек нажатием: список читается лениво,
  // при первом обращении, — значит запись, положенная сейчас, доедет штатным путём загрузки.
  // tabs.open заранее переводим в 'deny': так проверяется отказ БЕЗ карточки на экране.
  fs.writeFileSync(path.join(ctx.profile, 'mcp-clients.json'), JSON.stringify([{
    key: CLIENT.toLowerCase(),
    label: CLIENT,
    approvedAt: Date.now(),
    lastSeen: Date.now(),
    stances: { 'tabs.open': 'deny' },
  }], null, 2), 'utf8');

  // ── Разговор ──────────────────────────────────────────────────────────────
  const wrongToken = talk(endpoint.pipe, 'ffff'.repeat(12));
  const rejected = await wrongToken.ready.then(() => false).catch(() => true);
  check('чужой токен не пускают', rejected);
  wrongToken.close();

  const c = talk(endpoint.pipe, endpoint.token);
  check('токен принят', (await c.ready) === true);

  // Старая эпоха: выпущенные клиенты начинают с рукопожатия.
  const init = await c.send('initialize', {
    protocolVersion: '2025-06-18',
    clientInfo: { name: CLIENT, version: '1' },
  });
  check('initialize отвечает', init?.result?.protocolVersion === '2025-06-18', JSON.stringify(init));
  check('сервер называет себя', init?.result?.serverInfo?.name === 'oblako-browser');

  // Новая эпоха: то же без рукопожатия.
  const disc = await c.send('server/discover', {});
  check('server/discover отвечает', Array.isArray(disc?.result?.supportedVersions));
  check('текущая ревизия в списке', disc?.result?.supportedVersions?.includes('2026-07-28'));

  const list = await c.send('tools/list', {});
  const tools = list?.result?.tools ?? [];
  check('инструменты отдаются', tools.length === 7, `их ${tools.length}`);
  check('у каждого есть схема и аннотации',
    tools.every((t) => t.inputSchema?.type === 'object' && typeof t.annotations?.readOnlyHint === 'boolean'));
  check('чтение помечено чтением',
    tools.find((t) => t.name === 'tabs.list')?.annotations?.readOnlyHint === true);
  check('закрытие помечено необратимым',
    tools.find((t) => t.name === 'tabs.close')?.annotations?.destructiveHint === true);

  // ── Вызовы ────────────────────────────────────────────────────────────────
  const tabs = await c.send('tools/call', {
    name: 'tabs.list', arguments: {}, clientInfo: { name: CLIENT },
  });
  check('tabs.list выполняется', tabs?.result?.isError !== true, textOf(tabs));
  const listed = tabs?.result?.structuredContent;
  check('ответ машинно разбираемый', Array.isArray(listed?.tabs), textOf(tabs).slice(0, 120));
  // ⚠️ На стенде открыт только хаб — наш собственный интерфейс, и наружу он не идёт. Пустой
  // список здесь ПРАВИЛЬНЫЙ ответ, и заодно это живая проверка фильтра видимости.
  check('наш интерфейс наружу не отдаётся', (listed?.tabs?.length ?? -1) === 0, JSON.stringify(listed));

  const hist = await c.send('tools/call', { name: 'history.search', arguments: { query: 'oblako' } });
  check('history.search выполняется', hist?.result?.isError !== true, textOf(hist));
  check('история пустого профиля пуста', hist?.result?.structuredContent?.count === 0);

  const noArgs = await c.send('tools/call', { name: 'history.search', arguments: {} });
  check('обязательный аргумент требуется словами', noArgs?.result?.isError === true, textOf(noArgs));

  const page = await c.send('tools/call', { name: 'page.text', arguments: {} });
  // Активна псевдо-вкладка хаба: текста у неё нет, и это должно приехать ОБЪЯСНЕНИЕМ, а не пустотой.
  check('отказ page.text — словами', page?.result?.isError === true && textOf(page).length > 20, textOf(page));

  const denied = await c.send('tools/call', {
    name: 'tabs.open', arguments: { url: 'https://example.com' },
  });
  check('запрещённый инструмент отказывает без карточки',
    denied?.result?.isError === true && /turned/i.test(textOf(denied)), textOf(denied));

  const unknown = await c.send('tools/call', { name: 'tabs.nuke', arguments: {} });
  check('незнакомый инструмент — ошибка результата, а не протокола',
    unknown?.result?.isError === true && !unknown?.error, JSON.stringify(unknown));

  const badMethod = await c.send('tools/nope', {});
  check('незнакомый метод — ошибка протокола', badMethod?.error?.code === -32601, JSON.stringify(badMethod));

  const badVersion = await c.send('initialize', { protocolVersion: '1999-01-01' });
  check('неподдержанная версия отбивается со списком',
    badVersion?.error?.code === -32602 && Array.isArray(badVersion?.error?.data?.supported),
    JSON.stringify(badVersion));

  // ── Выключение ────────────────────────────────────────────────────────────
  c.close();
  await ctx.evalMain(`(() => { ${MOD('mcp/index.js')}.setMcpEnabled(false); return true; })()`);
  await wait(500);
  const afterOff = talk(endpoint.pipe, endpoint.token);
  const unreachable = await afterOff.ready.then(() => false).catch(() => true);
  // ⚠️ Главная проверка выключателя: выключено — значит канала НЕТ, а не «сервер отвечает отказом».
  check('после выключения канала нет вовсе', unreachable);
  afterOff.close();
}, { main: true });

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
