// Панель приложений в лёгком окне. Не *-check.mjs — поднимает настоящее приложение.
//
// ⚠️ ЗАВЕДЕНО ПОТОМУ, ЧТО ЭТО ЕДИНСТВЕННЫЙ СЛОЙ, КОТОРЫЙ ЭТО ВИДИТ. Панель перестала быть
// синглтоном на приложение (была: panelView/attachedWin/isOpen модульными переменными в
// AiPanelManager.ts) и стала пооконной — а «одна вью на два окна» ломается не типами и не чистой
// логикой, а живьём: WebContentsView — ребёнок КОНКРЕТНОГО contentView, и второе окно просто
// уводит её у первого. На экране это выглядит как «панель исчезла сама, а место под неё осталось».
//
// ⚠️ Проверяется и АДРЕС документа. Вид панели решает main (полная — с чатом, лёгкая — только
// домашний экран приложений), и передаётся он параметром адреса. Промах здесь тихий: renderer
// соберёт дерево с чатом, тот подпишется на свои каналы и станет греть модель по фокусу в поле
// ввода — в окне, где беседы быть не может.
//
// Запуск: npm run drive -- light-window-panel
import { withStand, wait, connectCdp } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

const E = "process.mainModule.require('electron')";
// Окна в порядке создания: главное поднимается первым, лёгкое — по window:open из чрома.
const WINS = `${E}.BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())`;
const PANEL_URLS = `${E}.webContents.getAllWebContents()
  .map((w) => w.getURL()).filter((u) => u.includes('aipanel.html'))`;
// Сколько вью лежит в окне. Открытая панель — это +1 ребёнок contentView, и это единственный
// признак показа, который видно СНАРУЖИ модуля: публичного «панель открыта» у Electron нет.
const KIDS = `${WINS}.map((w) => w.contentView.children.length)`;
// ⚠️ Тоггл идёт ТЕМ ЖЕ путём, что у кнопки в тулбаре, — через window.oblako из слоя хрома нужного
// окна (первый ребёнок contentView, его добавляют раньше вкладок). Дёргать AiPanelManager напрямую
// было бы проверкой функции, а не проводки, а ломается обычно как раз проводка.
const toggleIn = (i) => `(${WINS}[${i}].contentView.children[0].webContents
  .executeJavaScript('window.oblako.toggleAiPanel()'), 1)`;

await withStand(async (ctx) => {
  // Панели греются отложенно (см. AI_PANEL_PREWARM_DELAY_MS) — ждём вместе с показом окна.
  await wait(5000);

  check('своё окно одно', (await ctx.evalMain(`${WINS}.length`)) === 1);
  await ctx.chrome.evaluate('window.oblako.openWindow()');
  // Второму окну нужно и подняться, и дождаться своего отложенного прогрева панели.
  await wait(5000);

  const wins = await ctx.evalMain(`${WINS}.length`);
  check('лёгкое окно открылось', wins === 2, `окон ${wins}`);
  if (wins !== 2) return;

  const urls = await ctx.evalMain(PANEL_URLS);
  check('панелей ДВЕ, по одной на окно', urls.length === 2, `вью: ${urls.length}`);
  check('в лёгком окне документ панели просит вид «приложения»',
    urls.filter((u) => u.includes('kind=apps')).length === 1,
    urls.map((u) => u.split('/').pop()).join(' , '));
  check('в главном окне панель осталась полной',
    urls.filter((u) => !u.includes('kind=apps')).length === 1);

  // ── Что там нарисовано ────────────────────────────────────────────────────
  // ⚠️ Адрес документа — ещё не экран: с тем же ?kind=apps renderer мог бы собрать пустоту или,
  // наоборот, обычную панель с чатом. Смотрим в саму страницу лёгкой панели.
  const target = await ctx.findTarget((t) => (t.url || '').includes('kind=apps'));
  check('страница лёгкой панели нашлась в отладчике', !!target);
  if (target) {
    const cdp = connectCdp(target);
    await cdp.ready;
    const dom = await cdp.evaluate(`({
      apps: document.body.innerText.includes('Калькулятор'),
      inputs: document.querySelectorAll('textarea').length,
    })`);
    cdp.close();
    check('в лёгком окне нарисован домашний экран приложений', dom?.apps === true);
    check('и поля ввода чата там нет', dom?.inputs === 0, `textarea: ${dom?.inputs}`);
  }

  const base = await ctx.evalMain(KIDS);

  // ── Открытие: панель показывается в СВОЁМ окне ────────────────────────────
  await ctx.evalMain(toggleIn(1));
  await wait(700);
  const light = await ctx.evalMain(KIDS);
  check('панель открылась в лёгком окне', light[1] === base[1] + 1, `${base[1]} → ${light[1]} вью`);
  check('и только в нём — главное окно не тронуто', light[0] === base[0], `${base[0]} → ${light[0]} вью`);

  // ── И обе живут одновременно ──────────────────────────────────────────────
  await ctx.evalMain(toggleIn(0));
  await wait(700);
  const both = await ctx.evalMain(KIDS);
  check('панели открыты в обоих окнах разом',
    both[0] === base[0] + 1 && both[1] === base[1] + 1, `${both[0]} / ${both[1]} вью`);

  // ⚠️ Закрытие одной не должно трогать другую: раньше состояние показа было общим на приложение,
  // и «закрыть» из любого окна гасило единственную панель — второе про это даже не узнавало.
  await ctx.evalMain(toggleIn(1));
  await wait(700);
  const after = await ctx.evalMain(KIDS);
  check('закрыли в лёгком — в главном осталась открытой',
    after[1] === base[1] && after[0] === base[0] + 1, `${after[0]} / ${after[1]} вью`);
}, { main: true });

console.log(`
Итого: ${ok} прошло, ${bad} не прошло
`);
process.exit(bad === 0 ? 0 : 1);
