// Проверяем реальный стек и партицию восстановления, не трогая рабочую сессию.
import assert from 'node:assert/strict';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async ctx => {
  await wait(900);
  const load = suffix => `Object.values(process.mainModule.require('module')._cache).find(m => (m.filename ?? '').replaceAll(String.fromCharCode(92), '/').endsWith(${JSON.stringify(suffix)})).exports`;
  await ctx.evalMainSync(`globalThis.closedTabStand = {
    tabs: ${load('/WindowRegistry.js')}.allContexts()[0].tabs,
    profiles: ${load('/ProfileStore.js')}, electron: process.mainModule.require('electron'),
  }; undefined`);
  const run = code => ctx.evalMainSync(code);
  const tabs = 'closedTabStand.tabs';
  const privateUrl = ctx.echoUrl('/private-must-not-reopen');
  const privateId = await ctx.chrome.evaluate(`window.oblako.createIncognitoTab(${JSON.stringify(privateUrl)})`);
  await wait(300);
  await run(`${tabs}.closeTab(${JSON.stringify(privateId)}); undefined`);
  assert.equal(await run(`${tabs}.hasClosedTabs()`), false);
  assert.equal(await run(`JSON.stringify(${tabs}.closedSnapshot()).includes(${JSON.stringify(privateUrl)})`), false);
  await run(`${tabs}.reopenLastClosedTab(); undefined`);
  assert.equal(await run(`${tabs}.snapshot().some(t => t.url === ${JSON.stringify(privateUrl)})`), false);
  assert.equal(await run(`JSON.stringify(${tabs}.getSessionSnapshot()).includes(${JSON.stringify(privateUrl)})`), false);

  const oauthUrl = ctx.echoUrl('/temporary-oauth');
  const oauthId = await run(`${tabs}.createTab(${JSON.stringify(oauthUrl)}, false, true)`);
  await wait(300);
  await run(`${tabs}.closeTab(${JSON.stringify(oauthId)}); undefined`);
  assert.equal(await run(`${tabs}.hasClosedTabs()`), false);

  const profile = await run(`closedTabStand.profiles.createProfile('Closed tab work', 'purple').profiles.at(-1).id`);
  await ctx.evalMain(`closedTabStand.electron.session.fromPartition('persist:oblako-profile-' + ${JSON.stringify(profile)}).cookies.set({ url: ${JSON.stringify(ctx.echoUrl('/'))}, name: 'closed-profile', value: 'work' })`);
  for (const sleeping of [false, true]) {
    const url = ctx.echoUrl(sleeping ? '/sleeping-profile' : '/live-profile');
    const id = await run(sleeping
      ? `${tabs}.createSleepingTab(${JSON.stringify(url)}, 'Sleeping work', undefined, ${JSON.stringify(profile)})`
      : `${tabs}.createTab(${JSON.stringify(url)}, false, false, false, undefined, ${JSON.stringify(profile)})`);
    await wait(300);
    if (sleeping) assert.equal(await run(`${tabs}.stateForTab(${JSON.stringify(id)}).isSleeping`), true);
    await run(`${tabs}.closeTab(${JSON.stringify(id)}); undefined`);
    assert.equal(await run(`${tabs}.closedSnapshot()[0].profileId`), profile);
    await run(`${tabs}.reopenLastClosedTab(); undefined`);
    await wait(300);
    assert.equal(await run(`${tabs}.profileOfWebContents(${tabs}.getActiveWebContents().id)`), profile);
    assert.equal(await ctx.evalMain(`${tabs}.getActiveWebContents().executeJavaScript('document.cookie')`), 'closed-profile=work');
    assert.equal(await run(`${tabs}.hasClosedTabs()`), false);
  }
  console.log('OK: инкогнито/OAuth исключены, живая и спящая вкладки возвращаются с cookies исходного профиля.');
}, { main: true });
