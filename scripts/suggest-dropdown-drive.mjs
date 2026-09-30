// Живая регрессия первого клика: скрытое окно должно дождаться данных и высоты карточки.
// Только изолированный профиль, см. isolated-stand.mjs.
import { withStand, connectCdp, wait } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/dropdown-probe'))}).then(() => 1)`);
  await wait(500);
  let rect = null;
  for (let i = 0; i < 40; i++) {
    rect = await ctx.chrome.evaluate(`(() => {
      const input = [...document.querySelectorAll('input')].find((el) =>
        el.closest('header') || el.getAttribute('role') === 'combobox' ||
        /адрес|address|search/i.test(el.placeholder));
      if (!input) return null;
      const r = input.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (rect) break;
    await wait(150);
  }
  if (!rect) throw new Error('поле омнибокса не найдено после загрузки хрома');

  await ctx.chrome.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1,
  });
  await ctx.chrome.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1,
  });

  const target = await ctx.findTarget((t) => t.url?.includes('suggestdropdown.html'), 40);
  if (!target) {
    const debug = await ctx.chrome.evaluate(`({ active: document.activeElement?.outerHTML.slice(0, 220), text: document.body.innerText.slice(0, 350), inputs: [...document.querySelectorAll('input')].map((x) => ({ placeholder: x.placeholder, value: x.value, r: x.getBoundingClientRect().toJSON() })) })`);
    throw new Error(`окно дропдауна не создалось после первого клика: ${JSON.stringify(debug)}`);
  }
  const popup = connectCdp(target);
  await popup.ready;
  try {
    let state = null;
    let win = null;
    for (let i = 0; i < 40; i++) {
      state = await popup.evaluate(`(() => ({
        height: document.querySelector('#root > div > div')?.getBoundingClientRect().height ?? 0,
        text: document.body?.innerText.length ?? 0,
        viewport: window.innerHeight,
      }))()`);
      win = await ctx.evalMain(`(() => {
        const { BrowserWindow } = process.mainModule.require('electron');
        const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('suggestdropdown'));
        if (!w) return null;
        const b = w.getBounds();
        return { vis: w.isVisible(), x: b.x, y: b.y, width: b.width, height: b.height };
      })()`);
      // showInactive не переводит document.visibilityState в visible, хотя окно уже на экране.
      // Поэтому «видно» — это isVisible и координаты, а не Page Visibility.
      if (state && win?.vis && win.y > -1000 && state.height >= 32 && state.viewport >= state.height + 48 && state.text > 0) break;
      await wait(150);
    }
    if (!state || !win?.vis || win.y <= -1000 || state.height < 32 || state.viewport < state.height + 48 || state.text === 0) {
      throw new Error(`первый показ не раскрыл карточку: ${JSON.stringify({ state, win })}`);
    }
    console.log(`  ok   первый клик: карточка видна, высота ${Math.round(state.height)}px, окно ${state.viewport}px`);
  } finally {
    popup.close();
  }
}, { main: true });

console.log('\nИтого: 1 прошло, 0 не прошло\n');
