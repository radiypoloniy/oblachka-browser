// Живая проверка: модальный экран хрома ПРЯЧЕТ содержимое (см. TabManager.setChromeModal).
// Не *-check.mjs — поднимает приложение, в npm test не входит.
//
// ⚠️ Ради чего заведена. React рисует рамку, а WebContentsView страницы кладётся ПОВЕРХ неё.
// Значит модалка, нарисованная React по центру окна, при открытой странице оказывается ПОД ней:
// человек видит потемневшие сайдбар и тулбар, но не карточку с кнопками. Живой случай 23.08 —
// выбор профиля при старте: браузер выглядел зависшим и требующим выбора, которого не показывал,
// и пользоваться им было нельзя.
//
// Проверяем через document.visibilityState самой страницы: скрытая вьюха переводит её в 'hidden'.
// Это единственный признак, наблюдаемый снаружи, — «видно ли карточку» машине недоступно.
import { withStand, connectCdp, wait } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

await withStand(async (ctx) => {
  const chrome = ctx.chrome;
  const url = ctx.echoUrl('/modal-probe');
  await chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)}).then(function(){return 1;})`);
  await wait(1200);

  const target = await ctx.findTarget((x) => typeof x.url === 'string' && x.url.includes('modal-probe'), 50);
  if (!target) throw new Error('вкладка с пробой не найдена');
  const page = connectCdp(target);
  await page.ready;

  try {
    const state = async () => page.evaluate('document.visibilityState');

    check('страница видна до модалки', (await state()) === 'visible');

    await chrome.evaluate('window.oblako.setChromeModal(true)');
    await wait(400);
    check('под модалкой страница спрятана', (await state()) === 'hidden', await state());

    // ⚠️ Отдельный случай: фоновая навигация под модалкой не имеет права вернуть страницу
    // поверх карточки (did-navigate зовёт revealView).
    await chrome.evaluate(`window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/modal-second'))}).then(function(){return 1;})`);
    await wait(1000);
    check('новая вкладка под модалкой тоже не показывается', (await state()) === 'hidden');

    await chrome.evaluate('window.oblako.setChromeModal(false)');
    await wait(600);
    const after = await chrome.evaluate('window.oblako.getAllTabs()');
    check('после снятия модалки вкладки на месте', (after ?? []).length >= 2, `${(after ?? []).length} шт.`);

    // ⚠️ Главный случай снятия: страница обязана ВЕРНУТЬСЯ. Ошибка здесь тише исходной — человек
    // выбрал профиль, карточка ушла, а область контента осталась пустой.
    const probe = (after ?? []).find((t) => String(t.url).includes('modal-probe'));
    check('вкладка пробы жива', !!probe, probe?.id ?? '');
    if (probe) {
      await chrome.evaluate(`window.oblako.activateTab(${JSON.stringify(probe.id)})`);
      await wait(700);
      check('страница вернулась после снятия модалки', (await state()) === 'visible', await state());
    }
  } finally {
    page.close();
  }
});

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
