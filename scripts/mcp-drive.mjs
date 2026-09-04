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
  check('инструменты отдаются', tools.length === 12, `их ${tools.length}`);
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

  // ── Готовые сценарии ──────────────────────────────────────────────────────
  //
  // ⚠️ Промпты нужны потому, что человек не знает, что браузер вообще умеет: он сидит в чужой
  // программе и должен догадаться сам. Клиент показывает их списком (в Claude Desktop — слэш-
  // командами). Проверяем, что сервер объявляет их в возможностях и отдаёт по протоколу: без
  // объявления клиент за списком даже не придёт.
  const caps = await c.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CLIENT, version: '1' } });
  check('сервер объявляет сценарии в возможностях',
    !!caps?.result?.capabilities?.prompts, JSON.stringify(caps?.result?.capabilities ?? {}));

  const promptList = await c.send('prompts/list', {});
  const prompts = promptList?.result?.prompts ?? [];
  check('сценарии отдаются списком', prompts.length >= 4, `их ${prompts.length}`);
  check('у каждого есть имя и человеческое название',
    prompts.every((p) => p.name && p.title && p.description), JSON.stringify(prompts).slice(0, 200));

  const got = await c.send('prompts/get', { name: 'find_saved', arguments: { topic: 'bergamot' } });
  const msg = got?.result?.messages?.[0]?.content?.text ?? '';
  check('сценарий отдаёт готовый текст', msg.includes('bergamot') && msg.includes('bookmarks_search'),
    msg.slice(0, 160));
  // ⚠️ Обязательный аргумент обязан требоваться: «найди у меня про undefined» — это модель,
  // честно ищущая пустоту.
  const без = await c.send('prompts/get', { name: 'find_saved', arguments: {} });
  check('без обязательного аргумента — отказ протокола', без?.error?.code === -32602,
    JSON.stringify(без).slice(0, 160));
  const нет = await c.send('prompts/get', { name: 'do_my_taxes', arguments: {} });
  check('незнакомый сценарий — тоже отказ протокола', нет?.error?.code === -32602,
    JSON.stringify(нет).slice(0, 160));

  // ── Поиск по закладкам ────────────────────────────────────────────────────
  //
  // ⚠️ Отдельно от истории намеренно: история — всё, куда человек заходил, закладки — то, что он
  // отобрал РУКАМИ. На вопрос «та статья, которую я сохранял» это разные источники.
  //
  // ⚠️ Закладку кладём ЧЕРЕЗ МЕНЕДЖЕР профиля стенда, а не в файл: база открыта, и правка на диске
  // мимо неё не доехала бы (тот же урок, что с mcp-clients.json выше).
  await ctx.evalMain(`(() => {
    ${MOD('ProfileData.js')}.activeBookmarks().add('https://example.org/bergamot', 'Bergamot: перевод в браузере');
    return true;
  })()`);
  const marks = await c.send('tools/call', { name: 'bookmarks_search', arguments: { query: 'bergamot' } });
  const found = JSON.parse(textOf(marks) || '{}');
  check('закладка находится по названию', found.count === 1, textOf(marks).slice(0, 200));
  check('и отдаётся с адресом и датой',
    found.hits?.[0]?.url === 'https://example.org/bergamot' && typeof found.hits?.[0]?.savedAt === 'string',
    JSON.stringify(found.hits ?? []).slice(0, 200));
  const nothing = await c.send('tools/call', { name: 'bookmarks_search', arguments: { query: 'ничего-такого-нет' } });
  check('пустой поиск отвечает нулём, а не ошибкой',
    JSON.parse(textOf(nothing) || '{}').count === 0, textOf(nothing).slice(0, 160));
  // ⚠️ Проценты в запросе не должны превращаться в «найди всё»: LIKE их понимает как шаблон.
  const wild = await c.send('tools/call', { name: 'bookmarks_search', arguments: { query: '%' } });
  check('проценты не находят всё подряд',
    JSON.parse(textOf(wild) || '{}').count === 0, textOf(wild).slice(0, 160));

  // ── Вкладки в группу сайдбара ─────────────────────────────────────────────
  //
  // ⚠️ Закладка — «сохранить на потом», группа — «прибраться сейчас», и для «разбери, что открыто»
  // уместна вторая. Группа ищется по ИМЕНИ и создаётся, если её нет: наших идентификаторов у
  // агента нет, он видит ровно то же, что человек в сайдбаре.
  await ctx.evalMain(`(() => { ${MOD('mcp/McpClients.js')}.setStance(${JSON.stringify(CLIENT.toLowerCase())}, 'tabs_group', 'allow'); return true; })()`);
  // ⚠️ Открываем ДВЕ НАСТОЯЩИЕ страницы: `about:blank` в список вкладок не попадает — наружу
  // отдаётся только то, что человек считает страницей (см. visibleTabs), и группировать было бы
  // нечего. Первая версия этой проверки так и краснела на пустом списке.
  await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(ctx.echo.url('/?g=1'))})`);
  await wait(700);
  await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(ctx.echo.url('/?g=2'))})`);
  await wait(1500);
  const forGroup = await c.send('tools/call', { name: 'tabs_list', arguments: {} });
  const tabsNow = JSON.parse(textOf(forGroup) || '{}').tabs ?? [];
  const ids = tabsNow.map((t) => t.id).slice(0, 2);
  check('есть что группировать', ids.length >= 2, JSON.stringify(tabsNow).slice(0, 160));

  const grouped = await c.send('tools/call', {
    name: 'tabs_group',
    arguments: { tabIds: ids, name: 'Кресла' },
  });
  check('вкладки собраны в группу', /Собрано 2 в группу/.test(textOf(grouped)), textOf(grouped).slice(0, 160));

  const sidebar = await ctx.evalMain(`
    (() => {
      const tabs = ${E}.BrowserWindow.getAllWindows()
        .filter((w) => w.getParentWindow() === null)[0];
      const ctx2 = ${MOD('WindowRegistry.js')}.contextForWindow(tabs);
      const node = ctx2.tabs.sidebarNodesSnapshot().find((n) => n.type === 'group' && n.label === 'Кресла');
      return node ? String(ctx2.tabs.getGroupContents(node.id).length) : 'группы нет';
    })()
  `);
  check('группа появилась в сайдбаре и в ней обе вкладки', sidebar === '2', sidebar);

  // ⚠️ Повтор с тем же именем кладёт В ТУ ЖЕ группу, а не создаёт вторую с тем же названием:
  // человек, попросивший «добавь ещё сюда же», получил бы две «Кресла» в сайдбаре.
  const forGroup2 = await c.send('tools/call', { name: 'tabs_list', arguments: {} });
  const more = (JSON.parse(textOf(forGroup2) || '{}').tabs ?? [])
    .map((t) => t.id).filter((id) => !ids.includes(id)).slice(0, 1);
  if (more.length > 0) {
    await c.send('tools/call', { name: 'tabs_group', arguments: { tabIds: more, name: 'кресла' } });
    const same = await ctx.evalMain(`
      (() => {
        const win = ${E}.BrowserWindow.getAllWindows().filter((w) => w.getParentWindow() === null)[0];
        const ctx2 = ${MOD('WindowRegistry.js')}.contextForWindow(win);
        const node = ctx2.tabs.sidebarNodesSnapshot().find((n) => n.type === 'group' && n.label === 'Кресла');
        return node ? String(ctx2.tabs.getGroupContents(node.id).length) : 'группы нет';
      })()
    `);
    check('имя без учёта регистра ведёт в ту же группу', same === '3', same);
  }

  // ── Сохранение в закладки ─────────────────────────────────────────────────
  //
  // ⚠️ Закрывает круг, который обрывался: агент находил нужное и не мог его никуда положить —
  // «папку создать не смог, вот ссылки». Найденное без места хранения человек переносит руками,
  // то есть делает ровно ту работу, ради которой звал агента.
  //
  // ⚠️ Право переводим в 'allow' СПЕЦИАЛЬНО: сама карточка подтверждения проверяется отдельным
  // блоком выше, а здесь смотрим, что запись доходит до базы закладок и папка создаётся по имени.
  await ctx.evalMain(`(() => { ${MOD('mcp/McpClients.js')}.setStance(${JSON.stringify(CLIENT.toLowerCase())}, 'bookmarks_add', 'allow'); return true; })()`);
  const put = await c.send('tools/call', {
    name: 'bookmarks_add',
    arguments: {
      folder: 'Кресла',
      items: [
        { url: 'https://example.org/kreslo-1', title: 'Кресло первое' },
        { url: 'https://example.org/kreslo-2', title: 'Кресло второе' },
      ],
    },
  });
  check('закладки сохраняются пачкой', /Сохранено 2/.test(textOf(put)), textOf(put).slice(0, 160));
  check('и в названную папку', /Кресла/.test(textOf(put)), textOf(put).slice(0, 160));

  const inFolder = await ctx.evalMain(`
    (() => {
      const store = ${MOD('ProfileData.js')}.activeBookmarks();
      const folder = store.list(null).find((e) => e.kind === 'folder' && e.title === 'Кресла');
      if (!folder) return 'папки нет';
      return JSON.stringify(store.list(folder.id).map((b) => b.title));
    })()
  `);
  check('папка создана по имени и в ней обе закладки',
    inFolder === JSON.stringify(['Кресло первое', 'Кресло второе']), inFolder);

  // ⚠️ Повтор не плодит дублей: агент, потерявший ответ, зовёт инструмент снова — обычное дело.
  await c.send('tools/call', {
    name: 'bookmarks_add',
    arguments: { folder: 'Кресла', items: [{ url: 'https://example.org/kreslo-1', title: 'Кресло первое' }] },
  });
  const afterRepeat = await ctx.evalMain(`
    (() => {
      const store = ${MOD('ProfileData.js')}.activeBookmarks();
      const folder = store.list(null).find((e) => e.kind === 'folder' && e.title === 'Кресла');
      return String(store.list(folder.id).length);
    })()
  `);
  check('повторный вызов не плодит дублей', afterRepeat === '2', afterRepeat);
  // ⚠️ Найтись сохранённое обязано тем же инструментом, которым агент ищет: иначе он «сохранил»
  // в пустоту и об этом не узнает.
  // ⚠️ Запрос СТРОЧНЫМИ по закладке с Заглавной: SQLite LIKE и COLLATE NOCASE регистронезависимы
  // только для ASCII, и «Кресло» по «кресло» не находилось вовсе. Для русскоязычного браузера это
  // сломанный поиск, а не мелочь — поймано этим драйвером.
  const back = await c.send('tools/call', { name: 'bookmarks_search', arguments: { query: 'кресло' } });
  check('сохранённое находится поиском, невзирая на регистр',
    JSON.parse(textOf(back) || '{}').count === 2, textOf(back).slice(0, 160));

  // ── Ссылки со страницы ────────────────────────────────────────────────────
  //
  // ⚠️ Пара к пакетному чтению: агент видит оглавление раздела ЗА ЛОГИНОМ, выбирает нужное и
  // читает выбранное одним вызовом. Его собственный fetch туда не попадёт вовсе.
  await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(ctx.echo.url('/links'))})`);
  await wait(2000);
  const links = await c.send('tools/call', { name: 'page_links', arguments: {} });
  const linked = JSON.parse(textOf(links) || '{}');
  check('ссылки со страницы отдаются', Array.isArray(linked.links) && linked.links.length > 0,
    textOf(links).slice(0, 200));
  check('у каждой есть адрес',
    (linked.links ?? []).every((l) => typeof l.url === 'string' && l.url.startsWith('http')),
    JSON.stringify(linked.links ?? []).slice(0, 200));
  // ⚠️ Ссылка на саму себя не отдаётся: страница ссылается на свои же якоря десятками, и агент
  // пошёл бы читать то, что уже читает.
  check('ссылки на саму страницу нет',
    (linked.links ?? []).every((l) => l.url.split('#')[0] !== String(linked.url).split('#')[0]),
    JSON.stringify(linked.links ?? []).slice(0, 200));

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

  // ── Снимок страницы ───────────────────────────────────────────────────────
  //
  // ⚠️ Проверяется то, ради чего инструмент заведён: агент получает КАРТИНКУ протокола, а не
  // JSON с base64 внутри текста. Разница принципиальная — во втором случае модель видит полмега
  // мусорных символов, за которые платит человек, и ничего на них не разглядит.
  // ⚠️ Снимаем НАСТОЯЩУЮ страницу: активная вкладка стенда — наш собственный интерфейс, а его
  // политика видимости наружу не отдаёт (и правильно делает). Открываем эхо-страницу и ждём
  // кадра: capturePage возвращает пустоту, пока страница не скомпонована.
  // ⚠️ Вкладку не только открываем, но и ДЕЛАЕМ АКТИВНОЙ нашим же инструментом: снимок берёт
  // активную, а после группировки и прочих перестановок активной может оказаться другая — и тогда
  // краснеет не снимок, а порядок проверок.
  await ctx.evalMain(`(() => { ${MOD('mcp/McpClients.js')}.setStance(${JSON.stringify(CLIENT.toLowerCase())}, 'tabs_activate', 'allow'); return true; })()`);
  await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(ctx.echo.url('/?shot=1'))})`);
  // ⚠️ Ждём с запасом: capturePage возвращает пустой кадр, пока страница не скомпонована, и на
  // загруженной машине первая компоновка занимает заметно больше, чем загрузка эхо-страницы.
  //
  // ⚠️ Окно поднимаем ЯВНО: у окна, не выведенного на экран, Chromium отвечает «current display
  // surface not available for capture» — снять можно только то, что отрисовано. В бою это честный
  // отказ (человек свернул браузер), а в прогоне — ложное красное.
  await ctx.evalMain(`(() => {
    const w = ${E}.BrowserWindow.getAllWindows().filter((x) => x.getParentWindow() === null)[0];
    if (w) { w.show(); w.focus(); }
    return true;
  })()`);
  // ⚠️ Ждём САМУ СТРАНИЦУ, а не время: пока её таргет не поднялся, снимать нечего, и слепая пауза
  // на загруженной машине то хватает, то нет.
  await ctx.findTarget((t) => t.url?.includes('shot=1'));
  await wait(1500);
  const forShot = await c.send('tools/call', { name: 'tabs_list', arguments: {} });
  const shotTab = (JSON.parse(textOf(forShot) || '{}').tabs ?? []).find((t) => t.url.includes('shot=1'));
  if (shotTab) {
    await c.send('tools/call', { name: 'tabs_activate', arguments: { tabId: shotTab.id } });
    await wait(1200);
  }
  check('снимаемая вкладка нашлась и стала активной', !!shotTab, JSON.stringify(shotTab ?? null));
  // ⚠️ До трёх попыток, и это про СТЕНД, а не про продукт: окно прогона может быть не выведено на
  // экран (свёрнуто системой, перекрыто), а снять можно только отрисованное. В бою тот же отказ
  // честен — человек свернул браузер, — но красить прогон из-за оконного менеджера незачем.
  let shotCall = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    shotCall = await c.send('tools/call', { name: 'page_screenshot', arguments: {} });
    if ((shotCall?.result?.content ?? []).some((p) => p.type === 'image')) break;
    await ctx.evalMain(`(() => {
      const w = ${E}.BrowserWindow.getAllWindows().filter((x) => x.getParentWindow() === null)[0];
      if (w) { w.restore(); w.show(); w.focus(); }
      return true;
    })()`);
    await wait(1500);
  }
  const parts = shotCall?.result?.content ?? [];
  const image = parts.find((p) => p.type === 'image');
  if (!image) {
    // Диагностика ровно в момент отказа: что с активной вью и снимается ли она напрямую.
    const why = await ctx.evalMain(`
      (async () => {
        const win = ${E}.BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().indexOf('index.html') !== -1);
        if (!win) return JSON.stringify({ окноБраузера: 'не найдено' });
        const c2 = ${MOD('WindowRegistry.js')}.contextForWindow(win);
        const wc = c2 ? c2.tabs.getActiveWebContents() : null;
        const out = { окноВидно: win.isVisible(), естьАктивная: !!wc };
        if (wc) {
          out.адрес = wc.getURL().slice(0, 50);
          try { const s = await wc.capturePage(); out.прямойСнимок = s.isEmpty() ? 'пусто' : JSON.stringify(s.getSize()); }
          catch (e) { out.прямойСнимок = 'ошибка: ' + e.message; }
        }
        const views = win.contentView.children;
        out.вью = views.length;
        try { const s2 = await views[views.length - 1].webContents.capturePage(); out.последняя = s2.isEmpty() ? 'пусто' : JSON.stringify(s2.getSize()); }
        catch (e) { out.последняя = 'ошибка: ' + e.message; }
        return JSON.stringify(out);
      })()
    `);
    console.log(`         диагностика снимка: ${why}`);
  }
  check('снимок приходит картинкой протокола', !!image, JSON.stringify(parts).slice(0, 160));
  check('и это JPEG', image?.mimeType === 'image/jpeg', String(image?.mimeType));
  check('рядом есть текст с адресом страницы',
    parts.some((p) => p.type === 'text' && p.text.includes('127.0.0.1')),
    JSON.stringify(parts.filter((p) => p.type === 'text')).slice(0, 200));
  // ⚠️ Размер под контролем: снимок окна в PNG — это мегабайты, которые поедут строкой через
  // канал и лягут в контекст модели целиком. Уменьшенный JPEG обязан быть заметно меньше.
  const shotBytes = (image?.data?.length ?? 0) * 3 / 4;
  check('снимок ужат до разумного размера', shotBytes > 1000 && shotBytes < 900_000,
    `${Math.round(shotBytes / 1024)} КБ`);
  // ⚠️ base64 отдаётся ГОЛЫМ, без префикса data: — так требует протокол, и клиенты, добавляющие
  // префикс сами, получили бы битую картинку.
  check('данные без префикса data:', !String(image?.data ?? '').startsWith('data:'),
    String(image?.data ?? '').slice(0, 24));
  // ⚠️ Машинной копии у снимка нет намеренно: туда уехал бы тот же base64 вторым экземпляром.
  check('машинной копии снимка нет', shotCall?.result?.structuredContent === undefined,
    JSON.stringify(shotCall?.result?.structuredContent ?? null).slice(0, 80));

  // ── Граница профиля ───────────────────────────────────────────────────────
  //
  // ⚠️ САМАЯ ТИХАЯ ИЗ ДЫР, которые тут закрывались: разрешение выдаётся ОДИН РАЗ, а инструменты
  // работают с АКТИВНЫМ профилем. Человек отдаёт агенту рабочий профиль, переключается в личный —
  // и та же программа с тем же разрешением читает личную историю и личные вкладки. Ничего не
  // ломается, никто не спрашивает: просто граница, которую человек считал проведённой, её нет.
  //
  // ⚠️ Проверка идёт ПОСЛЕДНЕЙ: она переключает профиль стенда, и после неё остальным проверкам
  // жить незачем.
  const switched = await ctx.evalMain(`
    (() => {
      const store = ${MOD('ProfileStore.js')};
      const before = store.getActiveProfile();
      const state = store.createProfile('Личный', 'blue');
      const created = state.profiles.find((p) => p.name === 'Личный');
      if (!created) return 'профиль не создался';
      store.setActiveProfile(created.id);
      return JSON.stringify({ было: before.name, стало: store.getActiveProfile().name });
    })()
  `);
  check('профиль переключён — есть что проверять', switched.includes('Личный'), switched);

  const foreign = await c.send('tools/call', { name: 'tabs_list', arguments: {} });
  check('в чужом профиле браузер не отвечает', foreign?.result?.isError === true,
    textOf(foreign).slice(0, 200));
  // ⚠️ Отказ обязан НАЗВАТЬ ОБА профиля: агент перескажет это человеку, и «нет доступа» без имён
  // тот прочитает как поломку, а не как границу, которую сам же провёл.
  check('и объясняет, куда вернуться', /connected in the browser profile/.test(textOf(foreign))
    && textOf(foreign).includes('Личный'), textOf(foreign).slice(0, 240));

  // Возвращаемся, чтобы выключение проверялось в том же профиле, где всё поднималось.
  await ctx.evalMain(`
    (() => {
      const store = ${MOD('ProfileStore.js')};
      const main = store.getProfiles().profiles[0];
      store.setActiveProfile(main.id);
      return true;
    })()
  `);
  await wait(500);
  const backHome = await c.send('tools/call', { name: 'tabs_list', arguments: {} });
  check('в своём профиле отвечает снова', backHome?.result?.isError !== true,
    textOf(backHome).slice(0, 160));

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
