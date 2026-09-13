// Политика живой индексации истории (текст страницы → FTS).
//
// ⚠️ Значимых импортов нет: прогон scripts/history-index-check.mjs идёт голым node.
// ⚠️ Шум сюда переехал из electron/HistoryNoiseFilter.ts, чтобы решение «извлекать ли»
// и сам фильтр проверялись одним прогоном. Поведение фильтра — то же: логин/OAuth,
// голый домен-заголовок, технические заглушки. Запись в history от этого не зависит.

export type HistoryIndexTrigger = 'navigate' | 'title' | 'sleep';
export type HistoryNoiseKind = 'none' | 'title' | 'url';
export type HistoryIndexDecision = 'skip' | 'extract' | 'remember-url-noise';

// Два снимка разом: десяток фоновых вкладок не должен гнать Readability параллельно.
export const HISTORY_INDEX_CONCURRENCY = 2;

// Перед выгрузкой вкладки — короткий шанс снять текст. Не 8 с ожидания did-finish-load:
// страница уже была на экране, и память как раз просит её отдать.
export const SLEEP_INDEX_BUDGET_MS = 1500;

const NOISE_TITLE_WORDS = [
  'sign in', 'signin', 'log in', 'login', 'sign up', 'signup',
  'authorization', 'authenticate', 'authentication',
  'авторизация', 'вход', 'войти', 'регистрация', 'логин',
];

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

/** URL-шум важнее заголовка: логин не индексируем, даже если title уже «Добро пожаловать». */
export function classifyHistoryNoise(url: string, title: string): HistoryNoiseKind {
  if (hasNoiseUrlPattern(url)) return 'url';
  if (hasNoiseWord(title) || isBareDomainTitle(url, title) || isExactStub(title)) return 'title';
  return 'none';
}

export function isNoisyForEmbedding(url: string, title: string): boolean {
  return classifyHistoryNoise(url, title) !== 'none';
}

/** Ждать did-finish-load только если страница ещё грузится. Иначе слушатель ловит СЛЕДУЮЩИЙ load или 8 с. */
export function shouldWaitForPageLoad(state: { destroyed: boolean; loading: boolean }): boolean {
  return !state.destroyed && state.loading;
}

/**
 * Стоит ли снимать текст.
 *
 * ⚠️ На did-navigate заголовок часто ещё имя сайта («YouTube»). Старый путь помечал такое
 * «готовым» без чанка — и до рестарта повторные визиты были no-op. Теперь title-шум на
 * навигации — skip без запоминания, а page-title-updated заводит извлечение, когда заголовок
 * перестал быть шумным.
 * ⚠️ SPA сыплет title на каждое «(3)». Повтор только с title-шума на осмысленный заголовок,
 * не на каждый тик.
 */
export function decideHistoryIndex(s: {
  trigger: HistoryIndexTrigger;
  hasContent: boolean;
  memoryDone: boolean;
  inFlight: boolean;
  noise: HistoryNoiseKind;
  previousNoise: HistoryNoiseKind | null;
}): HistoryIndexDecision {
  if (s.hasContent || s.memoryDone || s.inFlight) return 'skip';
  if (s.noise === 'url') return 'remember-url-noise';
  if (s.trigger === 'title') {
    if (s.noise !== 'none') return 'skip';
    if (s.previousNoise === 'title' || s.previousNoise === null) return 'extract';
    return 'skip';
  }
  if (s.trigger === 'navigate') {
    return s.noise === 'none' ? 'extract' : 'skip';
  }
  return 'extract';
}
