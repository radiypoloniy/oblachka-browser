import type { DocSpec } from '../../../../shared/notebookDoc';

// Общая оболочка выгруженного документа: один самодостаточный .html.
//
// ⚠️ ОДИН рендерер на шаблон, а не два. Соблазн был сделать React-компоненты для предпросмотра
// и строковый рендер для выгрузки — и это гарантированный разъезд: правишь один, забываешь
// другой, человек сохраняет не то, что видел. Поэтому шаблон рисует ТОЛЬКО html-строку, а
// предпросмотр показывает её же в изолированном iframe (см. DocumentView.tsx). Что видно —
// то и сохранится, то же и откроется вкладкой.
//
// ⚠️ Стили ИНЛАЙНОМ и цвета ЧИСЛАМИ, а не токенами. Файл уезжает человеку, у которого нашего
// браузера нет: var(--section-tone) там не значит ничего, и документ приехал бы чёрным текстом
// на прозрачном фоне. По той же причине здесь одна светлая тема, а не палитры браузера — это
// документ, а не экран приложения.
//
// ⚠️ Тон — тот же чай, что у раздела AI (--poster-tea): выгруженный документ обязан быть
// узнаваем как «сделано в Oblako», иначе фирменность заканчивается на границе окна.

export const C = {
  tea: '#1F5E52',
  night: '#17293E',
  tangerine: '#E8611C',
  cream: '#F2EDE1',
  ink: '#24252E',
  body: '#3D3F4E',
  faint: '#6D7492',
  paper: '#FFFFFF',
  sunken: '#F2F3F6',
  line: 'rgba(60,60,67,0.14)',
  lineSoft: 'rgba(60,60,67,0.07)',
} as const;

/** Экранирование: заголовки и текст пришли от модели по материалам чужих страниц. */
export function esc(s: string | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Зерно — тот же рецепт, что у островов интерфейса (grain в styles/system.ts): фрактальный шум
// калибра 0.65 в два октава наложением overlay. Без него плашка тоном выглядит плоской заливкой.
export const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.65' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E\")";

// Базовый слой, общий для всех трёх шаблонов: сброс, гарнитуры, поведение таблиц и печати.
//
// ⚠️ Гарнитуры перечислены СИСТЕМНЫМИ фолбэками. Golos Text и Unbounded вшиты в наш браузер
// локально, но документ открывают в чужом — там их нет, и без внятного запасного набора
// страница поедет на Times New Roman.
export const BASE_CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:${C.sunken};color:${C.body};
  font:16px/1.55 "Golos Text","Segoe UI",system-ui,-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased}
.sheet{background:${C.paper};min-height:100vh;margin:0 auto}
h1,h2,h3,h4{margin:0}
p{margin:0 0 14px}
a{color:inherit}
.grain{position:relative;overflow:hidden}
.grain::after{content:'';position:absolute;inset:0;background-image:${GRAIN};
  opacity:.42;mix-blend-mode:overlay;pointer-events:none}
.grain>*{position:relative;z-index:1}
.mono{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace}
.caps{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;
  font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:${C.faint}}
.num{font-variant-numeric:tabular-nums}
@media print{body{background:${C.paper}}.sheet{box-shadow:none}}
`;

/** Заворачивает готовое тело в самодостаточный файл. */
export function wrapDoc(spec: DocSpec, css: string, body: string): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.title)}</title>
<style>${BASE_CSS}${css}</style></head>
<body><div class="sheet">
${body}
</div></body></html>`;
}
