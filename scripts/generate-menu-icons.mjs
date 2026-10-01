import { chromium } from 'playwright-core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from 'lucide-react';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Иконки нужны нативному Menu как PNG: SVG Electron в этом API не декодирует.
// Генератор запускается вручную; приложение читает уже готовые файлы и не зависит от Playwright.
const names = [
  'Pin', 'VolumeX', 'Volume2', 'FolderPlus', 'FolderMinus', 'FolderInput',
  'SquareArrowOutUpRight', 'Copy', 'Ellipsis', 'X', 'RefreshCw',
  'Sparkles', 'Undo2', 'Workflow', 'Search', 'Languages', 'ListFilter',
  'CircleHelp', 'FileText', 'Code2', 'Scissors', 'ClipboardPaste', 'TextSelect',
  'Pencil', 'Palette', 'FoldVertical', 'FolderX', 'Trash2',
];
const output = path.resolve('src/public/menu-icons');
await mkdir(output, { recursive: true });
const colors = await readFile(path.resolve('src/styles/tokens/colors.css'), 'utf8');
const neutral = colors.match(/--n10:\s*(#[0-9a-f]{6})/i)?.[1];
if (!neutral) throw new Error('Не найден токен --n10 для цвета иконок');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 48, height: 48 }, deviceScaleFactor: 2 });
  for (const name of names) {
    const Icon = icons[name];
    if (!Icon) throw new Error(`Нет иконки Lucide: ${name}`);
    const svg = renderToStaticMarkup(createElement(Icon, { size: 20, color: neutral, strokeWidth: 1.8 }));
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
    await page.locator('svg').screenshot({ path: path.join(output, `${name}.png`), omitBackground: true });
  }
} finally {
  await browser.close();
}
