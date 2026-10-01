// Живая проверка состава и времени сборки нативных ПКМ на отдельном профиле.
// Menu.popup подменяется пустым вызовом: OS-отрисовка не блокирует прогон, а Electron
// по-настоящему строит MenuItem и декодирует иконки. Пользовательский профиль не открывается.
import { withStand, wait } from './isolated-stand.mjs';

const percentile = (values, part) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * part))].toFixed(2));
};

await withStand(async (ctx) => {
  await ctx.evalMain(`(() => {
    const { Menu } = process.mainModule.require('electron');
    const original = Menu.buildFromTemplate.bind(Menu);
    globalThis.__menuProbe = [];
    let nested = false;
    Menu.buildFromTemplate = (items) => {
      if (nested) return original(items);
      const start = performance.now();
      nested = true;
      try { original(items); } finally { nested = false; }
      globalThis.__menuProbe.push({
        ms: performance.now() - start,
        rows: items.map((item) => ({
          label: item.label || item.role || '|',
          type: item.type || 'normal',
          icon: item.icon?.isEmpty?.() === false,
          submenu: Array.isArray(item.submenu) ? item.submenu.map((child) => child.label) : null,
        })),
      });
      return { popup() {} };
    };
    return true;
  })()`);

  const tabId = await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/links'))})`);
  await wait(450);
  const groupId = await ctx.chrome.evaluate(`(async () => {
    await window.oblako.createGroup(${JSON.stringify(tabId)});
    return (await window.oblako.getSidebarNodes()).find((node) => node.type === 'group')?.id;
  })()`);
  if (!groupId) throw new Error('Группа для проверки не создана');

  const tabTimes = await ctx.chrome.evaluate(`(async () => {
    const samples = [];
    for (let i = 0; i < 60; i++) {
      const start = performance.now();
      await window.oblako.showTabMenu(${JSON.stringify(tabId)});
      samples.push(performance.now() - start);
    }
    return samples;
  })()`);
  const groupTimes = await ctx.chrome.evaluate(`(async () => {
    const samples = [];
    for (let i = 0; i < 60; i++) {
      const start = performance.now();
      await window.oblako.showGroupMenu(${JSON.stringify(groupId)});
      samples.push(performance.now() - start);
    }
    return samples;
  })()`);

  const point = await ctx.chrome.evaluate(`(() => {
    const input = document.querySelector('input[placeholder]');
    if (!input) throw new Error('Омнибокс не найден');
    input.focus();
    input.setSelectionRange(0, Math.min(12, input.value.length));
    const r = input.getBoundingClientRect();
    return { x: r.x + Math.min(80, r.width / 2), y: r.y + r.height / 2, selected: input.value.slice(0, 12) };
  })()`);
  if (!point.selected) throw new Error('Омнибокс пуст, выделение не проверено');
  await ctx.chrome.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'right', buttons: 2, clickCount: 1,
  });
  await ctx.chrome.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'right', buttons: 0, clickCount: 1,
  });
  await wait(120);

  const captured = await ctx.evalMain('globalThis.__menuProbe');
  const tab = captured.find((menu) => menu.rows.some((row) => row.label === 'Инструменты'));
  const group = captured.find((menu) => menu.rows.some((row) => row.label === 'Расформировать группу'));
  const chrome = captured.at(-1);
  if (!tab || !group || !chrome.rows.some((row) => row.label === 'Перевести')) {
    throw new Error(`Меню собрались неполно: ${JSON.stringify({ tab: !!tab, group: !!group, chrome: chrome?.rows })}`);
  }
  const build = captured.map((menu) => menu.ms);
  console.log(JSON.stringify({
    tab: { firstMs: Number(tabTimes[0].toFixed(2)), medianMs: percentile(tabTimes.slice(1), .5), p95Ms: percentile(tabTimes.slice(1), .95), rows: tab.rows },
    group: { firstMs: Number(groupTimes[0].toFixed(2)), medianMs: percentile(groupTimes.slice(1), .5), p95Ms: percentile(groupTimes.slice(1), .95), rows: group.rows },
    omnibox: chrome.rows,
    nativeBuild: { medianMs: percentile(build, .5), p95Ms: percentile(build, .95) },
  }, null, 2));
}, { main: true });
