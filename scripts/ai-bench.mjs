// Стенд замеров AI-функций: одна и та же батарея задач на любой установленной модели.
//
// Зачем. Все наши AI-функции отвечают в ЖЁСТКОЙ форме (номер фрагмента, номер вкладки, четыре
// помеченные строки), поэтому «стало хуже/лучше» здесь считается, а не ощущается. Это и делает
// возможным вопрос «а хватит ли 4B» — на него отвечает таблица попаданий, а не впечатление.
//
//   npm run ai-bench                      — на текущей модели по умолчанию
//   npm run ai-bench -- --model 4b        — переключить дефолт на первую модель, чьё имя содержит «4b»
//   npm run ai-bench -- --only tabs,rules — только часть наборов
//   npm run ai-bench -- --list            — какие модели установлены, и выйти
//   npm run ai-bench -- --keep            — не удалять профиль стенда после прогона
//
// ⚠️ РАБОТАЕТ НА СВОЁМ ПРОФИЛЕ, не на боевом. У боевого профиля живая история, закладки, графы и
// сессия человека; прогон открывает десяток вкладок и лезет в настройки — этого там быть не
// должно. Профиль стенда лежит во временной папке ОС и удаляется в конце.
//
// ⚠️ Папка моделей подключается к профилю стенда JUNCTION'ом на боевую: гигабайты GGUF не
// копируются, файлы только читаются. Junction снимается ОТДЕЛЬНО и ПЕРВЫМ, до удаления профиля —
// рекурсивное удаление папки, внутри которой висит ссылка на боевые модели, слишком дорогая
// ошибка, чтобы полагаться на то, как именно её обходит fs.rm.
//
// ⚠️ Между прогонами разных моделей обязателен unloadModel(): пока прежняя модель резидентна в
// видеопамяти, следующая получает куцый бюджет контекста и падает на ровном месте (замерено).
import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = path.join(os.tmpdir(), 'oblako-ai-bench');
const RESULTS_DIR = path.join(ROOT, 'scripts', 'bench-results');
const PORT = 18400;
const CDP = 19400;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── аргументы ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const argVal = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const MODEL_HINT = argVal('--model');
const ONLY = (argVal('--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const KEEP = argv.includes('--keep');
const LIST_ONLY = argv.includes('--list');
// Сколько раз прогнать каждый случай. Генерация не детерминирована, и «попало один раз» — это не
// то же самое, что «работает»: случай, прошедший 2 раза из 3, надо видеть отдельно от твёрдого
// попадания, иначе сравнение моделей меряет везение.
const REPEAT = Math.max(1, Number(argVal('--repeat') ?? 1) || 1);

// ── фикстуры ─────────────────────────────────────────────────────────────────
// Вкладки для смыслового поиска и группировки. Заголовки подобраны так, чтобы слов запроса в них
// НЕ было: иначе мы измеряли бы подстрочный поиск, а не понимание.
const TABS = [
  { slug: 'ndfl',    title: 'Расчёт НДФЛ с продажи квартиры — Госуслуги' },
  { slug: 'borsch',  title: 'Борщ по-домашнему: пошаговый рецепт' },
  { slug: 'vacuum',  title: 'Отзывы о роботе-пылесосе Xiaomi S20' },
  { slug: 'sochi',   title: 'Прогноз погоды в Сочи на неделю' },
  { slug: 'vue',     title: 'Vue 3 Composition API — документация' },
  { slug: 'react',   title: 'React Hooks — полный справочник' },
  { slug: 'train',   title: 'Расписание поездов Москва — Казань' },
  { slug: 'vitd',    title: 'Дефицит витамина D: признаки и анализы' },
];

// Страница для смыслового Ctrl+F: ответы намеренно сформулированы другими словами, чем вопросы.
const OFERTA = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>Публичная оферта — ТестМаркет</title></head>
<body style="max-width:720px;margin:40px auto;font:16px/1.6 system-ui">
<header><nav>Главная · Каталог · Доставка · Контакты</nav></header>
<h1>Публичная оферта интернет-магазина</h1>
<p>Настоящий документ является официальным предложением и определяет порядок взаимодействия между продавцом и покупателем при оформлении заказа через сайт.</p>
<h2>Оформление заказа</h2>
<p>Заказ считается принятым с момента, когда покупатель получил на указанную почту письмо с номером и составом заказа. До этого момента позиции в корзине не резервируются на складе.</p>
<h2>Доставка</h2>
<p>Курьерская доставка по городу выполняется на следующий рабочий день при оформлении до восемнадцати часов. В отдалённые районы срок увеличивается на сутки.</p>
<p>Самовывоз доступен из пунктов выдачи партнёров. Посылка хранится в пункте семь календарных дней, после чего отправляется обратно на склад.</p>
<h2>Проверка при получении</h2>
<p>Покупатель вправе вскрыть упаковку в присутствии курьера и осмотреть содержимое на предмет внешних повреждений. Претензии по внешнему виду после ухода курьера не принимаются.</p>
<h2>Если товар не подошёл</h2>
<p>Когда покупателя не устроил размер, цвет или сама вещь оказалась не такой, как выглядела на фотографии, посылку можно передать курьеру обратно. Средства поступят на ту же карту, с которой прошла оплата, в течение десяти рабочих дней с момента, когда посылка приедет на склад.</p>
<h2>Гарантия производителя</h2>
<p>На технически сложные изделия распространяется гарантия изготовителя сроком двенадцать месяцев с даты продажи. Сервисные центры перечислены в талоне внутри коробки.</p>
<h2>Персональные данные</h2>
<p>Продавец обрабатывает имя, телефон и адрес исключительно для исполнения заказа и передаёт их курьерской службе в объёме, необходимом для вручения.</p>
<h2>Спорные ситуации</h2>
<p>Стороны решают разногласия переговорами. Срок ответа на письменное обращение составляет десять рабочих дней с даты его поступления.</p>
</body></html>`;

// Подборка игр — фикстура под ЖИВОЙ отзыв: «открыл топ с играми, там несколько фэнтези, а поиск
// показал одну». Подходящих ответов тут заведомо больше одного, причём слово «фэнтези» есть не
// в каждом — иначе мерился бы подстрочный поиск, а не понимание.
const GAMES = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>20 лучших игр года</title></head>
<body style="max-width:720px;margin:40px auto;font:16px/1.6 system-ui">
<h1>Лучшие игры года</h1>
<h2>Ночь драконов</h2>
<p>Огромный мир мечей и магии: орден рыцарей, древние заклинания и драконы над горами. Классическое приключение в вымышленном средневековье, каким его любят с восьмидесятых.</p>
<h2>Кремний-9</h2>
<p>Космический шутер про колонию на спутнике Юпитера. Скафандры, пробоины в обшивке и тревожный саундтрек; из оружия — плазменные резаки и дроны.</p>
<h2>Хроники Эльдхейма</h2>
<p>Ролевая сага о наследнице престола эльфов, гоблинских ордах и зачарованном лесе. Вся кампания проходится за сорок часов, есть режим для двоих.</p>
<h2>Гонки Восточного шоссе</h2>
<p>Аркадные заезды по ночным трассам мегаполиса, тюнинг машин и подпольные турниры на деньги.</p>
<h2>Пепел королевств</h2>
<p>Стратегия про войну трёх домов в мире, где живут гномы, тролли и говорящие вороны; армии ведут маги, а замки осаждают требушетами.</p>
<h2>Тихий офис</h2>
<p>Симулятор бумажной работы: заполняйте отчёты, ходите на совещания и выживайте до пятницы.</p>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (url === '/oferta') { res.end(OFERTA); return; }
  if (url === '/games') { res.end(GAMES); return; }
  const tab = TABS.find((t) => url === `/${t.slug}`);
  if (tab) {
    res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${tab.title}</title></head>`
      + `<body><h1>${tab.title}</h1><p>Содержимое страницы для стенда замеров.</p></body></html>`);
    return;
  }
  res.end('<!doctype html><title>bench</title><p>ok');
});

// ── наборы задач ─────────────────────────────────────────────────────────────
// Каждый случай: что спрашиваем и что считаем верным ответом. Отрицательные случаи (ожидаем
// отказ) не менее важны положительных: уверенный ответ на вопрос не по теме хуже молчания.

const TAB_CASES = [
  { q: 'где там про налоги',            expect: 'ndfl' },
  { q: 'что я собирался готовить',      expect: 'borsch' },
  { q: 'поездка в другой город',        expect: 'train' },
  { q: 'фреймворк для интерфейсов',     expect: ['vue', 'react'] },
  { q: 'нехватка витаминов в организме', expect: 'vitd' },
  { q: 'куда поехать отдыхать на море', expect: 'sochi' },
  { q: 'где купить автомобиль',         expect: null }, // такой вкладки нет — ждём отказ
];

const FIND_CASES = [
  { q: 'где тут про возврат денег',          expect: 'Средства поступят' },
  { q: 'сколько ждать курьера',              expect: 'Курьерская доставка' },
  { q: 'что делать если техника сломалась',  expect: 'гарантия изготовителя' },
  { q: 'кому отдают мой телефон и адрес',    expect: 'передаёт их курьерской службе' },
  { q: 'можно ли посмотреть товар до оплаты', expect: 'вскрыть упаковку' },
  { q: 'какая тут ставка по ипотеке',        expect: null }, // на странице этого нет
];

const RULE_CASES = [
  { p: 'ссылки с habr.com открывай в отдельной группе', expect: { trigger: 'link-from', domain: 'habr.com', action: 'group' } },
  { p: 'на сайте vtb.ru включай VPN',                   expect: { trigger: 'site', domain: 'vtb.ru', action: 'vpn-on' } },
  { p: 'закрепляй вкладки с youtube.com',               expect: { trigger: 'site', domain: 'youtube.com', action: 'pin' } },
  { p: 'не блокируй рекламу на lenta.ru',               expect: { trigger: 'site', domain: 'lenta.ru', action: 'adblock-off' } },
  { p: 'страницы с ozon.ru складывай в группу Покупки', expect: { trigger: 'site', domain: 'ozon.ru', action: 'group' } },
  { p: 'переходы с reddit.com клади в группу Чтение',   expect: { trigger: 'link-from', domain: 'reddit.com', action: 'group' } },
  { p: 'удаляй историю каждый вечер',                   expect: null }, // такого действия в каталоге нет
  { p: 'закажи мне пиццу',                              expect: null },
];

// ── CDP ──────────────────────────────────────────────────────────────────────
const cdpGet = (p) => new Promise((ok, fail) => {
  http.get({ hostname: '127.0.0.1', port: CDP, path: p }, (r) => {
    let b = ''; r.on('data', (c) => (b += c));
    r.on('end', () => { try { ok(JSON.parse(b)); } catch { ok(b); } });
  }).on('error', fail);
});

async function findTarget(pred, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const t = (await cdpGet('/json/list')).find(pred); if (t?.webSocketDebuggerUrl) return t; } catch { /* CDP ещё не поднялся */ }
    await wait(500);
  }
  return null;
}

function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const ready = new Promise((ok, fail) => {
    ws.addEventListener('open', ok);
    ws.addEventListener('error', () => fail(new Error('CDP: соединение не открылось')));
  });
  const send = (method, params = {}) => new Promise((ok) => {
    const my = ++id; pending.set(my, ok);
    ws.send(JSON.stringify({ id: my, method, params }));
  });
  // Таймаут щедрый: холодная загрузка модели занимает десятки секунд, и это нормальный случай.
  const evaluate = async (expr, ms = 300000) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: ms });
    if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails?.exception?.description ?? 'ошибка в renderer').slice(0, 200));
    return r.result?.result?.value;
  };
  return { send, ready, evaluate, close: () => ws.close() };
}

// ── профиль стенда ───────────────────────────────────────────────────────────
function realUserDataDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? '', 'oblako-browser');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'oblako-browser');
  return path.join(os.homedir(), '.config', 'oblako-browser');
}

function dropModelsLink() {
  const link = path.join(PROFILE, 'models');
  try {
    // lstat, а не existsSync: битую ссылку existsSync не увидит, а снять её надо.
    const st = fs.lstatSync(link);
    if (st.isSymbolicLink() || st.isDirectory()) fs.unlinkSync(link);
  } catch { /* ссылки нет — нечего снимать */ }
}

function prepareProfile() {
  dropModelsLink();               // ПЕРВЫМ: см. предупреждение в шапке
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  const realModels = path.join(realUserDataDir(), 'models');
  if (!fs.existsSync(realModels)) {
    console.log(`⚠ Папка моделей не найдена: ${realModels}`);
    console.log('  Стенд запустится, но модели не будет — замерять нечего.');
    return;
  }
  fs.symlinkSync(realModels, path.join(PROFILE, 'models'), 'junction');
}

function cleanupProfile() {
  dropModelsLink();
  if (!KEEP) fs.rmSync(PROFILE, { recursive: true, force: true });
}

// ── прогон ───────────────────────────────────────────────────────────────────
const suites = [];
const line = (s = '') => console.log(s);

// Лог приложения. ⚠️ Нужен не «на всякий случай»: наши AI-модули печатают СЫРОЙ ответ модели, и
// без него провалившийся случай неотличим — «модель ответила не то» или «мы не так разобрали».
const appLog = [];
const LOG_TAGS = ['[rules]', '[smart-find]', '[tab-search]', '[organize]', '[related]', '[rename]'];
const taggedLinesSince = (from) => appLog
  .slice(from)
  .join('')
  .split('\n')
  .filter((l) => LOG_TAGS.some((t) => l.includes(t)));
const pct = (ok, total) => (total === 0 ? '—' : `${Math.round((ok / total) * 100)}%`);

// ⚠️ Список вкладок берём ГЕТТЕРОМ. Раньше здесь стоял трюк «создать about:blank, чтобы приехал
// SYNC_CHANGED» — он не только уродлив, но и портил сам замер: каждая проба добавляла лишнюю
// вкладку, а она попадала в кандидаты смыслового поиска и перебивала активную.
const tabsOf = (chrome) => chrome.evaluate('window.oblako.getSyncState().then(function(s){return s.tabs;})', 10000);

/**
 * Повтор одного случая. Твёрдое попадание — все прогоны сошлись; «шатко» — попало не всегда.
 * Для сравнения моделей это важнее среднего балла: фича, срабатывающая через раз, не работает.
 */
async function repeatCase(fn) {
  const from = appLog.length;
  const runs = [];
  for (let i = 0; i < REPEAT; i++) runs.push(await fn());
  const passed = runs.filter((r) => r.ok).length;
  return {
    ok: passed === runs.length,
    unstable: passed > 0 && passed < runs.length,
    passed,
    runs: runs.length,
    // Все исходы, а не только первый: у шаткого случая интересны именно расхождения.
    got: [...new Set(runs.map((r) => r.got))].join(' | '),
    ms: Math.round(runs.reduce((s, r) => s + (r.ms ?? 0), 0) / runs.length),
    log: taggedLinesSince(from),
  };
}

async function openFixtureTabs(chrome) {
  for (const t of TABS) {
    await chrome.evaluate(`window.oblako.createTab('${BASE}/${t.slug}').then(function(){return 1;})`, 20000);
  }
  // Ждём, пока заголовки реально доедут — иначе модель увидит вкладки без названий.
  for (let i = 0; i < 30; i++) {
    const tabs = await tabsOf(chrome);
    const titles = tabs.map((t) => t.title || '');
    if (TABS.every((t) => titles.some((x) => x.includes(t.title.slice(0, 18))))) return titles;
    await wait(1000);
  }
  return [];
}

async function suiteTabs(chrome) {
  const tabs = await tabsOf(chrome);
  const cases = [];
  for (const c of TAB_CASES) {
    const want = c.expect === null ? null : (Array.isArray(c.expect) ? c.expect : [c.expect]);
    const r = await repeatCase(async () => {
      const t0 = Date.now();
      const ids = await chrome.evaluate(`window.oblako.searchTabsSmart(${JSON.stringify(c.q)})`);
      const ms = Date.now() - t0;
      const url = ids?.[0] ? (tabs.find((t) => t.id === ids[0])?.url ?? '') : '';
      const got = TABS.find((t) => url.endsWith(`/${t.slug}`))?.slug ?? null;
      return { ok: want === null ? got === null : (got !== null && want.includes(got)), got: got ?? '—', ms };
    });
    cases.push({ ...r, name: c.q, want: c.expect === null ? 'отказ' : String(c.expect) });
  }
  return { id: 'tabs', title: 'Поиск вкладки по смыслу', cases };
}

async function suiteFind(chrome) {
  // Панель поиска живёт в своей вью со своим мостом — открываем её так же, как человек: Ctrl+F.
  await chrome.evaluate(`window.oblako.createTab('${BASE}/oferta').then(function(){return 1;})`, 20000);
  await wait(3000);
  const pageT = await findTarget((t) => t.url?.includes('/oferta'), 20);
  if (!pageT) return { id: 'find', title: 'Смысловой Ctrl+F', cases: [], error: 'страница оферты не открылась' };
  const page = connect(pageT); await page.ready;
  for (const type of ['rawKeyDown', 'keyUp']) {
    await page.send('Input.dispatchKeyEvent', { type, modifiers: 2, key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70 });
  }
  await wait(1500);
  const barT = await findTarget((t) => t.url?.includes('findbar.html'), 20);
  if (!barT) return { id: 'find', title: 'Смысловой Ctrl+F', cases: [], error: 'панель поиска не открылась' };
  const bar = connect(barT); await bar.ready;

  const cases = [];
  for (const c of FIND_CASES) {
    const r = await repeatCase(async () => {
      const t0 = Date.now();
      const res = await bar.evaluate(`window.findbar.smart(${JSON.stringify(c.q)})`);
      const ms = Date.now() - t0;
      const quotes = res?.ok ? (res.quotes ?? []) : [];
      // Ответ теперь список: засчитываем, если нужный фрагмент вообще попал в выдачу.
      return {
        ok: c.expect === null ? !res?.ok : quotes.some((q) => String(q).includes(c.expect)),
        got: res?.ok ? `${quotes.length} шт: ${quotes.map((q) => String(q).slice(0, 30)).join(' | ')}` : `отказ (${res?.reason ?? '?'})`,
        ms,
      };
    });
    cases.push({ ...r, name: c.q, want: c.expect === null ? 'отказ' : c.expect });
  }
  bar.close(); page.close();

  // ── Несколько подходящих мест на одной странице ──
  // Смена вкладки закрывает панель поиска (TabManager), поэтому открываем её заново.
  await chrome.evaluate(`window.oblako.createTab('${BASE}/games').then(function(){return 1;})`, 20000);
  await wait(3000);
  const gamesT = await findTarget((t) => t.url?.includes('/games'), 20);
  if (gamesT) {
    const games = connect(gamesT); await games.ready;
    for (const type of ['rawKeyDown', 'keyUp']) {
      await games.send('Input.dispatchKeyEvent', { type, modifiers: 2, key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70 });
    }
    await wait(1500);
    const bar2T = await findTarget((t) => t.url?.includes('findbar.html'), 20);
    if (bar2T) {
      const bar2 = connect(bar2T); await bar2.ready;
      const r = await repeatCase(async () => {
        const t0 = Date.now();
        const res = await bar2.evaluate(`window.findbar.smart('какие тут игры про магию и драконов')`);
        const ms = Date.now() - t0;
        const quotes = (res?.ok ? (res.quotes ?? []) : []).map((q) => String(q));
        // Верных ответов на странице три («Ночь драконов», «Хроники Эльдхейма», «Пепел
        // королевств»); ждём хотя бы два и ни одного постороннего.
        const good = quotes.filter((q) => /дракон|эльф|гном|магия|маги|заклинани/i.test(q)).length;
        return {
          ok: quotes.length >= 2 && good === quotes.length,
          got: `${quotes.length} шт: ${quotes.map((q) => q.slice(0, 28)).join(' | ')}`,
          ms,
        };
      });
      cases.push({ ...r, name: 'на подборке находит несколько мест, не одно', want: '≥2 и все по делу' });
      bar2.close();
    }
    games.close();
  }

  return { id: 'find', title: 'Смысловой Ctrl+F', cases };
}

async function suiteRules(chrome) {
  const cases = [];
  for (const c of RULE_CASES) {
    const r = await repeatCase(async () => {
      const t0 = Date.now();
      const res = await chrome.evaluate(`window.oblako.parseRule(${JSON.stringify(c.p)})`);
      const ms = Date.now() - t0;
      const rule = res?.ok ? res.rule : null;
      return {
        ok: c.expect === null
          ? !res?.ok
          : !!rule && rule.trigger.kind === c.expect.trigger && rule.trigger.domain === c.expect.domain && rule.action.kind === c.expect.action,
        got: rule ? `${rule.trigger.kind} ${rule.trigger.domain} → ${rule.action.kind}` : `отказ (${res?.reason ?? '?'})`,
        ms,
      };
    });
    cases.push({ ...r, name: c.p, want: c.expect === null ? 'отказ' : `${c.expect.trigger} ${c.expect.domain} → ${c.expect.action}` });
  }
  return { id: 'rules', title: 'Правила из фразы', cases };
}

async function suiteOrganize(chrome) {
  const from = appLog.length;
  const t0 = Date.now();
  const proposal = await chrome.evaluate(`window.oblako.suggestGroups()`);
  const ms = Date.now() - t0;
  // Темы первой фазы и итог раскладки — без них «не та группа» неотличимо от «не те темы».
  const log = taggedLinesSince(from);
  if (!proposal?.ok) {
    return { id: 'organize', title: 'AI-группировка вкладок', cases: [{ name: 'группировка', ok: false, got: `ошибка: ${proposal?.error ?? '?'}`, want: 'кластеры', ms }] };
  }
  const tabs = await tabsOf(chrome);
  const slugOf = (id) => TABS.find((t) => (tabs.find((x) => x.id === id)?.url ?? '').endsWith(`/${t.slug}`))?.slug ?? null;
  const clusters = proposal.clusters.map((c) => c.nodeIds.map(slugOf).filter(Boolean));
  const together = (a, b) => clusters.some((c) => c.includes(a) && c.includes(b));
  const covered = new Set(clusters.flat()).size;
  // ⚠️ Оцениваем не «красоту» раскладки, а три бесспорных факта: очевидно родственное — вместе,
  // очевидно чужое — врозь, и хоть что-то разложено. Всё остальное вкусовщина, мерить её нельзя.
  //
  // ⚠️ Требования «разложить половину вкладок» тут НЕТ намеренно, хотя сначала было. Фикстура
  // нарочно набрана из несвязанных страниц — половине из них не с кем группироваться, и такой
  // порог наказывал бы за осторожность. А осторожность здесь правильная: цена ошибки — живая
  // вкладка человека, унесённая в чужую группу. Поэтому проверяем ОШИБКИ, а охват смотрим глазами.
  const FORBIDDEN = [['ndfl', 'borsch'], ['ndfl', 'vue'], ['borsch', 'vue'], ['ndfl', 'vacuum'], ['borsch', 'train']];
  const wrongPair = FORBIDDEN.find(([a, b]) => together(a, b));
  return {
    id: 'organize', title: 'AI-группировка вкладок',
    cases: [
      { name: 'документация Vue и React в одной группе', ok: together('vue', 'react'), got: JSON.stringify(clusters), want: 'вместе', ms, log },
      { name: 'в группах нет заведомо чужих пар', ok: !wrongPair, got: wrongPair ? `${wrongPair[0]} + ${wrongPair[1]}: ${JSON.stringify(clusters)}` : 'нет', want: 'нет', ms: 0, log },
      { name: 'получилась хотя бы одна группа', ok: clusters.length > 0, got: `${clusters.length} групп, ${covered} вкладок`, want: '≥1', ms: 0, log },
    ],
  };
}

// Что должно попасть в умное имя вкладки. Проверяем не «красиво ли», а два бесспорных признака:
// имя называет ПРЕДМЕТ страницы и не начинается со слова-носителя («видео про…»), потому что
// формат человек и так видит по значку, а место в полосе вкладок крошечное.
const RENAME_EXPECT = {
  ndfl: /ндфл|налог/i,
  borsch: /борщ/i,
  vacuum: /пылесос/i,
  sochi: /погод|сочи/i,
  // Транслитерация — нормальное русское имя, а не промах: «реакт хуки» называет предмет точно.
  vue: /vue|вью/i,
  react: /react|реакт/i,
  train: /поезд|казан|расписан/i,
  vitd: /витамин/i,
};
const MEDIUM_START = /^(видео|ролик|стать|страниц|сайт|публикац|материал|подкаст|фильм)/i;

async function suiteRename(chrome) {
  const before = await tabsOf(chrome);
  const from = appLog.length;
  const t0 = Date.now();
  await chrome.evaluate('window.oblako.renameAllTabs().then(function(){return 1;})', 600000);
  const ms = Date.now() - t0;
  const after = await tabsOf(chrome);
  const log = taggedLinesSince(from);

  const named = [];
  for (const t of TABS) {
    const url = `${BASE}/${t.slug}`;
    const wasTitle = before.find((x) => x.url === url)?.title ?? '';
    const nowTitle = after.find((x) => x.url === url)?.title ?? '';
    if (!nowTitle || nowTitle === wasTitle) continue; // не переименована — считаем ниже отдельно
    named.push({ slug: t.slug, title: nowTitle });
  }

  const missed = named.filter((n) => !RENAME_EXPECT[n.slug].test(n.title));
  const medium = named.filter((n) => MEDIUM_START.test(n.title));
  const preview = named.map((n) => `${n.slug}: «${n.title}»`).join(' · ');
  return {
    id: 'rename', title: 'Умное имя вкладки',
    cases: [
      { name: 'имя называет предмет страницы', ok: missed.length === 0, got: preview || 'ни одна не переименована', want: 'ключевое слово темы в имени', ms, log },
      { name: 'имя не начинается с «видео/статья/сайт»', ok: medium.length === 0, got: medium.map((n) => n.title).join(', ') || 'нет', want: 'нет', ms: 0, log },
      { name: 'переименована хотя бы половина вкладок', ok: named.length >= Math.ceil(TABS.length / 2), got: `${named.length} из ${TABS.length}`, want: `≥${Math.ceil(TABS.length / 2)}`, ms: 0, log },
    ],
  };
}

const ALL_SUITES = [
  { id: 'tabs', run: suiteTabs },
  { id: 'find', run: suiteFind },
  { id: 'rules', run: suiteRules },
  { id: 'organize', run: suiteOrganize },
  // Переименование идёт ПОСЛЕДНИМ: оно меняет заголовки вкладок, а на них смотрят наборы выше.
  { id: 'rename', run: suiteRename },
];

// ── main ─────────────────────────────────────────────────────────────────────
let child = null;
try {
  prepareProfile();
  await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));

  child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    [`--remote-debugging-port=${CDP}`, `--user-data-dir=${PROFILE}`, ROOT],
    { env: { ...process.env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (d) => appLog.push(d.toString()));
  child.stderr.on('data', (d) => appLog.push(d.toString()));

  const chromeT = await findTarget((t) => t.url?.includes('index.html'));
  if (!chromeT) throw new Error('слой хрома не найден — приложение не поднялось');
  const chrome = connect(chromeT);
  await chrome.ready;

  const installed = await chrome.evaluate('window.oblako.getInstalledModels()');
  if (LIST_ONLY || !installed?.length) {
    line('\nУстановленные модели:');
    for (const m of installed ?? []) line(`  ${m.id}${m.label ? ` — ${m.label}` : ''}`);
    if (!installed?.length) line('  (ни одной — скачайте модель в Настройки → AI)');
    throw { quiet: true };
  }

  const defaultId = await chrome.evaluate('window.oblako.getDefaultModelId()');
  let model = installed.find((m) => m.id === defaultId) ?? installed[0];
  if (MODEL_HINT) {
    const hint = MODEL_HINT.toLowerCase();
    const target = installed.find((m) => `${m.id} ${m.label ?? ''}`.toLowerCase().includes(hint));
    if (!target) {
      line(`\nМодель по «${MODEL_HINT}» не установлена. Есть: ${installed.map((m) => m.id).join(', ')}`);
      throw { quiet: true };
    }
    await chrome.evaluate(`window.oblako.setDefaultModel(${JSON.stringify(target.id)})`);
    model = target;
  }
  // ⚠️ Смена дефолта не выгружает уже загруженную модель — выгружаем явно, иначе замерим прошлую.
  await chrome.evaluate('window.oblako.unloadModel()');
  await wait(1500);

  line(`\nМодель: ${model?.label ?? model?.id ?? 'по умолчанию'}`);
  line(`Профиль стенда: ${PROFILE}`);

  line('\nГотовлю вкладки…');
  await openFixtureTabs(chrome);

  // ⚠️ ПРОГРЕВ ОБЯЗАТЕЛЕН и он же — первый замер. Половина фич гейтится isModelWarm() и на
  // холодной модели молча отвечает пустотой: без прогрева стенд мерил бы не качество, а гейт
  // (первый прогон именно так и показал 1 из 7 у поиска вкладок при нулевом времени ответа).
  // Разбор фразы гейта не имеет — им и греем, заодно получая честную цену холодного старта.
  line('Прогреваю модель (это же и есть замер холодного старта)…');
  const coldT0 = Date.now();
  await chrome.evaluate(`window.oblako.parseRule('на сайте example.com закрепляй вкладки')`);
  const coldMs = Date.now() - coldT0;
  line(`  холодный старт: ${(coldMs / 1000).toFixed(1)}с`);

  const started = Date.now();
  for (const s of ALL_SUITES) {
    if (ONLY.length && !ONLY.includes(s.id)) continue;
    line(`\n── ${s.id} ──`);
    try {
      const result = await s.run(chrome);
      suites.push(result);
      for (const c of result.cases) {
        const mark = c.ok ? '✓' : c.unstable ? '~' : '✗';
        const shots = c.runs > 1 ? ` [${c.passed}/${c.runs}]` : '';
        line(`  ${mark} ${c.name}${shots}${c.ms ? `  ${(c.ms / 1000).toFixed(1)}с` : ''}`);
        if (!c.ok) {
          line(`      получили: ${c.got}\n      ждали:    ${c.want}`);
          // Сырой ответ модели — единственное, что отличает «модель не поняла» от «мы не разобрали».
          // До дюжины строк: у наборов, где прогон состоит из нескольких обращений к модели
          // (группировка — тема плюс по вкладке), одна строка не объясняет ничего.
          for (const l of (c.log ?? []).slice(0, 12)) line(`      ${l.trim().slice(0, 150)}`);
        }
      }
    } catch (e) {
      line(`  ✗ набор упал: ${e.message}`);
      suites.push({ id: s.id, title: s.id, cases: [], error: e.message });
    }
  }

  // ── итог ──
  line('\n' + '─'.repeat(64));
  line(`МОДЕЛЬ: ${model?.label ?? model?.id}   повторов на случай: ${REPEAT}`);
  line(`  холодный старт: ${(coldMs / 1000).toFixed(1)}с`);
  let totalOk = 0, total = 0, totalUnstable = 0;
  for (const s of suites) {
    const ok = s.cases.filter((c) => c.ok).length;
    totalUnstable += s.cases.filter((c) => c.unstable).length;
    totalOk += ok; total += s.cases.length;
    const times = s.cases.map((c) => c.ms).filter((m) => m > 0);
    const median = times.length ? times.sort((a, b) => a - b)[Math.floor(times.length / 2)] : 0;
    line(`  ${(s.title ?? s.id).padEnd(30)} ${String(ok).padStart(2)}/${String(s.cases.length).padEnd(2)}  ${pct(ok, s.cases.length).padStart(4)}`
      + (median ? `   медиана ${(median / 1000).toFixed(1)}с` : ''));
  }
  line(`  ${'ИТОГО'.padEnd(30)} ${String(totalOk).padStart(2)}/${String(total).padEnd(2)}  ${pct(totalOk, total).padStart(4)}`
    + (totalUnstable ? `   шатких: ${totalUnstable}` : ''));
  line(`  прогон занял ${Math.round((Date.now() - started) / 1000)}с`);
  line('─'.repeat(64));

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(RESULTS_DIR, `${(model?.id ?? 'default')}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({
    model: model?.id, label: model?.label, at: Date.now(),
    repeat: REPEAT, coldStartMs: coldMs, totalOk, total, totalUnstable, suites,
  }, null, 2), 'utf-8');
  line(`\nПодробности: ${path.relative(ROOT, file)}\n`);
} catch (e) {
  if (!e?.quiet) console.error('\nСтенд упал:', e?.message ?? e);
} finally {
  child?.kill();
  server.close();
  await wait(1500);
  cleanupProfile();
  process.exit(0);
}
