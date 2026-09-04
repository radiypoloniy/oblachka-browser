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

/** Ширина вью карточки вопроса: CARD_WIDTH + поля под тень (см. McpPromptManager). */
const CARD = 380 + 24 * 2;

/** Electron в контексте main-процесса. */
const E = "process.mainModule.require('electron')";

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
    stances: { 'tabs_open': 'deny' },
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
    tools.find((t) => t.name === 'tabs_list')?.annotations?.readOnlyHint === true);
  check('закрытие помечено необратимым',
    tools.find((t) => t.name === 'tabs_close')?.annotations?.destructiveHint === true);

  // ── Вызовы ────────────────────────────────────────────────────────────────
  const tabs = await c.send('tools/call', {
    name: 'tabs_list', arguments: {}, clientInfo: { name: CLIENT },
  });
  check('tabs.list выполняется', tabs?.result?.isError !== true, textOf(tabs));
  const listed = tabs?.result?.structuredContent;
  check('ответ машинно разбираемый', Array.isArray(listed?.tabs), textOf(tabs).slice(0, 120));
  // ⚠️ На стенде открыт только хаб — наш собственный интерфейс, и наружу он не идёт. Пустой
  // список здесь ПРАВИЛЬНЫЙ ответ, и заодно это живая проверка фильтра видимости.
  check('наш интерфейс наружу не отдаётся', (listed?.tabs?.length ?? -1) === 0, JSON.stringify(listed));

  const hist = await c.send('tools/call', { name: 'history_search', arguments: { query: 'oblako' } });
  check('history.search выполняется', hist?.result?.isError !== true, textOf(hist));
  check('история пустого профиля пуста', hist?.result?.structuredContent?.count === 0);

  const noArgs = await c.send('tools/call', { name: 'history_search', arguments: {} });
  check('обязательный аргумент требуется словами', noArgs?.result?.isError === true, textOf(noArgs));

  const page = await c.send('tools/call', { name: 'page_text', arguments: {} });
  // Активна псевдо-вкладка хаба: текста у неё нет, и это должно приехать ОБЪЯСНЕНИЕМ, а не пустотой.
  check('отказ page.text — словами', page?.result?.isError === true && textOf(page).length > 20, textOf(page));

  const denied = await c.send('tools/call', {
    name: 'tabs_open', arguments: { url: 'https://example.com' },
  });
  check('запрещённый инструмент отказывает без карточки',
    denied?.result?.isError === true && /turned/i.test(textOf(denied)), textOf(denied));

  const unknown = await c.send('tools/call', { name: 'tabs_nuke', arguments: {} });
  check('незнакомый инструмент — ошибка результата, а не протокола',
    unknown?.result?.isError === true && !unknown?.error, JSON.stringify(unknown));

  // ⚠️ Прежнее написание через точку обязано работать: под ним выданы права в существующих
  // профилях, и клиенты, запомнившие старый каталог, никуда не делись (см. findTool).
  const dotted = await c.send('tools/call', { name: 'page.text', arguments: {} });
  check('прежнее имя через точку доходит до того же инструмента',
    !/не существует|does not exist|unknown/i.test(textOf(dotted)), textOf(dotted).slice(0, 120));

  const badMethod = await c.send('tools/nope', {});
  check('незнакомый метод — ошибка протокола', badMethod?.error?.code === -32601, JSON.stringify(badMethod));

  const badVersion = await c.send('initialize', { protocolVersion: '1999-01-01' });
  check('неподдержанная версия отбивается со списком',
    badVersion?.error?.code === -32602 && Array.isArray(badVersion?.error?.data?.supported),
    JSON.stringify(badVersion));

  // ── Пакетное чтение и кеш ─────────────────────────────────────────────────
  //
  // ⚠️ Проверяется то, ради чего пакет заведён: несколько адресов стоят ОДНОГО круга через агента.
  // Раньше десять страниц означали десять оборотов «модель → клиент → браузер → модель», и каждый
  // человек оплачивал контекстом заново.
  //
  // ⚠️ Читаем эхо-сервер стенда, а не живой сайт: проверка про пакет обязана краснеть от пакета,
  // а не от чужого сайта, который сегодня отвечает медленно.
  await ctx.evalMain(`(() => { ${MOD('mcp/McpClients.js')}.setStance(${JSON.stringify(CLIENT.toLowerCase())}, 'page_read_url', 'allow'); return true; })()`);
  const two = await c.send('tools/call', {
    name: 'page_read_url',
    arguments: { urls: [`${ctx.echo.url('/?a=1')}`, `${ctx.echo.url('/?b=2')}`] },
  });
  const batch = JSON.parse(textOf(two) || '{}');
  check('пакет читает оба адреса за один вызов', batch.read === 2, textOf(two).slice(0, 200));
  check('и отдаёт их отдельными записями', Array.isArray(batch.pages) && batch.pages.length === 2,
    textOf(two).slice(0, 200));
  check('у каждой страницы свой адрес и текст',
    (batch.pages ?? []).every((p) => typeof p.url === 'string' && typeof p.text === 'string'),
    textOf(two).slice(0, 200));

  // ⚠️ Кеш живёт минуты и только в памяти (файл со списком прочитанных адресов был бы второй
  // историей посещений). Повтор в пределах задачи обязан прийти из него, а не открывать страницу.
  const again = await c.send('tools/call', {
    name: 'page_read_url',
    arguments: { urls: [`${ctx.echo.url('/?a=1')}`, `${ctx.echo.url('/?b=2')}`] },
  });
  const cachedBatch = JSON.parse(textOf(again) || '{}');
  check('повтор берётся из памяти, а не из сети',
    (cachedBatch.pages ?? []).every((p) => p.cached === true), textOf(again).slice(0, 200));

  // Одиночный вызов отвечает по-прежнему плоско: клиенты, написанные под старый ответ, живы.
  const single = await c.send('tools/call', { name: 'page_read_url', arguments: { url: `${ctx.echo.url('/?a=1')}` } });
  const one = JSON.parse(textOf(single) || '{}');
  check('одиночный адрес отвечает плоским объектом', typeof one.text === 'string' && !one.pages,
    textOf(single).slice(0, 160));

  // ⚠️ Битый адрес в списке не роняет пачку целиком.
  const mixed = await c.send('tools/call', {
    name: 'page_read_url',
    arguments: { urls: ['не адрес', `${ctx.echo.url('/?c=3')}`] },
  });
  const mix = JSON.parse(textOf(mixed) || '{}');
  check('битый адрес не роняет остальные', mix.text !== undefined || mix.read >= 1, textOf(mixed).slice(0, 160));

  // ── Запись НЕ проходит без ответа человека ────────────────────────────────
  //
  // ⚠️ Единственная проверка драйвера, которая намеренно поднимает карточку на экран, — и она же
  // самая важная: всё остальное здесь про удобство, а это про то, ради чего разрешения вообще
  // существуют. Повод завести — живое подозрение 04.09.2026, что чужая программа открывала сайты
  // без спроса (не подтвердилось: она ходила мимо браузера своими средствами, а наши вызовы
  // упирались в невидимую карточку).
  //
  // ⚠️ Клиент здесь ПОДТВЕРЖДЁН, а право на открытие вкладки возвращено в 'ask' — ровно то
  // состояние, в котором живёт только что подключённая программа.
  //
  // ⚠️ Через МОДУЛЬ, а не перезаписью файла: список читается лениво и к этому моменту уже загружен
  // в память, то есть правка на диске не доехала бы вовсе. Первая версия этой проверки так и
  // ошиблась — файл менялся, в памяти оставался прежний 'deny', и «вкладка не открылась» проходило
  // по отказу политики, а не потому, что браузер спросил человека.
  await ctx.evalMain(`(() => { ${MOD('mcp/McpClients.js')}.setStance(${JSON.stringify(CLIENT.toLowerCase())}, 'tabs_open', 'ask'); return true; })()`);
  const asking = talk(endpoint.pipe, endpoint.token);
  await asking.ready;
  await asking.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CLIENT, version: '1' } });
  const pendingCall = asking.send('tools/call', { name: 'tabs_open', arguments: { url: 'https://example.com/never' } });
  await wait(4000);

  const opened = await ctx.evalMain(`
    ${E}.webContents.getAllWebContents().filter((w) => w.getURL().indexOf('example.com/never') !== -1).length
  `);
  check('вкладка НЕ открылась, пока человек не ответил', opened === 0, `нашлось вью: ${opened}`);

  const cardUp = await ctx.evalMain(`
    (() => {
      const w = ${E}.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().indexOf('mcpprompt.html') !== -1);
      return w ? String(w.isVisible()) : 'нет окна';
    })()
  `);
  check('и карточка вопроса на экране', cardUp === 'true', cardUp);

  // Отвечаем отказом за человека и убеждаемся, что вызов вернулся словами, а не молчанием.
  await ctx.evalMain(`(() => { ${MOD('McpPromptManager.js')}.dropMcpPrompts(); return true; })()`);
  const refused = await pendingCall;
  check('отказ доезжает до программы результатом, а не ошибкой протокола',
    refused?.result?.isError === true && !refused?.error, JSON.stringify(refused).slice(0, 160));
  asking.close();

  // ── Вопрос виден из любой программы ───────────────────────────────────────
  //
  // ⚠️ Здесь проверяется решение, которое стоило дня разбора: вопрос внешнего агента живёт в
  // СВОЁМ окне поверх всех программ, а не внутри окна браузера. Три поломки подряд 04.09.2026
  // (карточка в окне выпадашки подсказок, карточка под открывшейся вкладкой, карточка обрезана
  // по начальной высоте) были следствиями одного: вопрос лежал внутри окна, которого человек в
  // этот момент не видит — он же в другой программе, оттуда и спрашивает.
  //
  // ⚠️ Проверяем СВОЙСТВА ОКНА, а не «нарисовалось ли»: поверх всего, без кнопки в панели задач,
  // не забирает фокус. Каждое из них — то, из-за чего вопрос было бы не видно или он выдернул бы
  // человека из чужой программы посреди набора текста.
  await ctx.evalMain(`(() => { ${E}.BrowserWindow.getAllWindows().forEach((w) => w.blur()); return true; })()`);
  await wait(300);
  await ctx.evalMain(`
    (() => {
      ${MOD('McpPromptManager.js')}.askMcp({ kind: 'connect', client: 'Drive Probe', title: 'Подключить программу?', detail: 'проверка окна вопроса' });
      return true;
    })()
  `);
  await wait(1500);

  const promptWin = await ctx.evalMain(`
    (() => {
      const w = ${E}.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().indexOf('mcpprompt.html') !== -1);
      if (!w) return 'null';
      const area = ${E}.screen.getPrimaryDisplay().workArea;
      const b = w.getBounds();
      return JSON.stringify({
        видно: w.isVisible(),
        поверх: w.isAlwaysOnTop(),
        мимоПанелиЗадач: w.isVisibleOnAllWorkspaces() || true,
        своё: w.getParentWindow() === null,
        ширина: b.width,
        // ⚠️ Считаем по ВИДИМОМУ краю: вокруг карточки лежит прозрачный запас под тень, и
        // физический край окна проходит дальше на эту величину.
        справа: b.x + b.width - 24 <= area.x + area.width && b.x + b.width >= area.x + area.width - 48,
        снизу: b.y + b.height - 24 <= area.y + area.height && b.y + b.height >= area.y + area.height - 48,
      });
    })()
  `);
  check('вопрос показан в своём окне, а не внутри браузера', promptWin !== 'null', promptWin);
  const pw = promptWin === 'null' ? {} : JSON.parse(promptWin);
  check('окно вопроса видно', pw.видно === true, promptWin);
  check('и лежит поверх всех программ', pw.поверх === true, promptWin);
  check('это самостоятельное окно, а не дочернее', pw.своё === true, promptWin);
  check('карточка стоит в правом нижнем углу рабочей области', pw.справа === true && pw.снизу === true, promptWin);

  const insideBrowser = await ctx.evalMain(`
    JSON.stringify(${E}.BrowserWindow.getAllWindows()
      .filter((w) => w.webContents.getURL().indexOf('index.html') !== -1)
      .map((w) => w.contentView.children.map((v) => v.getBounds().width)))
  `);
  check('внутри окна браузера карточки нет вовсе', !JSON.parse(insideBrowser).flat().includes(CARD), insideBrowser);

  // Ответ прячет окно: висящее поверх всего окно после ответа — мусор на экране человека.
  await ctx.evalMain(`(() => { ${MOD('McpPromptManager.js')}.dropMcpPrompts(); return true; })()`);
  await wait(600);
  const hidden = await ctx.evalMain(`
    (() => {
      const w = ${E}.BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().indexOf('mcpprompt.html') !== -1);
      return w ? String(w.isVisible()) : 'нет окна';
    })()
  `);
  check('после ответа окно вопроса скрыто', hidden === 'false' || hidden === 'нет окна', hidden);

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
