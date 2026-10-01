// ПКМ поля сайта и чата проверяются на временном профиле через настоящие WebContents.
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const url = ctx.echoUrl('/links');
  const tabId = await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`);
  await ctx.chrome.evaluate('window.oblako.toggleAiPanel()');
  await wait(500);

  const evaluateMain = async (expression) => {
    const response = await ctx.main.send('Runtime.evaluate', { expression, returnByValue: true });
    if (response.error || response.result?.exceptionDetails) {
      throw new Error(JSON.stringify(response.error || response.result.exceptionDetails));
    }
    return response.result?.result?.value;
  };
  await evaluateMain(`(() => {
    const { Menu } = process.mainModule.require('electron');
    const original = Menu.buildFromTemplate;
    globalThis.__editableMenus = [];
    globalThis.__lastMemoryClick = null;
    let nested = false;
    Menu.buildFromTemplate = (items) => {
      if (nested) return original.call(Menu, items);
      nested = true;
      try { original.call(Menu, items); } finally { nested = false; }
      const memory = items.find((item) => item.label === 'Не выгружать из памяти');
      if (memory) globalThis.__lastMemoryClick = memory.click;
      const { createHash } = process.mainModule.require('node:crypto');
      globalThis.__editableMenus.push(items.map((item) => ({
        label: item.label || '|', type: item.type || 'normal',
        icon: item.icon?.isEmpty?.() === false,
        iconHash: item.icon && memory === item ? createHash('sha256').update(item.icon.toPNG()).digest('hex') : null,
        submenu: Array.isArray(item.submenu) ? item.submenu.map((child) => child.label) : null,
      })));
      return { popup() {} };
    };
    return true;
  })()`);

  await evaluateMain(`(() => {
    const all = process.mainModule.require('electron').webContents.getAllWebContents();
    const page = all.find((wc) => wc.getURL() === ${JSON.stringify(url)});
    const panel = all.find((wc) => wc.getURL().includes('/aipanel.html'));
    if (!page || !panel) throw new Error('Тестовые WebContents не найдены');
    const params = { x: 30, y: 30, linkURL: '', srcURL: '', mediaType: 'none',
      isEditable: true, selectionText: '', misspelledWord: '', dictionarySuggestions: [] };
    page.emit('context-menu', {}, params);
    panel.emit('context-menu', {}, params);
    return true;
  })()`);
  await ctx.chrome.evaluate(`window.oblako.showTabMenu(${JSON.stringify(tabId)})`);
  const before = await evaluateMain(`globalThis.__editableMenus`);
  await evaluateMain(`globalThis.__lastMemoryClick()`);
  await ctx.chrome.evaluate(`window.oblako.showTabMenu(${JSON.stringify(tabId)})`);
  const menus = await evaluateMain(`globalThis.__editableMenus`);

  const [page, panel] = menus;
  const memoryBefore = before.at(-1);
  const memoryAfter = menus.at(-1);
  const basic = ['Отменить ввод', 'Повторить ввод', '|', 'Вырезать', 'Копировать', 'Вставить', '|', 'Выделить всё'];
  const labels = (rows) => rows.map((row) => row.label);
  if (JSON.stringify(labels(page).slice(0, basic.length)) !== JSON.stringify(basic) ||
      JSON.stringify(labels(panel)) !== JSON.stringify(basic)) {
    throw new Error(`Неожиданные команды: ${JSON.stringify({ page, panel })}`);
  }
  if (page.some((row) => row.label === 'Править текст') === false ||
      [...page, ...panel].some((row) => row.type !== 'separator' && !row.icon)) {
    throw new Error(`Нет группировки или иконок: ${JSON.stringify({ page, panel })}`);
  }
  const memoryRow = (rows) => rows.find((row) => row.label === 'Не выгружать из памяти');
  if (memoryRow(memoryBefore)?.type !== 'normal' || !memoryRow(memoryBefore)?.icon ||
      memoryRow(memoryAfter)?.type !== 'normal' || !memoryRow(memoryAfter)?.icon ||
      memoryRow(memoryBefore)?.iconHash === memoryRow(memoryAfter)?.iconHash) {
    throw new Error(`Пиктограмма памяти не декодировалась: ${JSON.stringify({ memoryBefore, memoryAfter })}`);
  }
  console.log(JSON.stringify({ page, panel, memoryBefore: memoryRow(memoryBefore), memoryAfter: memoryRow(memoryAfter) }, null, 2));
}, { main: true });
