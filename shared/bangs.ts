// Бэнги омнибокса — «!yt котики» уводит запрос сразу на YouTube, минуя поисковик.
// Идея заимствована у DuckDuckGo, реализация своя; список встроенных бэнгов ниже — тоже свой,
// короткий и курируемый. Полный набор DDG (~13 000 записей, 2.2 МБ) в репозиторий НЕ кладётся:
// это чужой датасет, и вес лишний — пользователь может подтянуть его в userData сам из настроек
// (см. electron/BangStore.ts::importDuckDuckGoBangs).
//
// Модуль общий для main и renderer, как shared/searchEngines.ts: main разрешает бэнг при
// навигации (TabManager.resolveInput), renderer показывает и редактирует список в настройках —
// формат один, дублировать нечего.

export interface BangDef {
  // Ключ без «!», всегда в нижнем регистре (сравнение регистронезависимое).
  key: string;
  name: string;
  // Шаблон URL с плейсхолдером {query}. Именно строка, а не функция: пользовательские бэнги
  // приходят из JSON и обязаны иметь тот же тип, что встроенные, иначе появятся две разные
  // ветки обработки — а это ровно тот класс расхождений, который мы уже ловили в дропдауне.
  template: string;
  // Куда идти, если запрос пустой («!yt» без слов). Не задано — берём origin шаблона.
  home?: string;
}

// Встроенный набор: только частотное и проверяемое. Намеренно короткий — длинные списки
// пусть приходят импортом, здесь важнее, чтобы каждый шаблон был живым.
export const BUILTIN_BANGS: readonly BangDef[] = [
  { key: 'g',    name: 'Google',        template: 'https://www.google.com/search?q={query}' },
  { key: 'ya',   name: 'Яндекс',        template: 'https://yandex.ru/search/?text={query}' },
  { key: 'ddg',  name: 'DuckDuckGo',    template: 'https://duckduckgo.com/?q={query}' },
  { key: 'yt',   name: 'YouTube',       template: 'https://www.youtube.com/results?search_query={query}', home: 'https://www.youtube.com/' },
  { key: 'w',    name: 'Википедия (ru)', template: 'https://ru.wikipedia.org/w/index.php?search={query}', home: 'https://ru.wikipedia.org/' },
  { key: 'we',   name: 'Wikipedia (en)', template: 'https://en.wikipedia.org/w/index.php?search={query}', home: 'https://en.wikipedia.org/' },
  { key: 'gh',   name: 'GitHub',        template: 'https://github.com/search?q={query}', home: 'https://github.com/' },
  { key: 'so',   name: 'Stack Overflow', template: 'https://stackoverflow.com/search?q={query}' },
  { key: 'npm',  name: 'npm',           template: 'https://www.npmjs.com/search?q={query}', home: 'https://www.npmjs.com/' },
  { key: 'mdn',  name: 'MDN',           template: 'https://developer.mozilla.org/search?q={query}' },
  { key: 'habr', name: 'Хабр',          template: 'https://habr.com/ru/search/?q={query}', home: 'https://habr.com/ru/' },
  { key: 'tr',   name: 'Google Переводчик', template: 'https://translate.google.com/?text={query}' },
  { key: 'map',  name: 'Яндекс Карты',  template: 'https://yandex.ru/maps/?text={query}' },
  { key: 'img',  name: 'Картинки Google', template: 'https://www.google.com/search?tbm=isch&q={query}' },
  { key: 'r',    name: 'Reddit',        template: 'https://www.reddit.com/search/?q={query}', home: 'https://www.reddit.com/' },
  { key: 'kp',   name: 'Кинопоиск',     template: 'https://www.kinopoisk.ru/index.php?kp_query={query}', home: 'https://www.kinopoisk.ru/' },
  { key: 'ozon', name: 'Ozon',          template: 'https://www.ozon.ru/search/?text={query}', home: 'https://www.ozon.ru/' },
  { key: 'wb',   name: 'Wildberries',   template: 'https://www.wildberries.ru/catalog/0/search.aspx?search={query}', home: 'https://www.wildberries.ru/' },
  { key: 'hh',   name: 'hh.ru',         template: 'https://hh.ru/search/vacancy?text={query}', home: 'https://hh.ru/' },
  { key: 'aw',   name: 'Веб-архив',     template: 'https://web.archive.org/web/*/{query}', home: 'https://web.archive.org/' },
];

export const BANG_PREFIX = '!';

// Подставляет запрос в шаблон. encodeURIComponent — обязателен: запрос уходит в query-строку,
// без него пробелы и кириллица ломают URL. Плейсхолдер может встречаться несколько раз.
export function applyBangTemplate(template: string, query: string): string {
  return template.replace(/\{query\}/g, encodeURIComponent(query));
}

// Домашняя страница бэнга — куда идти при «!yt» без запроса. Явное поле home, иначе origin
// шаблона: для большинства сайтов это ровно то, что нужно, и не требует ручного заполнения.
export function bangHomeUrl(bang: BangDef): string {
  if (bang.home) return bang.home;
  try { return new URL(bang.template).origin + '/'; } catch { return applyBangTemplate(bang.template, ''); }
}

export interface ParsedBang {
  key: string;   // без «!», в нижнем регистре
  query: string; // остаток строки; пустой — значит «просто открой сайт»
}

// Чистый разбор строки омнибокса: вычленяет КАНДИДАТА в бэнги, ничего не зная о том, какие
// бэнги существуют. Проверку «а есть ли такой» делает вызывающая сторона (BangStore) — так
// эта функция остаётся тестируемой и не тянет за собой хранилище.
//
// Поддерживаются обе позиции, как у DuckDuckGo: «!gh oblako» и «oblako !gh». Хвостовая форма
// безопасна ровно потому, что вызывающая сторона сверяет ключ со СПИСКОМ: обычный текст,
// случайно окончившийся на «!что-то», совпадёт только если пользователь сам завёл такой бэнг.
export function parseBangCandidate(input: string): ParsedBang | null {
  const s = input.trim();
  if (!s) return null;

  // Ключ бэнга: буквы/цифры/дефис/подчёркивание. Пробелов внутри быть не может.
  const leading = /^!([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i.exec(s);
  if (leading) {
    return { key: leading[1]!.toLowerCase(), query: (leading[2] ?? '').trim() };
  }

  const trailing = /^([\s\S]*?)\s+!([a-z0-9_-]+)$/i.exec(s);
  if (trailing) {
    return { key: trailing[2]!.toLowerCase(), query: trailing[1]!.trim() };
  }

  return null;
}

// ── Вывод бэнга из адреса открытой страницы ───────────────────────────────────
//
// Ручное составление шаблона — самое неудобное место фичи: пользователь обязан сам понять
// структуру URL и подставить {query}. Здесь браузер делает это за него: если человек уже
// выполнил поиск на сайте, адрес результатов содержит и параметр, и введённое слово — этого
// достаточно, чтобы восстановить шаблон.
//
// Почему по URL, а не по <form> на странице: у сайтов на React формы часто нет вовсе (живой
// пример — overgear.com, поиск там компонент без action), а адрес результатов есть всегда.

// Имена параметров, под которыми сайты обычно передают поисковый запрос. Порядок важен: при
// нескольких совпадениях берём первое, более специфичное.
const SEARCH_PARAM_NAMES = [
  'q', 'query', 'search', 'search_query', 'searchquery', 'text', 'keyword', 'keywords',
  'term', 'wd', 'kp_query', 's', 'k', 'p',
];

export interface DerivedBang {
  key: string;
  name: string;
  template: string;
  // Параметр, по которому распознали поиск, — UI показывает его, чтобы человек мог убедиться,
  // что браузер понял страницу правильно, а не поверил вслепую.
  param: string;
}

// Возвращает заготовку бэнга по адресу страницы результатов поиска. null — если в адресе нет
// ничего, похожего на поисковый запрос (обычная страница сайта).
export function deriveBangFromUrl(rawUrl: string): DerivedBang | null {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;

  // Ищем параметр с НЕПУСТЫМ значением: пустой (?q=) шаблоном не поможет — непонятно, что
  // именно подставлять, и в каком виде сайт ждёт запрос.
  let param: string | null = null;
  for (const name of SEARCH_PARAM_NAMES) {
    const v = u.searchParams.get(name);
    if (v !== null && v.trim() !== '') { param = name; break; }
  }
  if (param === null) return null;

  // Значение подменяем плейсхолдером, остальные параметры сохраняем как есть — они бывают
  // обязательными (язык, раздел каталога, тип поиска).
  const copy = new URL(u.toString());
  copy.searchParams.set(param, '__OBLAKO_QUERY__');
  // searchParams при сериализации кодирует плейсхолдер — возвращаем его обратно в читаемый вид.
  const template = copy.toString().replace(/__OBLAKO_QUERY__/g, '{query}');
  if (!isValidBangTemplate(template)) return null;

  const host = u.hostname.replace(/^www\./i, '');
  const label = host.split('.')[0] ?? host;
  return {
    // Ключ — первая метка домена: короткий, узнаваемый и почти всегда свободный. Человек
    // всё равно увидит его в форме и сможет сократить до «og».
    key: label.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
    name: label.charAt(0).toUpperCase() + label.slice(1),
    template,
    param,
  };
}

// Валидация ключа для пользовательского ввода в настройках. Отдельно от парсера: тот разбирает
// уже введённое, а этот — решает, можно ли ТАКОЕ сохранить.
export function isValidBangKey(key: string): boolean {
  return /^[a-z0-9_-]{1,32}$/i.test(key);
}

// Шаблон обязан содержать плейсхолдер и быть http(s) — иначе бэнг молча уводил бы не туда
// (а с file:/javascript: — ещё и опасно, шаблон приходит из пользовательского ввода/импорта).
export function isValidBangTemplate(template: string): boolean {
  if (!template.includes('{query}')) return false;
  try {
    const u = new URL(applyBangTemplate(template, 'x'));
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
