// Проверка нативных ПКМ страницы, ссылки и картинки на временном профиле.
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
      const image = { ...params, mediaType: 'image', srcURL: ${JSON.stringify(ctx.echoUrl('/image.png'))} };
      wc.emit('context-menu', {}, image);
      wc.emit('context-menu', {}, { ...image, linkURL: ${JSON.stringify(ctx.echoUrl('/a'))} });
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
  const [blank, linkMenu, imageMenu, imageLinkMenu] = menus;
  const expectedImage = ['Открыть картинку в новой вкладке', '|', 'Копировать картинку', '|',
    'Сохранить картинку', 'Сохранить картинку как…', '|', 'Просмотреть код'];
  if (JSON.stringify(labels(imageMenu ?? [])) !== JSON.stringify(expectedImage)) {
    throw new Error(`ПКМ картинки: ${JSON.stringify(imageMenu)}`);
  }
  if (JSON.stringify(labels(imageLinkMenu ?? []).slice(-8)) !== JSON.stringify(expectedImage)) {
    throw new Error(`ПКМ картинки-ссылки: ${JSON.stringify(imageLinkMenu)}`);
  }
  if (JSON.stringify(labels(blank ?? [])) !== JSON.stringify(expectedPage)) {
    throw new Error(`ПКМ страницы: ${JSON.stringify(blank)}`);
  }
  // «Добавить в граф» зависит от состояния графа, поэтому проверяем постоянные группы.
  const linkLabels = labels(linkMenu ?? []);
  if (JSON.stringify(linkLabels.slice(0, 6)) !== JSON.stringify(expectedLink.slice(0, 6)) ||
      JSON.stringify(linkLabels.slice(-2)) !== JSON.stringify(expectedLink.slice(-2))) {
    throw new Error(`ПКМ ссылки: ${JSON.stringify(linkMenu)}`);
  }
  if (menus.flat().some((row) => row.type !== 'separator' && !row.icon)) {
    throw new Error(`Иконка не декодировалась: ${JSON.stringify(menus)}`);
  }
  if (menus.some((rows) => rows.some((row, i) => row.type === 'separator' && rows[i + 1]?.type === 'separator'))) {
    throw new Error('Два разделителя подряд');
  }
  console.log(JSON.stringify({ page: blank, link: linkMenu, image: imageMenu, imageLink: imageLinkMenu }, null, 2));
}, { main: true });
