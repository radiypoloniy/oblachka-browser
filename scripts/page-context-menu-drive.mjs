// Проверка нативных ПКМ страницы и ссылки на временном профиле.
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const url = ctx.echoUrl('/links');
  await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`);
  await wait(500);
  const raw = await ctx.main.send('Runtime.evaluate', { expression: `(() => {
    const { Menu, webContents } = process.mainModule.require('electron');
    const wc = webContents.getAllWebContents().find((item) => item.getURL() === ${JSON.stringify(url)});
    if (!wc || wc.listenerCount('context-menu') === 0) throw new Error('Обработчик ПКМ страницы не установлен');
    const captured = [];
    const original = Menu.buildFromTemplate;
    let nested = false;
    Menu.buildFromTemplate = (items) => {
      if (nested) return original.call(Menu, items);
      nested = true;
      try { original.call(Menu, items); } finally { nested = false; }
      captured.push(items.map((item) => ({
        label: item.label || '|',
        icon: item.icon?.isEmpty?.() === false,
        type: item.type || 'normal',
      })));
      return { popup() {} };
    };
    try {
      const params = { x: 300, y: 200, linkURL: '', linkText: '', srcURL: '',
        mediaType: 'none', isEditable: false, selectionText: '', misspelledWord: '', dictionarySuggestions: [] };
      wc.emit('context-menu', {}, params);
      wc.emit('context-menu', {}, { ...params, linkURL: ${JSON.stringify(ctx.echoUrl('/a'))}, linkText: 'Первая глава' });
      return captured;
    } finally {
      Menu.buildFromTemplate = original;
    }
  })()`, returnByValue: true });
  if (raw.error || raw.result?.exceptionDetails) throw new Error(JSON.stringify(raw.error || raw.result.exceptionDetails));
  const menus = raw.result?.result?.value;

  const labels = (rows) => rows.map((row) => row.label);
  const expectedPage = ['Назад', 'Вперёд', '|', 'Обновить', 'Обновить без кэша', '|', 'Просмотреть код'];
  const expectedLink = [
    'Открыть ссылку в новой вкладке', 'Открыть ссылку в новом окне',
    'Открыть ссылку в инкогнито', 'Открыть ссылку в split', '|',
    'Копировать адрес ссылки', '|', 'Просмотреть код',
  ];
  const [blank, linkMenu] = menus;
  if (JSON.stringify(labels(blank ?? [])) !== JSON.stringify(expectedPage)) {
    throw new Error(`ПКМ страницы: ${JSON.stringify(blank)}`);
  }
  // «Добавить в граф» зависит от состояния графа, поэтому проверяем постоянные группы.
  const linkLabels = labels(linkMenu ?? []);
  if (JSON.stringify(linkLabels.slice(0, 6)) !== JSON.stringify(expectedLink.slice(0, 6)) ||
      JSON.stringify(linkLabels.slice(-2)) !== JSON.stringify(expectedLink.slice(-2))) {
    throw new Error(`ПКМ ссылки: ${JSON.stringify(linkMenu)}`);
  }
  if ([...blank, ...linkMenu].some((row) => row.type !== 'separator' && !row.icon)) {
    throw new Error(`Иконка не декодировалась: ${JSON.stringify(menus)}`);
  }
  console.log(JSON.stringify({ page: blank, link: linkMenu }, null, 2));
}, { main: true });
