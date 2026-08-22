// Профиль «только через VPN» без туннеля: доходит ли ХОТЬ ОДИН запрос до сайта?
//
// ⚠️ Вопрос не риторический. На экране человек видел отрисованный YouTube с его собственной
// надписью «Нет подключения» — это выглядит так, будто страница загрузилась. Отвечать на такое
// рассуждением нельзя: эхо-сервер считает запросы сам.
import { withStand, wait } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

await withStand(async (ctx) => {
  const chrome = ctx.chrome;

  // Контрольный опыт: обычный профиль без ограничений ДОЛЖЕН достучаться до эха.
  const probe = `/before-${Date.now().toString(36)}`;
  await chrome.evaluate(
    `window.oblako.createTab(${JSON.stringify(ctx.echoUrl(probe))}).then(function(){return 1;})`,
  );
  await wait(2000);
  check('контроль: без ограничений запрос доходит',
    ctx.echo.hits.some((h) => String(h.url).includes(probe)),
    `хитов всего: ${ctx.echo.hits.length}`);

  // Заводим профиль «только через VPN». Туннель при этом ВЫКЛЮЧЕН.
  const created = await chrome.evaluate("window.oblako.createProfile('Строгий','orange')", 15000);
  const strictId = created?.profiles?.find((p) => p.id !== 'default')?.id ?? '';
  check('профиль заведён', !!strictId, strictId);
  await chrome.evaluate(`window.oblako.setProfileSettings(${JSON.stringify(strictId)}, { vpn: 'on' })`);
  await chrome.evaluate(`window.oblako.switchProfile(${JSON.stringify(strictId)})`);
  const vpn = await chrome.evaluate('window.oblako.getVpnConnectionState()');
  check('туннель действительно выключен', vpn?.state !== 'running', String(vpn?.state));

  const before = ctx.echo.hits.length;
  const guarded = `/guarded-${Date.now().toString(36)}`;
  await chrome.evaluate(
    `window.oblako.createTab(${JSON.stringify(ctx.echoUrl(guarded))}).then(function(){return 1;})`,
  );
  // Ждём заведомо дольше, чем нужно на запрос к локальному серверу.
  await wait(4000);

  const leaked = ctx.echo.hits.filter((h) => String(h.url).includes(guarded));
  // ⚠️ ГЛАВНАЯ ПРОВЕРКА ФАЙЛА: сайт не получил НИ ОДНОГО запроса.
  check('сайт не получил ни одного запроса', leaked.length === 0,
    leaked.length ? `утекло: ${JSON.stringify(leaked.map((h) => h.url))}` : 'ноль запросов');
  check('и вообще новых хитов нет', ctx.echo.hits.length === before,
    `было ${before}, стало ${ctx.echo.hits.length}`);

  // Обратно в основной профиль — там ограничения нет, связь обязана вернуться.
  await chrome.evaluate("window.oblako.switchProfile('default')");
  const after = `/after-${Date.now().toString(36)}`;
  await chrome.evaluate(
    `window.oblako.createTab(${JSON.stringify(ctx.echoUrl(after))}).then(function(){return 1;})`,
  );
  await wait(2500);
  // ⚠️ Это и есть «приватность как опция»: строгий профиль замер, соседний работает.
  check('соседний профиль продолжает работать',
    ctx.echo.hits.some((h) => String(h.url).includes(after)));
});

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
