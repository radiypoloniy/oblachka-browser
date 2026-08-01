import { BrowserWindow, app, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// ── Окно-заставка ─────────────────────────────────────────────────────────────
//
// Зачем. Главное окно создаётся с `show: false` и показывается только по сигналу «оболочка
// отрисована» — это уже спасает от белой вспышки, но оставляет другую беду: между кликом по
// ярлыку и появлением окна человек не видит НИЧЕГО, и запуск ощущается зависанием. Заставка
// закрывает именно эту паузу: логотип с полосой загрузки, как у мобильных приложений.
//
// ⚠️ Содержимое — data-URL, а не файл и не наш `oblako-chrome://`. Протокол регистрируется
// после `whenReady`, а заставка обязана появиться раньше всего остального; файл же пришлось
// бы отдельно класть в сборку рендерера. Логотип поэтому вшиваем в разметку base64-строкой.
//
// ⚠️ `skipTaskbar` обязателен: иначе на панели задач на секунду возникает второй значок
// приложения и тут же пропадает — выглядит как сбой.

let splash: BrowserWindow | null = null;
let timer: NodeJS.Timeout | null = null;

// ⚠️ Заставка ОТЛОЖЕНА, а не показывается сразу. Замер на живой сборке: обычный старт с
// 22 восстановленными вкладками занимает ~500 мс, и заставка успевала мелькнуть и пропасть —
// вспышка читается как сбой, а не как запуск. Порог чуть ниже типичного старта: уложились
// быстрее — человек не увидит заставку вовсе и это правильно; не уложились (холодный старт
// после перезагрузки, медленный диск) — она появится и закроет ожидание.
//
// Задерживать САМ запуск ради показа заставки нельзя: смысл в том, чтобы после неё сразу
// было готовое окно, а не в том, чтобы полюбоваться логотипом.
const DELAY_MS = 400;

// Полоса намеренно НЕ показывает реальный прогресс: измерить его нечем — старт состоит из
// восстановления сессии, инициализации адблока и БД, и любые проценты были бы выдумкой.
// Она играет роль «идёт работа», как в мобильных приложениях, и уезжает в момент готовности.
function buildHtml(logo: string): string {
  return `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  .card {
    height: 100%; box-sizing: border-box;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px;
    background: #F2F2F7; border-radius: 18px;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    animation: in 260ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: none; } }
  img { width: 132px; height: 132px; display: block; -webkit-user-drag: none; }
  .name { font-size: 19px; font-weight: 600; color: #3C3C43; letter-spacing: 0.2px; margin-top: -8px; }
  .track { width: 168px; height: 4px; border-radius: 999px; background: rgba(70,68,63,.13); overflow: hidden; }
  /* Бегунок ходит внутри дорожки, а не растёт от края: так честнее выглядит неопределённость. */
  .bar { width: 42%; height: 100%; border-radius: 999px; background: #3C3C43; opacity: .55;
         animation: run 1150ms cubic-bezier(0.45, 0, 0.55, 1) infinite; }
  @keyframes run { 0% { transform: translateX(-115%); } 100% { transform: translateX(275%); } }
</style>
<div class="card">
  <img src="${logo}" alt="">
  <div class="name">Oblako</div>
  <div class="track"><div class="bar"></div></div>
</div>`;
}

function logoDataUrl(): string {
  // В упакованном приложении файл лежит в resources/brand (см. extraResources), в разработке —
  // в build/. Не нашли — заставка обойдётся без картинки, ронять из-за этого запуск незачем.
  const candidates = [
    path.join(process.resourcesPath, 'brand', 'icon.png'),
    path.join(app.getAppPath(), 'resources', 'brand', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.png'),
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
    } catch { /* следующий кандидат */ }
  }
  return '';
}

export function showSplash(): void {
  if (splash || timer) return;
  timer = setTimeout(() => { timer = null; createSplash(); }, DELAY_MS);
}

function createSplash(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const W = 340;
  const H = 300;

  splash = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round((width - W) / 2),
    y: Math.round((height - H) / 2),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    // Заставке нечего исполнять: ни preload, ни Node — только разметка.
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(logoDataUrl()))}`);
  splash.once('ready-to-show', () => splash?.show());
}

// Закрываем ровно в момент показа главного окна — «после анимации человек сразу видит
// открытое окно», без промежуточного кадра с пустотой.
export function closeSplash(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!splash) return;
  const w = splash;
  splash = null;
  if (!w.isDestroyed()) w.destroy();
}
