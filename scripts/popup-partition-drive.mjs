// Живая проверка: в КАКОЙ сессии живёт настоящий попап (OAuth-окно), открытый из приватной вкладки.
// Не *-check.mjs — поднимает приложение, в npm test не входит.
//
// ⚠️ Вопрос из аудита 23.08, находка 8, там помеченная «не воспроизведена». По коду
// (TabManager.#wireWindowOpenPolicy) окно настоящего попапа создаётся с
// overrideBrowserWindowOptions.webPreferences БЕЗ partition — и отсюда читается страшное: попап из
// инкогнито садится на defaultSession, то есть куки входа из приватной вкладки остаются в обычном
// профиле навсегда. Но у Chromium дочернее окно с живым window.opener ОБЯЗАНО делить контекст с
// открывшей страницей, иначе opener не работает — а он там нужен (OAuth-провайдер шлёт
// window.opener.postMessage с токеном). То есть чтение кода даёт две противоположные гипотезы, и
// решается это только замером.
//
// Меряем ДВА уровня, потому что поодиночке каждый неубедителен:
//   • тождество сессий в main — диагностика, отвечает «почему»;
//   • видимость куки попапа из ОБЫЧНОЙ вкладки — то, что человеку реально вредит.
// Плюс контроль: кука самой приватной вкладки тоже не должна быть видна снаружи. Без него зелёный
// результат ничего не значит — он мог бы означать «инкогнито не работает вовсе, и утекать нечему».
//
// Запуск: npm run drive -- popup-partition
import { withStand, connectCdp, wait } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

async function onGuest(ctx, needle, fn) {
  const t = await ctx.findTarget((x) => typeof x.url === 'string' && x.url.includes(needle), 60);
  if (!t) throw new Error(`нет таргета для ${needle}`);
  const page = connectCdp(t);
  await page.ready;
  try { return await fn(page); } finally { page.close(); }
}

await withStand(async (ctx) => {
  const chrome = ctx.chrome;
  const token = `t${Date.now().toString(36)}`;
  const POPUP_COOKIE = `oauthpop_${token}`;
  const INCOG_COOKIE = `incogself_${token}`;

  // ── 1. Приватная вкладка с обычной HTML-страницей: из неё будем открывать попап ──
  await chrome.evaluate(
    `window.oblako.createIncognitoTab(${JSON.stringify(ctx.echoUrl('/page?who=opener'))}).then(function(){return 1;})`,
  );
  await wait(1200);

  // Кука самой приватной вкладки — контроль изоляции (см. шапку).
  await onGuest(ctx, 'who=opener', async (page) => {
    await page.evaluate(`fetch(${JSON.stringify(ctx.echoUrl(`/set-cookie?name=${INCOG_COOKIE}&value=INCOG`))}).then(function(){return 1;})`);
  });
  await wait(400);

  // ── 2. Открываем НАСТОЯЩИЙ попап: имя окна + размеры, ровно как это делает OAuth-провайдер ──
  // ⚠️ userGesture обязателен: без отметки о жесте Chromium режет window.open как всплывающее окно,
  // и проверка мерила бы блокировщик попапов, а не сессии.
  const popupUrl = ctx.echoUrl(`/set-cookie?name=${POPUP_COOKIE}&value=LEAK&who=popup`);
  await onGuest(ctx, 'who=opener', async (page) => {
    await page.send('Runtime.evaluate', {
      expression: `window.open(${JSON.stringify(popupUrl)}, 'oauthwin', 'width=420,height=420')`,
      userGesture: true,
      returnByValue: true,
    });
  });
  await wait(1500);

  // ── 3. Диагностика: тождество сессий глазами main-процесса ──
  const sessions = await ctx.evalMain(`(() => {
    const { webContents, session } = process.mainModule.require('electron');
    const all = webContents.getAllWebContents();
    const popup = all.find((w) => w.getURL().includes('who=popup'));
    const opener = all.find((w) => w.getURL().includes('who=opener'));
    if (!popup || !opener) return { found: false, urls: all.map((w) => w.getURL()).slice(0, 12) };
    return {
      found: true,
      popupIsDefault: popup.session === session.defaultSession,
      openerIsDefault: opener.session === session.defaultSession,
      shareSession: popup.session === opener.session,
    };
  })()`);

  check('попап найден в main', sessions?.found === true, sessions?.found ? '' : JSON.stringify(sessions?.urls));
  if (sessions?.found) {
    check('приватная вкладка НЕ в сессии по умолчанию', sessions.openerIsDefault === false);
    // ⚠️ Главный вопрос находки 8.
    check('попап НЕ в сессии по умолчанию', sessions.popupIsDefault === false,
      sessions.popupIsDefault ? 'куки входа из инкогнито уходят в обычный профиль' : 'сессия унаследована от открывшей вкладки');
    check('попап делит сессию с открывшей вкладкой', sessions.shareSession === true);
  }

  // ── 3б. ПОЛОЖИТЕЛЬНЫЙ контроль: внутри приватной сессии кука попапа обязана быть ВИДНА ──
  // ⚠️ Без него весь замер вакуумно зелёный. «Куки попапа нет в обычной вкладке» — правда и в том
  // случае, когда попап вообще ничего не записал (не открылся, ошибся адресом, запрос не дошёл).
  // Эта строка доказывает, что кука реально существует, и значит предыдущим проверкам есть что
  // ловить: она лежит именно в приватной сессии, а не нигде.
  let incogCookies = '';
  try {
    incogCookies = await onGuest(ctx, 'who=opener', async (page) => page.evaluate(
      `fetch(${JSON.stringify(ctx.echoUrl('/show-cookie'))}).then(function(r){return r.json();}).then(function(j){return j.cookie || '';})`,
    ));
  } catch (e) {
    check('приватная вкладка отвечает', false, e.message);
  }
  check('кука попапа ВИДНА внутри приватной сессии', incogCookies.includes(POPUP_COOKIE),
    incogCookies ? `видно: ${incogCookies.slice(0, 90)}` : 'пусто — попап ничего не записал, замер ниже ничего не значит');

  // ── 4. Что реально вредит: видна ли кука попапа из ОБЫЧНОЙ вкладки ──
  await chrome.evaluate(
    `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/show-cookie?who=normal'))}).then(function(){return 1;})`,
  );
  await wait(1200);
  let normalCookies = '';
  try {
    normalCookies = await onGuest(ctx, 'who=normal', async (page) => {
      const body = await page.evaluate('document.body.innerText');
      try { return JSON.parse(body).cookie ?? ''; } catch { return String(body); }
    });
  } catch (e) {
    check('обычная вкладка открылась', false, e.message);
  }

  check('кука попапа НЕ видна в обычной вкладке', !normalCookies.includes(POPUP_COOKIE),
    normalCookies.includes(POPUP_COOKIE) ? 'УТЕЧКА: попап писал в обычный профиль' : 'чисто');
  // Контроль: без него зелёная строка выше могла бы означать «инкогнито не пишет кук вообще».
  check('контроль — кука самой приватной вкладки тоже не видна', !normalCookies.includes(INCOG_COOKIE),
    normalCookies ? `видно: ${normalCookies.slice(0, 80)}` : 'обычная вкладка без кук');

  console.log(`\nИтого: ${ok} ок, ${bad} провалено`);
  if (bad > 0) process.exitCode = 1;
}, { main: true });
