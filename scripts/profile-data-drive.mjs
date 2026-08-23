// Живая проверка ИЗОЛЯЦИИ ДАННЫХ между профилями: история и закладки (пункт A1 карты).
// Не *-check.mjs — поднимает приложение, в npm test не входит.
//
// Главный вопрос: закладка, заведённая в профиле А, действительно НЕ видна в профиле Б —
// и наоборот. До этой правки обе базы были общими на приложение, и человеку про это было
// написано в настройках; написанное предупреждение — заплатка, а не изоляция.
//
// ⚠️ Профиль изолированный (свой --user-data-dir во временной папке), боевые базы не трогаются.
import { withStand, wait } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

const has = (list, url) => (list ?? []).some((b) => String(b.url).includes(url));

await withStand(async (ctx) => {
  const chrome = ctx.chrome;
  const token = `t${Date.now().toString(36)}`;
  const mainUrl = `https://example.com/main-${token}`;
  const workUrl = `https://example.com/work-${token}`;

  // ── Закладки ────────────────────────────────────────────────────────────────
  await chrome.evaluate(`window.oblako.addBookmark(${JSON.stringify(mainUrl)}, 'Основная')`);
  const mainList = await chrome.evaluate('window.oblako.listBookmarks()');
  check('закладка основного профиля заведена', has(mainList, mainUrl));

  const created = await chrome.evaluate("window.oblako.createProfile('Работа','green')", 15000);
  const workId = created?.profiles?.find((p) => p.id !== 'default')?.id ?? '';
  check('второй профиль заведён', !!workId, workId);

  await chrome.evaluate(`window.oblako.switchProfile(${JSON.stringify(workId)})`, 20000);
  await wait(600);

  // ⚠️ Главный случай всей задачи. Если он падает — обещание «профиль это отдельное место»
  // не выполнено, и никакие настройки внешности этого не исправят.
  const workEmpty = await chrome.evaluate('window.oblako.listBookmarks()');
  check('в новом профиле закладок основного НЕТ', !has(workEmpty, mainUrl),
    `видно ${(workEmpty ?? []).length} шт.`);

  await chrome.evaluate(`window.oblako.addBookmark(${JSON.stringify(workUrl)}, 'Рабочая')`);
  const workList = await chrome.evaluate('window.oblako.listBookmarks()');
  check('своя закладка в новом профиле видна', has(workList, workUrl));

  await chrome.evaluate("window.oblako.switchProfile('default')", 20000);
  await wait(600);
  const backList = await chrome.evaluate('window.oblako.listBookmarks()');
  check('вернулись — своя закладка на месте', has(backList, mainUrl));
  check('и чужая не протекла обратно', !has(backList, workUrl));

  // ── История ─────────────────────────────────────────────────────────────────
  // Визит пишется реальной навигацией: recordVisit зовётся из did-navigate, отдельного
  // канала «записать визит» нет — и это правильно, синтетическая запись проверяла бы не то.
  const echoMain = ctx.echoUrl(`/hist-main-${token}`);
  const echoWork = ctx.echoUrl(`/hist-work-${token}`);
  await chrome.evaluate(`window.oblako.createTab(${JSON.stringify(echoMain)}).then(function(){return 1;})`);
  await wait(1200);
  const histMain = await chrome.evaluate(`window.oblako.searchHistory('hist-main-${token}')`);
  check('визит попал в историю основного профиля', (histMain ?? []).length > 0);

  await chrome.evaluate(`window.oblako.switchProfile(${JSON.stringify(workId)})`, 20000);
  await wait(600);
  const histCross = await chrome.evaluate(`window.oblako.searchHistory('hist-main-${token}')`);
  check('в новом профиле визита основного НЕТ', (histCross ?? []).length === 0,
    `нашлось ${(histCross ?? []).length}`);

  await chrome.evaluate(`window.oblako.createTab(${JSON.stringify(echoWork)}).then(function(){return 1;})`);
  await wait(1200);
  const histWork = await chrome.evaluate(`window.oblako.searchHistory('hist-work-${token}')`);
  check('свой визит в новом профиле записан', (histWork ?? []).length > 0);

  await chrome.evaluate("window.oblako.switchProfile('default')", 20000);
  await wait(600);
  const histBack = await chrome.evaluate(`window.oblako.searchHistory('hist-work-${token}')`);
  check('и чужой визит не виден в основном', (histBack ?? []).length === 0);

  const histOwn = await chrome.evaluate(`window.oblako.searchHistory('hist-main-${token}')`);
  check('свой визит после круга переключений цел', (histOwn ?? []).length > 0);
});

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
