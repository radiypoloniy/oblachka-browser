// Живая проверка: модальный экран хрома ПРЯЧЕТ содержимое (см. TabManager.setChromeModal).
// Не *-check.mjs — поднимает приложение, в npm test не входит.
//
// ⚠️ Ради чего заведена. React рисует рамку, а WebContentsView страницы кладётся ПОВЕРХ неё.
// Значит модалка, нарисованная React по центру окна, при открытой странице оказывается ПОД ней:
// человек видит потемневшие сайдбар и тулбар, но не карточку с кнопками. Живой случай 23.08 —
// выбор профиля при старте: браузер выглядел зависшим и требующим выбора, которого не показывал,
// и пользоваться им было нельзя.
//
// ⚠️ Не document.visibilityState. На Windows у показанной и сфокусированной WebContentsView
// (есть размер, hasFocus, стоит поверх хрома) Page Visibility остаётся hidden — сигнал не
// отличает показанную страницу от спрятанной. Прячет модалку setVisible, его и читаем.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withStand, wait } from './isolated-stand.mjs';

const REG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-electron', 'electron', 'WindowRegistry.js');

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

await withStand(async (ctx) => {
  const chrome = ctx.chrome;
  const viewExpr = `(() => {
    const { mainContext } = process.mainModule.require(${JSON.stringify(REG)});
    const tabs = mainContext().tabs;
    const out = [];
    for (const [id, t] of tabs.tabMap) {
      const url = t.view && t.view.webContents ? t.view.webContents.getURL() : '';
      const vis = !!(t.view && t.view.getVisible && t.view.getVisible());
      const b = t.view && t.view.getBounds ? t.view.getBounds() : { width: 0, height: 0 };
      out.push({ id, url, vis, w: b.width, h: b.height });
    }
    return { modal: !!tabs.chromeModal, activeId: tabs.activeId, views: out };
  })()`;
  const views = async () => {
    let raw = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      raw = await ctx.main.send('Runtime.evaluate', {
        expression: viewExpr, returnByValue: true,
      });
      if (raw?.error?.message !== 'Promise was collected') break;
      await wait(150);
    }
    if (!raw?.result?.result) throw new Error(`main не ответил: ${JSON.stringify(raw).slice(0, 500)}`);
    if (raw.result.exceptionDetails) {
      throw new Error(String(raw.result.exceptionDetails.exception?.description ?? 'ошибка main').slice(0, 400));
    }
    return raw.result.result.value;
  };

  const url = ctx.echoUrl('/modal-probe');
  await chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)}).then(function(){return 1;})`);

  // Под нагрузкой полного прогона bounds догоняют создание вкладки не за три секунды,
  // а в карте может лежать ещё пустая вью с тем же адресом. Показана та, у которой есть размер.
  let probe = null;
  for (let i = 0; i < 40; i++) {
    const s = await views();
    const probes = s.views.filter((v) => v.url.includes('modal-probe'));
    probe = probes.find((v) => v.vis && v.w > 0) ?? probes[0] ?? null;
    if (probe?.vis && probe.w > 0) break;
    await wait(200);
  }
  check('страница видна до модалки', !!(probe?.vis && probe.w > 0), JSON.stringify(probe));

  await chrome.evaluate('window.oblako.setChromeModal(true)');
  await wait(400);
  const hidden = await views();
  check('под модалкой страница спрятана', hidden.modal && hidden.views.every((v) => !v.vis),
    JSON.stringify(hidden.views.map((v) => v.vis)));

  // ⚠️ Отдельный случай: фоновая навигация под модалкой не имеет права вернуть страницу
  // поверх карточки (did-navigate зовёт revealView).
  await chrome.evaluate(`window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/modal-second'))}).then(function(){return 1;})`);
  await wait(1000);
  const during = await views();
  check('новая вкладка под модалкой тоже не показывается', during.views.every((v) => !v.vis),
    JSON.stringify(during.views.map((v) => [v.url.split('/').pop(), v.vis])));

  await chrome.evaluate('window.oblako.setChromeModal(false)');
  await wait(600);
  const after = await chrome.evaluate('window.oblako.getAllTabs()');
  check('после снятия модалки вкладки на месте', (after ?? []).length >= 2, `${(after ?? []).length} шт.`);

  // ⚠️ Главный случай снятия: страница обязана ВЕРНУТЬСЯ. Ошибка здесь тише исходной — человек
  // выбрал профиль, карточка ушла, а область контента осталась пустой.
  const probeTab = (after ?? []).find((t) => String(t.url).includes('modal-probe'));
  check('вкладка пробы жива', !!probeTab, probeTab?.id ?? '');
  if (probeTab) {
    await chrome.evaluate(`window.oblako.activateTab(${JSON.stringify(probeTab.id)})`);
    let back = null;
    for (let i = 0; i < 15; i++) {
      const s = await views();
      back = s.views.find((v) => v.id === probeTab.id);
      if (back?.vis && back.w > 0 && !s.modal) break;
      await wait(200);
    }
    check('страница вернулась после снятия модалки', !!(back?.vis && back.w > 0), JSON.stringify(back));
  }
}, { main: true });

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
