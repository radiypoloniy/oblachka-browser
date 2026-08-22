// Живая проверка профилей на ИЗОЛИРОВАННОМ профиле (правило CLAUDE.md).
// Не *-check.mjs — поднимает приложение, в npm test не входит.
//
// Главный вопрос, ради которого всё затевалось: у второго профиля ДЕЙСТВИТЕЛЬНО свои куки?
import { withStand, connectCdp, wait } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

async function onGuest(ctx, needle, fn) {
  const t = await ctx.findTarget((x) => typeof x.url === 'string' && x.url.includes(needle), 50);
  if (!t) throw new Error(`нет таргета для ${needle}`);
  const page = connectCdp(t);
  await page.ready;
  try { return await fn(page); } finally { page.close(); }
}

await withStand(async (ctx) => {
  const chrome = ctx.chrome;
  const token = `t${Date.now().toString(36)}`;

  const start = await chrome.evaluate('window.oblako.getProfiles()');
  check('профиль по умолчанию один', start?.profiles?.length === 1, JSON.stringify(start?.profiles?.[0]?.id));
  check('он активен', start?.activeId === 'default');

  // Ставим куку в основном профиле.
  await chrome.evaluate(
    `window.oblako.createTab(${JSON.stringify(ctx.echoUrl(`/set-cookie?name=main_${token}&value=MAIN`))}).then(function(){return 1;})`,
  );
  await wait(900);

  const created = await chrome.evaluate("window.oblako.createProfile('Работа','green')", 15000);
  const workId = created?.profiles?.find((p) => p.id !== 'default')?.id ?? '';
  check('второй профиль заведён', !!workId, workId);
  check('основной остался первым', created?.profiles?.[0]?.id === 'default');

  await chrome.evaluate(`window.oblako.switchProfile(${JSON.stringify(workId)})`);
  const afterSwitch = await chrome.evaluate('window.oblako.getProfiles()');
  check('переключились', afterSwitch?.activeId === workId);

  // ⚠️ ГЛАВНОЕ: новая вкладка в другом профиле не должна видеть куку основного.
  await chrome.evaluate(
    `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/show-cookie?who=work'))}).then(function(){return 1;})`,
  );
  await wait(1100);
  let workCookie = '';
  try {
    workCookie = await onGuest(ctx, 'who=work', async (page) => {
      const body = await page.evaluate('document.body.innerText');
      try { return JSON.parse(body).cookie ?? ''; } catch { return String(body); }
    });
  } catch (e) { check('вкладка профиля «Работа» открылась', false, e.message); }
  check('кука основного профиля НЕ видна в новом', !workCookie.includes(`main_${token}`),
    workCookie ? `видно: ${workCookie.slice(0, 60)}` : 'пусто — как и должно быть');

  // Ставим свою куку в рабочем профиле и возвращаемся в основной.
  await chrome.evaluate(
    `window.oblako.createTab(${JSON.stringify(ctx.echoUrl(`/set-cookie?name=work_${token}&value=WORK`))}).then(function(){return 1;})`,
  );
  await wait(900);
  await chrome.evaluate("window.oblako.switchProfile('default')");
  await chrome.evaluate(
    `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/show-cookie?who=back'))}).then(function(){return 1;})`,
  );
  await wait(1100);
  let backCookie = '';
  try {
    backCookie = await onGuest(ctx, 'who=back', async (page) => {
      const body = await page.evaluate('document.body.innerText');
      try { return JSON.parse(body).cookie ?? ''; } catch { return String(body); }
    });
  } catch (e) { check('вкладка основного профиля открылась', false, e.message); }
  check('своя кука в основном на месте', backCookie.includes(`main_${token}`), backCookie.slice(0, 60));
  check('кука рабочего профиля в основной НЕ протекла', !backCookie.includes(`work_${token}`));

  // Настройки профиля переживают запись и читаются обратно.
  await chrome.evaluate(`window.oblako.setProfileSettings(${JSON.stringify(workId)}, { vpn: 'off' })`);
  const withVpn = await chrome.evaluate('window.oblako.getProfiles()');
  const work = withVpn?.profiles?.find((p) => p.id === workId);
  check('настройка VPN профиля сохранилась', work?.settings?.vpn === 'off', JSON.stringify(work?.settings));

  // ⚠️ Основной удалить нельзя: это сессия, где лежат данные человека.
  const afterRemove = await chrome.evaluate("window.oblako.removeProfile('default')");
  check('основной профиль не удаляется', afterRemove?.profiles?.some((p) => p.id === 'default'));

  const gone = await chrome.evaluate(`window.oblako.removeProfile(${JSON.stringify(workId)})`);
  check('обычный профиль удаляется', !gone?.profiles?.some((p) => p.id === workId));
  check('активным стал основной', gone?.activeId === 'default');
});

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
