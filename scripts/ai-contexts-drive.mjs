// Наборы проходят IPC, диск и перезапуск только на своём профиле стенда.
import assert from 'node:assert/strict';
import { withStand } from './isolated-stand.mjs';

await withStand(async ctx => {
  const save = input => ctx.chrome.evaluate(`window.oblako.saveAiContext(${JSON.stringify(input)})`);
  const legacy = await save({ title: 'Legacy', text: 'Write in English.' });
  const id = legacy.presets[0].id;
  await ctx.chrome.evaluate(`window.oblako.setDefaultAiContext(${JSON.stringify(id)})`);
  const separated = await save({ id, title: 'Support', text: 'Draft replies in English.', materials: 'Order A: $10\nOrder B: $20' });
  assert.equal(separated.presets[0].materials, 'Order A: $10\nOrder B: $20');
  assert.equal(separated.defaultId, id);
  const tooLong = await save({ id, title: 'Bad', text: 'Role', materials: 'x'.repeat(12000) });
  assert.equal(tooLong, null);
  await ctx.restart(1000);
  const store = `process.mainModule.require(${JSON.stringify(new URL('../dist-electron/electron/AiContextStore.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))})`;
  assert.deepEqual(await ctx.evalMainSync(`${store}.getState()`), separated);
  const prompt = await ctx.evalMainSync(`${store}.presetText(${JSON.stringify(id)})`);
  assert.ok(prompt.startsWith('Draft replies in English.\n\nReference materials'));
  assert.equal(JSON.parse(prompt.split('\n').at(-1)), 'Order A: $10\nOrder B: $20');
  console.log('Итого: 6 прошло, 0 не прошло');
}, { main: true });
