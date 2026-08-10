// Реестр настроек и поиск по нему (AI-IDEAS.md №6).
//
// ⚠️ Основная работа тут НЕ в модели, а в этом файле. Поиск по ключевым словам закрывает
// большинство запросов, работает мгновенно и — главное — работает у человека БЕЗ скачанной
// модели. Модель подключается вторым эшелоном и только на промахе (см. electron/SettingsSearch.ts),
// ровно как в AutofillFieldMapper.ts. Фича, у которой единственный вход идёт через модель, у
// половины людей не работает вовсе — этот урок в проекте уже оплачен (см. «Программа» в CLAUDE.md).
//
// ⚠️ Файл в shared, а не в src: реестр спрашивают ОБА берега — renderer ищет и рисует, main
// строит по нему промпт и разбирает «ANSWER: N». Две копии руками разъедутся.
//
// ⚠️ `block` — это ДОСЛОВНЫЙ заголовок Subsection из соответствующей секции (kit.tsx проставляет
// его в data-setting-block). Расхождение не ломает ничего: раздел всё равно откроется, просто без
// подсветки блока.

export interface SettingsEntry {
  /** id раздела из NAV_ITEMS (Settings.tsx). */
  section: string;
  /** Заголовок блока внутри раздела. Пусто — у раздела нет отдельных блоков. */
  block?: string;
  /** Как показать находку человеку. */
  label: string;
  /** Имя раздела для второй строки подсказки. */
  sectionLabel: string;
  /** Слова, которыми человек СПРАШИВАЕТ, а не которыми мы назвали настройку. */
  keywords: string[];
}

export const SETTINGS_INDEX: SettingsEntry[] = [
  // ── Браузер ───────────────────────────────────────────────────────────────
  { section: 'general', block: 'Поиск по умолчанию', label: 'Поиск по умолчанию', sectionLabel: 'Браузер',
    keywords: ['поисковик', 'поисковая система', 'гугл', 'google', 'яндекс', 'yandex', 'duckduckgo', 'адресная строка', 'где искать'] },
  { section: 'general', block: 'Браузер по умолчанию', label: 'Браузер по умолчанию', sectionLabel: 'Браузер',
    keywords: ['основной браузер', 'ссылки из других программ', 'открывать ссылки', 'default'] },
  { section: 'general', block: 'Загрузки', label: 'Загрузки', sectionLabel: 'Браузер',
    keywords: ['скачивание', 'скачанные файлы', 'папка загрузок', 'куда сохраняются файлы', 'спрашивать куда сохранять', 'сохранить как'] },
  { section: 'general', block: 'Обновления', label: 'Обновления', sectionLabel: 'Браузер',
    keywords: ['новая версия', 'апдейт', 'update', 'проверить обновления'] },
  { section: 'general', block: 'Бэнги адресной строки', label: 'Бэнги адресной строки', sectionLabel: 'Браузер',
    keywords: ['бэнг', 'bang', 'быстрый переход', 'сокращения поиска', 'восклицательный знак'] },
  { section: 'general', block: 'Цели быстрого поиска', label: 'Цели быстрого поиска', sectionLabel: 'Браузер',
    keywords: ['ctrl+e', 'быстрый поиск', 'поповер поиска', 'полоса целей'] },
  { section: 'general', block: 'Импорт данных', label: 'Импорт данных из другого браузера', sectionLabel: 'Браузер',
    keywords: ['импорт', 'перенести', 'перенос', 'chrome', 'edge', 'закладки из другого браузера', 'пароли из другого браузера', 'история из другого браузера', 'миграция'] },

  // ── Интерфейс ─────────────────────────────────────────────────────────────
  { section: 'appearance', block: 'Тема', label: 'Тема', sectionLabel: 'Интерфейс',
    keywords: ['тёмная', 'темная', 'светлая', 'dark', 'ночной режим', 'оформление', 'как в системе'] },
  { section: 'appearance', block: 'Палитра', label: 'Палитра', sectionLabel: 'Интерфейс',
    keywords: ['оттенок', 'уголь', 'графит', 'сланец', 'бумага', 'цвета интерфейса', 'нейтраль'] },
  { section: 'appearance', block: 'Сайдбар', label: 'Сайдбар', sectionLabel: 'Интерфейс',
    keywords: ['боковая панель', 'градиент сайдбара', 'текстура'] },
  { section: 'appearance', block: 'Фон', label: 'Фон новой вкладки', sectionLabel: 'Интерфейс',
    keywords: ['обои', 'картинка', 'изображение', 'wallpaper', 'фото дня', 'заставка', 'градиент'] },
  { section: 'appearance', block: 'Часы', label: 'Часы', sectionLabel: 'Интерфейс',
    keywords: ['время', 'циферблат', 'секунды', '24 часа', 'стрелки'] },
  { section: 'appearance', block: 'Поиск', label: 'Строка поиска на новой вкладке', sectionLabel: 'Интерфейс',
    keywords: ['строка поиска', 'убрать поиск с новой вкладки', 'показывать поиск'] },
  { section: 'appearance', block: 'Погода', label: 'Погода', sectionLabel: 'Интерфейс',
    keywords: ['город', 'температура', 'прогноз'] },
  { section: 'appearance', block: 'Курс валют', label: 'Курс валют', sectionLabel: 'Интерфейс',
    keywords: ['доллар', 'евро', 'цб', 'валюта', 'обмен'] },
  { section: 'appearance', block: 'Крипта', label: 'Крипта', sectionLabel: 'Интерфейс',
    keywords: ['биткоин', 'btc', 'эфир', 'криптовалюта', 'монеты'] },

  // ── VPN и блокировка ──────────────────────────────────────────────────────
  { section: 'vpn', label: 'VPN', sectionLabel: 'VPN',
    keywords: ['подписка', 'сервер', 'прокси', 'страна', 'обход', 'защита соединения', 'kill switch'] },
  { section: 'adblock', label: 'Блокировка рекламы', sectionLabel: 'Блокировка',
    keywords: ['реклама', 'адблок', 'трекеры', 'баннеры', 'исключения', 'белый список', 'не блокировать'] },

  // ── AI ────────────────────────────────────────────────────────────────────
  { section: 'ai', label: 'Локальная модель', sectionLabel: 'AI',
    keywords: ['модель', 'скачать модель', 'qwen', 'локальный ии', 'нейросеть', 'выгрузить модель', 'видеопамять'] },
  { section: 'ai', block: 'Движок перевода страниц', label: 'Движок перевода страниц', sectionLabel: 'AI',
    keywords: ['перевод', 'переводчик', 'bergamot', 'язык страницы'] },
  { section: 'ai', block: 'Индексация истории для поиска', label: 'Индексация истории для поиска', sectionLabel: 'AI',
    keywords: ['умный поиск', 'поиск по истории', 'индекс'] },
  { section: 'ai', label: 'Фактчек и веб-поиск', sectionLabel: 'AI',
    keywords: ['gemini', 'фактчек', 'проверка фактов', 'searxng', 'веб-поиск', 'ключ api'] },

  // ── Личные данные ─────────────────────────────────────────────────────────
  { section: 'passwords', label: 'Пароли', sectionLabel: 'Пароли',
    keywords: ['сейф', 'vault', 'сохранённые пароли', 'генератор паролей', 'windows hello', 'логин'] },
  { section: 'autofill', block: 'Адреса', label: 'Адреса', sectionLabel: 'Автозаполнение',
    keywords: ['доставка', 'телефон', 'индекс', 'адрес доставки', 'заполнение форм'] },
  { section: 'autofill', block: 'Банковские карты', label: 'Банковские карты', sectionLabel: 'Автозаполнение',
    keywords: ['карта', 'оплата', 'номер карты', 'cvc', 'платёж'] },

  // ── Разрешения и правила ──────────────────────────────────────────────────
  { section: 'permissions', block: 'Сайты', label: 'Разрешения сайтов', sectionLabel: 'Разрешения',
    keywords: ['камера', 'микрофон', 'геолокация', 'уведомления', 'доступ сайтов', 'запретить сайту'] },
  { section: 'permissions', block: 'Сертификаты Минцифры', label: 'Сертификаты Минцифры', sectionLabel: 'Разрешения',
    keywords: ['сертификат', 'минцифры', 'банк не открывается', 'сбербанк', 'санкции', 'корневой'] },
  { section: 'rules', label: 'Правила-автоматизации', sectionLabel: 'Правила',
    keywords: ['автоматизация', 'автоматически', 'правило', 'группа для ссылок', 'включать vpn на сайте'] },
];

// ⚠️ «ё» приводим к «е», иначе «тёмная» и «темная» — два разных слова, и человек, набравший
// второе, не находит первое. Русская раскладка тут единственная, транслита не разбираем.
function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').trim();
}

function words(s: string): string[] {
  return normalize(s).split(/[^a-zа-я0-9+]+/).filter(Boolean);
}

// ⚠️ Совпадение считается ПО СЛОВАМ, а не подстрокой где угодно. Подстрокой «тема» находилась
// внутри «сис-ТЕМА», и запрос «тема» уверенно открывал «Поиск по умолчанию» вместо «Темы»
// (поймано прогоном). Внутрисловные совпадения в русском — почти всегда ложные.
//
// ⚠️ Имя настройки весит больше ключевых слов: «пароли» обязаны вести в «Пароли», а не в «Импорт
// данных», у которого в ключевых словах есть «пароли из другого браузера» (тоже поймано прогоном —
// счёт был равный, и побеждал порядок в массиве, то есть ничто).
const W_NAME_EXACT = 6;
const W_NAME_PREFIX = 4;
const W_KEYWORD_EXACT = 3;
const W_KEYWORD_PREFIX = 2;

function scoreToken(token: string, nameWords: string[], keyWords: string[]): number {
  // Длинное слово ищем по корню: русский склоняется, и «загрузку» обязано находить «Загрузки».
  // Четыре буквы, а не пять: на пятой позиции окончание уже отличается («сайтам» / «сайтов»).
  const stem = token.length >= 5 ? token.slice(0, 4) : token;
  if (nameWords.includes(token)) return W_NAME_EXACT;
  if (nameWords.some((w) => w.startsWith(stem))) return W_NAME_PREFIX;
  if (keyWords.includes(token)) return W_KEYWORD_EXACT;
  if (keyWords.some((w) => w.startsWith(stem))) return W_KEYWORD_PREFIX;
  return 0;
}

/**
 * Поиск по ключевым словам — ОСНОВНОЙ путь, без модели.
 *
 * ⚠️ Слово ищется ПО НАЧАЛУ, а не целиком: русский язык склоняется, и «пароля», «паролей»,
 * «загрузку» обязаны находить «Пароли» и «Загрузки». Полноценного стемминга тут не заводим —
 * он в проекте есть (textStemming.ts), но живёт в main ради FTS5, а этот путь обязан работать
 * в renderer мгновенно и без обращений наружу.
 */
export function searchSettings(query: string, limit = 5): SettingsEntry[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  // Слова короче трёх букв («на», «в», «до») ищут что угодно и только шумят.
  const tokens = q.split(/[\s,.;!?]+/).filter((t) => t.length >= 3);
  if (!tokens.length) return [];

  const scored: { entry: SettingsEntry; score: number }[] = [];
  for (const entry of SETTINGS_INDEX) {
    const nameWords = words(`${entry.label} ${entry.block ?? ''}`);
    const keyWords = words(`${entry.sectionLabel} ${entry.keywords.join(' ')}`);
    let score = 0;
    for (const token of tokens) score += scoreToken(token, nameWords, keyWords);
    if (score > 0) scored.push({ entry, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry);
}
