// Правила именно этого проекта — то, чего не проверяет ни tsc, ни один готовый линтер.
//
// ⚠️ Почему не ESLint. Правила ниже специфичны для Oblako: «фиолетового в системе нет»,
// «renderer ходит через window.oblako», «модуль под проверкой не тянет значимых импортов». В
// ESLint это всё равно пришлось бы писать своим плагином — то есть тот же код, плюс зависимость,
// плюс конфиг. Готовые правила (react-hooks, no-floating-promises) — отдельный разговор и
// отдельная установка; здесь только то, что стоит ноль и работает сегодня.
//
// Запуск: npm test -- conventions
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let passed = 0;
let failed = 0;

function checkEmpty(what, hits, hint) {
  const ok = hits.length === 0;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}${ok ? '' : ` — ${hits.length}`}`);
  if (!ok) {
    for (const h of hits.slice(0, 20)) console.log(`         ${h}`);
    if (hits.length > 20) console.log(`         …ещё ${hits.length - 20}`);
    if (hint) console.log(`         → ${hint}`);
  }
}

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const n of fs.readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist' || n === 'dist-electron') continue;
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => n.endsWith(e))) out.push(p);
  }
  return out;
}
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

// Комментарии из проверки исключаем: в них как раз и объясняют, почему чего-то нельзя, — и сами
// объяснения не должны срабатывать как нарушения.
//
// ⚠️ Разбор с СОСТОЯНИЕМ, а не построчный: и в CSS, и в JSX запреты объясняются многострочными
// блоками /* … */, и построчная чистка ловила их середину как нарушение — первая же версия этой
// проверки покраснела на собственных комментариях про запрет фиолетового.
function codeLines(text) {
  const out = [];
  let inBlock = false;
  for (const raw of text.split('\n')) {
    let line = '';
    for (let i = 0; i < raw.length; i++) {
      if (inBlock) {
        if (raw[i] === '*' && raw[i + 1] === '/') { inBlock = false; i++; }
        continue;
      }
      if (raw[i] === '/' && raw[i + 1] === '*') { inBlock = true; i++; continue; }
      if (raw[i] === '/' && raw[i + 1] === '/') break; // строчный комментарий — остаток строки
      line += raw[i];
    }
    out.push(line);
  }
  return out;
}

// ── 0. Одно имя токена — один смысл ─────────────────────────────────────────
//
// ⚠️ Правило оплачено разбором 19.08.2026. `--space-1..3` были объявлены ДВАЖДЫ и в разных
// смыслах: в colors.css/palettes.css как цвета маршрута земли, а в spacing.css как шкала отступов
// (4px, 8px, 12px). spacing.css импортируется ПОЗЖЕ, поэтому на `:root` побеждали пиксели — и
// `linear-gradient(180deg, var(--space-1) …)` превращался в `linear-gradient(180deg, 4px …)`,
// то есть в невалидное значение. Последствия видно было не там, где причина:
//   • градиент земли на палитре по умолчанию не рисовался вовсе;
//   • полоса системных кнопок Windows становилась ЧЁРНОЙ — цвет для неё считается пробным
//     элементом, тот получал прозрачный фон, а разбор читал `rgba(0, 0, 0, 0)` как #000000.
// Обе проверки, которые могли бы это поймать, молчали: contrast-check разбирает только
// colors.css и palettes.css, а spacing.css в его поле зрения не попадает вовсе.
//
// Проверяем по СМЫСЛУ значения (цвет / длина / прочее), а не по факту повторного объявления:
// переопределять токен в палитре и в тёмной теме — норма, а менять его тип — нет.
{
  const kindOf = (v) => {
    const t = v.trim();
    if (/^#[0-9a-fA-F]{3,8}$|^rgb|^hsl|^color-mix|^color\(|^oklch/i.test(t)) return 'цвет';
    if (/^-?[\d.]+(px|rem|em|%)$|^0$/.test(t)) return 'длина';
    return null; // тени, градиенты, фильтры, ссылки на другие токены — не типизируем
  };
  const kinds = new Map(); // имя → Map<смысл, Set<файл>>
  for (const f of walk(path.join(ROOT, 'src/styles'), ['.css'])) {
    const css = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      const kind = kindOf(value);
      if (!kind) continue;
      if (!kinds.has(name)) kinds.set(name, new Map());
      const byKind = kinds.get(name);
      if (!byKind.has(kind)) byKind.set(kind, new Set());
      byKind.get(kind).add(rel(f));
    }
  }
  const hits = [];
  for (const [name, byKind] of kinds) {
    if (byKind.size < 2) continue;
    const parts = [...byKind].map(([k, files]) => `${k} (${[...files].join(', ')})`);
    hits.push(`${name}: ${parts.join(' и ')}`);
  }
  checkEmpty('одно имя токена — один смысл', hits,
    'переименуйте одну из ролей: разные смыслы под одним именем побеждают по порядку импорта');
}

// ── 1. Фиолетового в СИСТЕМНЫХ цветах нет ───────────────────────────────────
//
// Правило из CLAUDE.md: «Фиолетового в системе нет вообще — ни токена, ни литерала». Оно уже
// дважды нарушалось через значки (--tile-purple/--tile-indigo, литерал #AF52DE у глифа «Цвета»)
// и один раз через СГЕНЕРИРОВАННЫЙ оттенок (подложка иконки сайта выводилась из домена как
// hash % 360 и раздавала весь круг вместе с сиреневым сектором).
//
// ⚠️ Закон про цвета САМОЙ СИСТЕМЫ, а не про то, что выбирает человек. Два исключения ниже
// законны и проверены: палитра групп вкладок (фиолетовый прямо предусмотрен контрактом
// GroupNode.color, ровно как в Chrome) и обои домашнего экрана (это картинка, а не роль).
const USER_CHOSEN = [
  /--wallpaper-/,                                        // обои: человек выбирает сам
  /\b(red|orange|yellow|green|blue|purple)\s*:\s*'#/,    // палитра групп вкладок (GroupNode.color)
];

function hueSat(hex) {
  const parts = hex.length === 4
    ? [hex[1] + hex[1], hex[2] + hex[2], hex[3] + hex[3]]
    : [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)];
  const [r, g, b] = parts.map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / max };
}

{
  const hits = [];
  for (const f of walk(path.join(ROOT, 'src'), ['.ts', '.tsx', '.css'])) {
    codeLines(fs.readFileSync(f, 'utf8')).forEach((line, i) => {
      if (USER_CHOSEN.some((re) => re.test(line))) return;
      if (/\b(purple|violet|magenta|fuchsia)\b/i.test(line)) {
        hits.push(`${rel(f)}:${i + 1}  имя: ${line.trim().slice(0, 70)}`);
      }
      for (const m of line.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
        const { h, s } = hueSat(m[0]);
        // Сиреневый сектор круга. Порог по насыщенности отсекает почти-серые оттенки, которые
        // формально попадают в диапазон, но фиолетовыми не выглядят.
        if (h >= 265 && h <= 320 && s > 0.25) hits.push(`${rel(f)}:${i + 1}  оттенок ${Math.round(h)}°: ${m[0]}`);
      }
    });
  }
  checkEmpty('фиолетового нет в системных цветах src/', hits,
    'цветовой закон в CLAUDE.md; нужен ещё один цвет значка — брать из --tile-red/brown/slate');
}

// ── 2. Renderer не трогает ipcRenderer напрямую ─────────────────────────────
{
  const hits = [];
  for (const f of walk(path.join(ROOT, 'src'), ['.ts', '.tsx'])) {
    codeLines(fs.readFileSync(f, 'utf8')).forEach((line, i) => {
      if (/\bipcRenderer\b/.test(line)) hits.push(`${rel(f)}:${i + 1}`);
    });
  }
  checkEmpty('renderer ходит только через window.oblako', hits,
    'мост живёт в preload; прямой ipcRenderer в src/ обходит контракт и типы OblakoApi');
}

// ── 3. any и @ts-ignore — только с объяснением ──────────────────────────────
// Из CLAUDE.md: «Не глуши ошибки через any/@ts-ignore без причины и комментария, почему иначе
// нельзя». Проверяем наличие комментария на той же или предыдущей строке — не сам текст: судить
// о качестве объяснения машина не может, а вот заметить его отсутствие вполне.
{
  const hits = [];
  const files = [
    ...walk(path.join(ROOT, 'src'), ['.ts', '.tsx']),
    ...walk(path.join(ROOT, 'electron'), ['.ts']),
    ...walk(path.join(ROOT, 'shared'), ['.ts']),
  ];
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    const code = codeLines(fs.readFileSync(f, 'utf8'));
    lines.forEach((raw, i) => {
      const isAny = /(:\s*any\b|as\s+any\b|<any>)/.test(code[i] ?? '');
      const isIgnore = /@ts-(ignore|expect-error|nocheck)/.test(raw);
      if (!isAny && !isIgnore) return;
      const prev = (lines[i - 1] ?? '').trim();
      const explained = raw.includes('//') || prev.startsWith('//') || prev.startsWith('*') || prev.startsWith('/*');
      if (!explained) hits.push(`${rel(f)}:${i + 1}  ${raw.trim().slice(0, 70)}`);
    });
  }
  checkEmpty('any и @ts-ignore объяснены комментарием', hits,
    'напиши рядом, почему иначе нельзя — иначе через месяц это неотличимо от лени');
}

// ── 4. Модули shared/ под проверками не тянут значимых импортов ─────────────
//
// ⚠️ Правило неочевидное, но железное: проверки гоняются голым node
// (--experimental-strip-types), а он требует расширения в пути импорта — которого tsc с эмитом
// не примет. Типовые импорты стираются и потому безвредны, а вот `import { X } from './layout'`
// внутри такого модуля ломает прогон целиком. Ошибка вылезет не там, где её сделали, поэтому
// правило проверяется машиной, а не памятью.
{
  const underCheck = new Set();
  for (const c of walk(path.join(ROOT, 'scripts'), ['-check.mjs'])) {
    for (const m of fs.readFileSync(c, 'utf8').matchAll(/from\s+'\.\.\/shared\/([\w/]+)\.ts'/g)) underCheck.add(m[1]);
  }
  const hits = [];
  for (const name of underCheck) {
    const f = path.join(ROOT, 'shared', `${name}.ts`);
    if (!fs.existsSync(f)) continue;
    fs.readFileSync(f, 'utf8').split('\n').forEach((raw, i) => {
      if (/^import\s+(?!type\b)/.test(raw)) hits.push(`shared/${name}.ts:${i + 1}  ${raw.trim().slice(0, 70)}`);
    });
  }
  console.log(`         (модулей shared/ под проверками: ${underCheck.size})`);
  checkEmpty('модули shared/ под проверками — только типовые импорты', hits,
    'значимый импорт сломает прогон на голом node; вынеси константу в тот же модуль');
}

// ── Дизайн-система раздела настроек ──────────────────────────────────────────
//
// ⚠️ Это правило существует, потому что система разъезжается ТИХО. К моменту, когда её собрали в
// четыре сущности (Panel/OptionList/OptionRow/Segmented, разбор — в src/components/settings/kit.tsx),
// в секциях уже жило шестнадцать самодельных карточек: у каждой свой фон из палитры, своя тень и
// свой радиус. Человеку это видно только скриншотом и только в той палитре, где вылезло, — жалоба
// пришла на «часть синим, часть блевотно-зелёным, со странной размытостью по краям».
//
// Что запрещено В СЕКЦИЯХ (сам kit.tsx — источник рецептов, ему можно):
//   • islandPlate — рецепт ПАРЯЩЕГО острова над цветной землёй окна; внутри сплошной панели
//     он даёт тень по краю коробки и заливку из палитры;
//   • внешняя тень (var(--shadow-…)) — внутри панели парить не над чем; inset-кольца можно,
//     это рамка, а не тень;
//   • сырая заливка var(--surface…) у контейнера — фон в настройках бывает только у выбранной
//     строки (акцент/функциональный цвет) и внутри контролов.
{
  const settingsDir = path.join(ROOT, 'src', 'components', 'settings');
  const files = walk(settingsDir, ['.tsx']).filter((f) => !f.endsWith('kit.tsx'));
  files.push(path.join(ROOT, 'src', 'components', 'ModelsSection.tsx'));
  const hits = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    fs.readFileSync(f, 'utf8').split('\n').forEach((raw, i) => {
      const line = raw.trim();
      if (line.startsWith('//') || line.startsWith('*')) return; // разборы в комментариях не в счёт
      if (/\bislandPlate\b/.test(line)) hits.push(`${rel(f)}:${i + 1}  islandPlate`);
      if (/boxShadow:[^,]*var\(--shadow-/.test(line) && !/inset/.test(line)) {
        hits.push(`${rel(f)}:${i + 1}  внешняя тень`);
      }
      if (/background:\s*'var\(--surface(-solid|-island)?\)'/.test(line)) {
        hits.push(`${rel(f)}:${i + 1}  сырая заливка поверхности`);
      }
    });
  }
  console.log(`         (файлов настроек под правилом: ${files.length})`);
  checkEmpty('настройки: только рецепты из kit (без islandPlate, теней и сырых заливок)', hits,
    'взять Panel/OptionList/OptionRow/Segmented из settings/kit.tsx; фон бывает только у выбранного');
}

// ── Цветовой закон: акцент принадлежит палитре, статус не красит фон ─────────
//
// ⚠️ Три правила из документа «Цветовой закон Oblako» (утверждён 18.08.2026). Каждое проверяется
// машиной, потому что нарушение видно только глазами и только в той палитре, где вылезло:
//   1. каждая палитра задаёт свой --accent в ОБЕИХ темах. Пропущенная палитра молча наследует
//      чужой акцент — ровно та жалоба, с которой всё началось («часть синим, часть зелёным»);
//   2. функциональные цвета (успех/предупреждение/ошибка/точки состояния) не появляются в
//      background: заливка — язык АКЦЕНТА, у неё одно значение «выбрано». В палитре с зелёным
//      акцентом две заливки неразличимы (контраст 1,8–2,3);
//   3. акцент берётся токеном, а не литералом: иначе палитра его не переопределит.
{
  const pal = fs.readFileSync(path.join(ROOT, 'src', 'styles', 'tokens', 'palettes.css'), 'utf8');
  const hits = [];

  // (1) Блоки палитр: у каждого свой акцент. «Уголь» — база (colors.css/theme-dark.css),
  // своего блока у него нет и быть не должно.
  for (const m of pal.matchAll(/\[data-palette="([a-z]+)"\]([^{]*)\{([^}]*)\}/g)) {
    const [, name, mods, body] = m;
    if (!/--accent:/.test(body)) {
      hits.push(`palettes.css  ${name}${/dark/.test(mods) ? ' (тёмная)' : ' (светлая)'} — нет --accent`);
    }
  }

  // (2) Функциональный цвет в заливке — в области, где закон уже выверен глазами (настройки).
  // ⚠️ По остальному рендереру правило пока НЕ гоняется, и это честная граница, а не забывчивость:
  // прогон нашёл там 21 место (History, поповер сайта, виджеты стола), каждое надо смотреть
  // глазами в шести палитрах. Разом переписывать вслепую — ровно тот способ «всё разъедется»,
  // от которого мы и уходим. Расширять сюда по мере проверки экранов.
  const lawFiles = walk(path.join(ROOT, 'src', 'components', 'settings'), ['.tsx'])
    .concat([path.join(ROOT, 'src', 'components', 'ModelsSection.tsx')]);
  const FUNC = /var\(--(success-\d+|warning-\d+|danger-\d+|dot-[a-z]+)\)/;
  for (const f of lawFiles) {
    if (!fs.existsSync(f)) continue;
    fs.readFileSync(f, 'utf8').split('\n').forEach((raw, i) => {
      const line = raw.trim();
      if (line.startsWith('//') || line.startsWith('*')) return;
      if (/background(-color)?:/.test(line) && FUNC.test(line)) {
        hits.push(`${rel(f)}:${i + 1}  функциональный цвет в заливке`);
      }
      if (/(color|background|borderColor|fill|stroke)[^:]*:\s*'#[0-9a-fA-F]{3,8}'/.test(line)) {
        hits.push(`${rel(f)}:${i + 1}  цвет литералом вместо токена`);
      }
    });
  }

  // (3) Белый текст на акценте — по ВСЕМУ рендереру. ⚠️ Это не стилистика, а замер: в тёмной
  // теме акцент палитры поднят по светлоте, и белый на нём даёт от 1,77 («Мята») до 3,91
  // («Графит») при пороге 4,5. Токен --on-accent считается по теме и проходит везде (4,79–10,56).
  for (const f of walk(path.join(ROOT, 'src'), ['.tsx'])) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((raw, i) => {
      const line = raw.trim();
      if (line.startsWith('//') || line.startsWith('*')) return;
      if (/background[^;]*var\(--accent\)/.test(line) && /color:\s*'#(fff|FFF|ffffff|FFFFFF)'/.test(line)) {
        hits.push(`${rel(f)}:${i + 1}  белый литерал на акценте — нужен var(--on-accent)`);
      }
    });
  }

  // (4) Цвет СОДЕРЖИМОГО не появляется в системном хроме. ⚠️ Это половина смелого редизайна:
  // цвет разрешён на карточках стола и плитках хаба, но в настройках, тулбаре и списках он значит
  // «выбрано» — два языка в одном месте снова дадут пестроту, от которой уходили.
  for (const f of walk(path.join(ROOT, 'src', 'components', 'settings'), ['.tsx']).concat([path.join(ROOT, 'src', 'components', 'Settings.tsx')])) {
    if (!fs.existsSync(f)) continue;
    codeLines(fs.readFileSync(f, 'utf8')).forEach((line, i) => {
      if (line.includes('var(--card') || line.includes('card(') || line.includes('chip(')) {
        hits.push(rel(f) + ':' + (i + 1) + '  цвет содержимого в системном хроме');
      }
    });
  }

  checkEmpty('цветовой закон: акцент от палитры, статус без заливок, цвета токенами', hits,
    'акцент задаётся в palettes.css; состояние показывать значком и словом; брать var(--…)');
}

// ── Сетка: отступы только по шкале ───────────────────────────────────────────
//
// ⚠️ Шесть ступеней (4 · 8 · 12 · 16 · 24 · 32) живут в src/styles/system.ts. Правило нужно
// потому, что нарушение неощутимо поодиночке: одно «сделаю тут 10, так лучше смотрится» ничего
// не портит, а двадцать таких — уже «выглядит небрежно, но непонятно почему». Замер перед
// наведением порядка: 20 разных значений padding и 18 разных gap только в компонентах.
//
// Радиусы проверяются тем же правилом: три ступени (8 контрол · 12 коробка · 20 остров) плюс
// пилюля. Прежний набор включал 13 — значение «чтобы помягче», не согласованное ни с чем.
{
  const SCALE = new Set([0, 4, 8, 12, 16, 24, 32]);
  const RADII = new Set([0, 8, 12, 20, 999]);
  const files = walk(path.join(ROOT, 'src', 'components', 'settings'), ['.tsx'])
    .concat([path.join(ROOT, 'src', 'components', 'ModelsSection.tsx')]);
  const hits = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    fs.readFileSync(f, 'utf8').split('\n').forEach((raw, i) => {
      const line = raw.trim();
      if (line.startsWith('//') || line.startsWith('*')) return;
      for (const m of line.matchAll(/\b(gap|padding|paddingTop|paddingBottom|paddingLeft|paddingRight|marginTop|marginBottom): (\d+)\b/g)) {
        if (!SCALE.has(Number(m[2]))) hits.push(`${rel(f)}:${i + 1}  ${m[1]}: ${m[2]} — мимо шкалы`);
      }
      for (const m of line.matchAll(/padding: '(\d+)px(?: (\d+)px)?'/g)) {
        for (const v of [m[1], m[2]]) {
          if (v !== undefined && !SCALE.has(Number(v))) hits.push(`${rel(f)}:${i + 1}  padding ${v} — мимо шкалы`);
        }
      }
      for (const m of line.matchAll(/borderRadius: (\d+)\b/g)) {
        // ⚠️ Меньше 8 не проверяем: это не форма коробки, а деталь — полоса прогресса, полоска
        // скелета, квадратик образца цвета. Округлять их до ступени системы бессмысленно.
        if (Number(m[1]) >= 8 && !RADII.has(Number(m[1]))) hits.push(`${rel(f)}:${i + 1}  radius ${m[1]} — мимо трёх ступеней`);
      }
    });
  }
  console.log(`         (шкала: 4·8·12·16·24·32, радиусы: 8·12·20)`);
  checkEmpty('сетка: отступы и радиусы по шкале системы', hits,
    'брать sp()/pad()/RADIUS из src/styles/system.ts — там же меняется плотность всего интерфейса');
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
