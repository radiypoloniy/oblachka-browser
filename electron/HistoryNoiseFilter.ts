// Фильтр «шумных» для эмбеддинга страниц — экраны логина/авторизации, OAuth-редиректы, голые
// домены без содержательного заголовка, технические заглушки (заход G, диагностика семантического
// поиска). НЕ влияет на запись в history — recordVisit/updateTitle (HistoryManager.ts) видят и
// пишут такие визиты как обычно, это только сигнал для индексатора эмбеддингов: не считать вектор
// для страницы, которая не несёт содержательного сигнала для смыслового поиска.
//
// ⚠️ Эвристика, не абсолютная истина. Список паттернов подобран по факту разбора уже накопленной
// истории (одна сессия, один пользователь) — с ростом истории или для других сервисов авторизации
// потребуется донастройка. Не считать сегодняшний список финальным навсегда.

const NOISE_TITLE_WORDS = [
  'sign in', 'signin', 'log in', 'login', 'sign up', 'signup',
  'authorization', 'authenticate', 'authentication',
  'авторизация', 'вход', 'войти', 'регистрация', 'логин',
];

// Точные технические заглушки — сравниваются по строке целиком, без учёта длины/регистра.
const EXACT_STUB_TITLES = new Set(
  [
    'Document',
    'Server Error',
    'Example Domain',
    'Один момент…',
    'Один момент...',
    'Approved Clicked',
    'Верификация',
  ].map((s) => s.trim().toLowerCase()),
);

const NOISE_URL_PATTERNS = [
  /\/auth(\/|\?|$)/i,
  /\/login(\/|\?|$)/i,
  /\/signin(\/|\?|$)/i,
  /\/sign-in(\/|\?|$)/i,
  /\/sso(\/|\?|$)/i,
  /oauth/i,
  /authorize/i,
  /consent\.google\.com/i,
  /showcaptchafast/i,
  /passport\.yandex\.ru/i,
  /id\.sber\.ru/i,
  /accounts\.google\.com\/(signin|gsi)/i,
];

function bareDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// title == домен/поддомен целиком (например «YouTube» на youtube.com) — заголовок не несёт
// ничего сверх самого URL, эмбеддинг такой строки не даёт семантического поиска сигнала.
function isBareDomainTitle(url: string, title: string): boolean {
  const domain = bareDomain(url);
  if (!domain) return false;
  const t = title.trim().toLowerCase();
  const domainCore = domain.split('.')[0]!.toLowerCase();
  return t === domain.toLowerCase() || t === domainCore;
}

function hasNoiseWord(title: string): boolean {
  const t = title.trim().toLowerCase();
  return NOISE_TITLE_WORDS.some(
    (w) => t === w || t.startsWith(`${w} `) || t.startsWith(`${w} -`) || t.startsWith(`${w} |`),
  );
}

function isExactStub(title: string): boolean {
  return EXACT_STUB_TITLES.has(title.trim().toLowerCase());
}

function hasNoiseUrlPattern(url: string): boolean {
  return NOISE_URL_PATTERNS.some((re) => re.test(url));
}

// Три подтверждённых критерия (см. диагностику захода G): noise-word/bare-domain по title,
// паттерн по url (авторизация/OAuth/SSO), точные технические заглушки title. Длина title сама
// по себе НЕ критерий — слишком грубо, ложно ловит короткие, но содержательные заголовки
// (заголовки статей, названия категорий, поисковые запросы).
export function isNoisyForEmbedding(url: string, title: string): boolean {
  if (hasNoiseWord(title)) return true;
  if (isBareDomainTitle(url, title)) return true;
  if (hasNoiseUrlPattern(url)) return true;
  if (isExactStub(title)) return true;
  return false;
}
