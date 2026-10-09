// Импорт проходит редактор и сохранение на отдельном профиле, без приватных шаблонов.
import assert from 'node:assert/strict';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async ctx => {
  const until = async expression => {
    for (let i = 0; i < 60; i++) { if (await ctx.chrome.evaluate(expression)) return; await wait(100); }
    throw new Error('Не дождались редактора контекста');
  };
  await ctx.chrome.evaluate("window.oblako.createSpecialTab('settings','ai')");
  await until("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Новый набор'))");
  await ctx.chrome.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Новый набор')).click()");
  await until("!!document.querySelector('input[type=file][accept=\".json\"]')");
  const attach = (selector, text, name) => ctx.chrome.evaluate(`(() => {
    const picker = document.querySelector(${JSON.stringify(selector)}), transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, {type:'text/plain'}));
    picker.files = transfer.files; picker.dispatchEvent(new Event('change',{bubbles:true})); return true;
  })()`);
  await attach('input[type=file][accept=".json"]', '\uFEFF' + JSON.stringify({ title: 'Portable context', text: 'Answer in English.', materials: 'Original reference' }), 'context.json');
  await until("[...document.querySelectorAll('textarea')].some(t=>t.value==='Answer in English.')");
  await attach('input[type=file][multiple]', '# Reference\nSeven items.', 'reference.md');
  await until("[...document.querySelectorAll('textarea')].some(t=>t.value.includes('reference.md'))");
  await ctx.chrome.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Сохранить').click()");
  await until("!document.querySelector('input[type=file]')");
  const state = await ctx.chrome.evaluate('window.oblako.aiContexts()');
  assert.equal(state.presets.length, 1);
  assert.equal(state.defaultId, null);
  assert.equal(state.presets[0].title, 'Portable context');
  assert.equal(state.presets[0].text, 'Answer in English.');
  assert.equal(state.presets[0].materials, 'Original reference\n\n--- reference.md ---\n# Reference\nSeven items.');
  console.log('Итого: 5 прошло, 0 не прошло');
});
