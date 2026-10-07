// Принадлежность профилю и последнее приватное окно: только временный профиль.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async ctx => {
  const load = async () => {
    await wait(1000);
    await ctx.evalMainSync(`globalThis.edgeStand = {
      registry: Object.values(process.mainModule.require('module')._cache).find(m => (m.filename ?? '').replaceAll(String.fromCharCode(92), '/').endsWith('/WindowRegistry.js')).exports,
    }; undefined`);
  };
  const states = () => ctx.evalMainSync('edgeStand.registry.allContexts().map(c => ({ id: c.sessionId, tabs: c.tabs.snapshot() }))');
  const run = (id, code) => ctx.evalMain(`edgeStand.registry.allContexts().find(c => c.sessionId === ${JSON.stringify(id)}).chromeView.webContents.executeJavaScript(${JSON.stringify(code)})`);
  const saved = async () => JSON.parse(await fs.readFile(path.join(ctx.profile, 'session-v6.json'), 'utf8'));
  await load();
  const ordinaryId = (await states())[0].id;
  const created = await run(ordinaryId, "window.oblako.createProfile('Работа', 'green')");
  const profileId = created.profiles.find(p => p.id !== 'default').id;
  await run(ordinaryId, `window.oblako.switchProfile(${JSON.stringify(profileId)})`);
  const urls = ['single', 'left', 'right'].map(name => ctx.echoUrl('/profile-' + name));
  const tabs = [];
  for (const url of urls) tabs.push(await run(ordinaryId, `window.oblako.createTab(${JSON.stringify(url)})`));
  await run(ordinaryId, `window.oblako.activateTab(${JSON.stringify(tabs[1])})`);
  await ctx.evalMainSync(`edgeStand.registry.allContexts()[0].tabs.enterSplit(${JSON.stringify(tabs[2])}); undefined`);
  await wait(2200);
  const nodes = (await saved()).windows[0].snapshot.nodes;
  assert.equal(nodes.find(n => n.type === 'single').profileId, profileId, 'обычная вкладка потеряла профиль');
  const pair = nodes.find(n => n.type === 'split-pair');
  assert.equal(pair.leftProfileId, profileId);
  assert.equal(pair.rightProfileId, profileId);
  await ctx.restart(0);
  await load();
  await run(ordinaryId, `window.oblako.switchProfile(${JSON.stringify(profileId)})`);
  assert.deepEqual((await states())[0].tabs.filter(t => !t.isHub).map(t => t.url).sort(), [...urls].sort());
  await run(ordinaryId, "window.oblako.switchProfile('default')");
  assert.equal((await states())[0].tabs.filter(t => !t.isHub).length, 0, 'вкладки чужого профиля появились в основном');
  await run(ordinaryId, `window.oblako.switchProfile(${JSON.stringify(profileId)})`);

  // После обычного окна закрываем приватное: обычные страницы должны вернуться.
  await run(ordinaryId, 'window.oblako.openWindow()');
  await wait(700);
  const privateId = (await states()).find(w => w.id !== ordinaryId).id;
  const privateUrl = ctx.echoUrl('/private-never-restore');
  await run(privateId, `window.oblako.createIncognitoTab(${JSON.stringify(privateUrl)})`);
  await ctx.evalMainSync(`edgeStand.registry.allContexts().find(c => c.sessionId === ${JSON.stringify(ordinaryId)}).win.close(); undefined`);
  await wait(400);
  assert.equal((await saved()).windows[0]?.id, ordinaryId);
  await ctx.evalMainSync(`setTimeout(() => edgeStand.registry.allContexts().find(c => c.sessionId === ${JSON.stringify(privateId)}).win.close(), 100); undefined`);
  ctx.main.close();
  await wait(1000);
  const final = await saved();
  assert.equal(final.windows[0]?.id, ordinaryId);
  assert.ok(!JSON.stringify(final).includes(privateUrl));
  await ctx.restart(0);
  await load();
  assert.equal((await states())[0].id, ordinaryId);
  await run(ordinaryId, `window.oblako.switchProfile(${JSON.stringify(profileId)})`);
  assert.equal((await states())[0].tabs.filter(t => !t.isHub).length, 3);
  for (const file of ['session-v6.json', 'session-v6.json.bak']) {
    assert.ok(!(await fs.readFile(path.join(ctx.profile, file), 'utf8')).includes(privateUrl));
  }
  console.log('OK: профиль обычной вкладки и split после перезапуска; последнее приватное окно не вытесняет обычное; приватные URL отсутствуют в сессии и backup.');
}, { main: true });
