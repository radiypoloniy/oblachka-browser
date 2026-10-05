// Проверяем настоящие IPC поповера на пустом профиле: неизвестный отправитель раньше
// молча получал false и при генерации, и при выборе сохранённого входа.
import assert from 'node:assert/strict';
import { withStand, connectCdp, wait } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const url = ctx.echoUrl('/');
  await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`);
  await wait(1000);
  const pageTarget = await ctx.findTarget((t) => t.url?.startsWith(url));
  assert.ok(pageTarget, 'Тестовая вкладка не загрузилась');
  const page = connectCdp(pageTarget);
  await page.ready;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await page.evaluate('document.readyState === "complete" && !!document.body')) break;
    await wait(100);
  }
  await page.evaluate(`(() => {
    const body = document.body ?? document.documentElement.appendChild(document.createElement('body'));
    body.innerHTML = '<form><input id="user" autocomplete="username" value="tester"><input id="pass" type="password" autocomplete="new-password"></form>';
    return true;
  })()`);
  await wait(600);
  const setup = await ctx.evalMainSync(`(() => {
    const path = process.mainModule.require('node:path');
    const load = (name) => process.mainModule.require(path.join(process.cwd(), 'dist-electron', 'electron', name + '.js'));
    const registry = load('WindowRegistry');
    const ctx = registry.allContexts()[0];
    const wc = ctx.tabs.getActiveWebContents();
    const origin = new URL(wc.getURL()).origin;
    const flow = load('PasswordAutofillManager');
    const popover = load('PasswordPopoverManager');
    const state = flow.handleFieldInteraction(ctx.win, ctx.tabs.getActiveId(), wc.getURL(), 'icon', { role: 'new', formKind: 'signup' });
    popover.showPasswordPopover(ctx.win, state);
    // DOM сайта может измениться между открытием карточки и нажатием кнопки.
    flow.handleFormDetected(ctx.win, ctx.tabs.getActiveId(), true, true, wc.getURL());
    return { origin, kind: state.kind };
  })()`);
  assert.equal(setup.kind, 'offer-generate');
  const target = await ctx.findTarget((t) => t.url?.includes('passwordpopover.html'));
  assert.ok(target, 'Поповер не загрузился');
  const popover = connectCdp(target);
  await popover.ready;
  await wait(500);
  try {
    assert.equal(await popover.evaluate('window.passwordPopover.generatePendingPassword()'), true,
      'Генерация через IPC поповера должна работать');
    await wait(100);
    assert.equal(await page.evaluate('document.getElementById("pass").value.length'), 20);
    assert.equal(await page.evaluate('document.getElementById("user").value'), 'tester');
    const generated = await page.evaluate('document.getElementById("pass").value');
    const state = await ctx.evalMainSync(`(() => {
      const path = process.mainModule.require('node:path');
      const load = (name) => process.mainModule.require(path.join(process.cwd(), 'dist-electron', 'electron', name + '.js'));
      const ctx = load('WindowRegistry').allContexts()[0];
      const flow = load('PasswordAutofillManager');
      const state = flow.handleFieldInteraction(ctx.win, ctx.tabs.getActiveId(), ctx.tabs.getActiveWebContents().getURL(), 'icon', { role: 'current', formKind: 'login' });
      load('PasswordPopoverManager').showPasswordPopover(ctx.win, state);
      return state;
    })()`);
    assert.equal(state.kind, 'has-saved');
    await page.evaluate('document.getElementById("pass").value = ""');
    assert.equal(await popover.evaluate(`window.passwordPopover.fillSavedPassword(${state.matches[0].id})`), true,
      'Заполнение через IPC поповера должно работать');
    await wait(100);
    assert.equal(await page.evaluate('document.getElementById("pass").value'), generated);
    console.log('ok: генерация, сохранение в сейф и выбор сохранённого пароля через настоящий IPC');
  } finally {
    popover.close();
    page.close();
  }
}, { main: true });
