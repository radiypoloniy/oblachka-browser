// Профили чужих AI-сайтов для узла-веб-приложения граф-воркспейса.
//
// ГЛАВНЫЙ ПРИНЦИП: обмен идёт ЧЕРЕЗ РУКУ ЧЕЛОВЕКА. Мы умеем только два действия —
// положить текст в поле ввода и прочитать ответ. Отправку жмёт пользователь сам.
// Код НИГДЕ не нажимает кнопку отправки и не ждёт окончания генерации.
//
// Почему так, а не полная автоматизация:
//  • DOM чужого чата не контракт — он меняется без предупреждения, и связка «вставил →
//    отправил → дождался → забрал» разваливается целиком на любой их правке;
//  • автоматизированное обращение к веб-интерфейсу запрещено условиями OpenAI, Google и
//    Anthropic, а цена нарушения — блокировка аккаунта ПОЛЬЗОВАТЕЛЯ, не нашего сервиса;
//  • момент «генерация закончилась» определяется только эвристикой по DOM, то есть неточно.
// При ручном обмене поломка селектора стоит одной не сработавшей кнопки, а не всего графа.
//
// Инъекция идёт через webContents.executeJavaScript в мире страницы. Изоляцию это не
// ослабляет: у вью нет preload и нет моста Oblako (см. GraphWebAppManager), мы лишь
// выполняем выражение в контексте страницы и забираем строку.

export interface WebAppProfile {
  id: string;
  title: string;
  url: string;
  // CSS-селектор последнего ответа ассистента. Ненадёжен по своей природе — селекторы
  // чужих сайтов гниют. Поэтому он ВСЕГДА лишь ускорение: если не сработал, остаётся
  // универсальный путь «забрать выделенное», который не зависит от вёрстки вообще.
  answerSelector?: string;
}

// Набор — стартовый и правится пользователем: узел хранит свой url в конфиге, профиль
// подбирается по хосту только ради селектора ответа.
export const WEB_APP_PROFILES: WebAppProfile[] = [
  { id: 'chatgpt', title: 'ChatGPT', url: 'https://chatgpt.com/',
    answerSelector: '[data-message-author-role="assistant"]' },
  { id: 'claude', title: 'Claude', url: 'https://claude.ai/new',
    answerSelector: '[data-testid="assistant-message"], .font-claude-message' },
  { id: 'gemini', title: 'Gemini', url: 'https://gemini.google.com/app',
    answerSelector: 'message-content, .model-response-text' },
  { id: 'deepseek', title: 'DeepSeek', url: 'https://chat.deepseek.com/',
    answerSelector: '.ds-markdown' },
  { id: 'perplexity', title: 'Perplexity', url: 'https://www.perplexity.ai/',
    answerSelector: '.prose' },
];

export function profileForUrl(url: string): WebAppProfile | null {
  let host: string;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
  return WEB_APP_PROFILES.find((p) => {
    try { return new URL(p.url).hostname.replace(/^www\./, '') === host; } catch { return false; }
  }) ?? null;
}

// ── Инъекции ─────────────────────────────────────────────────────────────────

// Кладёт текст в поле ввода страницы. Поле ищем эвристикой, а не по селектору сайта:
// composer — это почти всегда самый крупный видимый contenteditable или textarea, и такая
// эвристика переживает редизайн, в отличие от классов.
//
// Значение ставим через нативный сеттер прототипа: React вешает свой сеттер на элемент и
// присвоение element.value он не замечает — поле визуально заполнится, но состояние
// компонента останется пустым, и отправится пустой запрос. Этот приём — стандартное
// лекарство именно от контролируемых React-полей.
export function buildInsertScript(text: string): string {
  const payload = JSON.stringify(text);
  return `(() => {
    const text = ${payload};
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 80 && r.height > 16 && getComputedStyle(el).visibility !== 'hidden';
    };
    const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
      .filter((el) => !el.disabled && !el.readOnly && visible(el))
      .sort((a, b) => area(b) - area(a));
    const el = candidates[0];
    if (!el) return 'no-input';

    el.focus();
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
    return 'ok';
  })()`;
}

// Забирает то, что человек выделил мышью. Универсально: не зависит ни от вёрстки сайта,
// ни от того, чат это вообще или обычная страница.
export const SELECTION_SCRIPT = `(() => (window.getSelection()?.toString() ?? '').trim())()`;

// Забирает последний ответ ассистента по селектору профиля. Быстрее выделения руками, но
// именно эта часть и гниёт — поэтому пустой результат не ошибка, а сигнал показать
// человеку подсказку про выделение.
export function buildLastAnswerScript(selector: string): string {
  return `(() => {
    const nodes = document.querySelectorAll(${JSON.stringify(selector)});
    const last = nodes[nodes.length - 1];
    return last ? (last.innerText ?? '').trim() : '';
  })()`;
}
