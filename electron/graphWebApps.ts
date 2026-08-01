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
      return 'ok';
    }

    // Contenteditable у современных чатов — это редактор (ProseMirror у ChatGPT, Lexical у
    // других), который держит СВОЮ модель документа. Присваивание textContent меняет DOM в
    // обход редактора: текст видно, но состояние редактора остаётся пустым — кнопка отправки
    // не оживает, а первая же правка стирает вставленное. execCommand('insertText') идёт
    // штатным путём редактирования (beforeinput/input), и редактор принимает текст как
    // набранный руками. Метод помечен устаревшим, но остаётся единственным способом
    // отдать текст произвольному редактору снаружи.
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel?.removeAllRanges();
    sel?.addRange(range);
    if (document.execCommand('insertText', false, text)) return 'ok';

    // Фолбэк для полей попроще, где execCommand запрещён.
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    return 'ok';
  })()`;
}

// Забирает то, что человек выделил мышью. Универсально: не зависит ни от вёрстки сайта,
// ни от того, чат это вообще или обычная страница.
export const SELECTION_SCRIPT = `(() => (window.getSelection()?.toString() ?? '').trim())()`;

// Поиск сгенерированной картинки в чужом чате. Селекторов сайта здесь НЕТ намеренно: они
// гниют быстрее всего, а «крупная картинка в переписке» — признак, который переживёт
// редизайн. Аватарки, иконки и логотипы отсекаются по размеру.
//
// Берём ПОСЛЕДНЮЮ подходящую: за сессию человек генерирует несколько вариантов, и нужен
// свежий. Если что-то выделено мышью — предпочитаем картинку внутри выделения: это явное
// «вот эту», и оно важнее эвристики.
//
// blob:/data: главный процесс скачать не может (URL живёт только в этой странице), поэтому
// такие превращаем в data-URL прямо здесь. Обычные ссылки отдаём как есть — main заберёт их
// той же сессией с куками, иначе подписанная ссылка ответит 403.
export const IMAGE_CAPTURE_SCRIPT = `(async () => {
  var MIN = 256;
  var all = Array.prototype.slice.call(document.images || []);
  var big = all.filter(function (im) {
    var w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
    return w >= MIN && h >= MIN && im.src;
  });
  if (!big.length) return { error: 'В чате не нашлось картинки — сгенерируйте её и попробуйте снова' };

  var sel = window.getSelection();
  var picked = null;
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    var range = sel.getRangeAt(0);
    for (var i = big.length - 1; i >= 0; i--) {
      if (range.intersectsNode(big[i])) { picked = big[i]; break; }
    }
  }
  if (!picked) picked = big[big.length - 1];

  var src = picked.currentSrc || picked.src;
  if (/^(blob:|data:)/i.test(src)) {
    try {
      var blob = await (await fetch(src)).blob();
      var dataUrl = await new Promise(function (ok, no) {
        var fr = new FileReader();
        fr.onload = function () { ok(fr.result); };
        fr.onerror = function () { no(new Error('read')); };
        fr.readAsDataURL(blob);
      });
      return { dataUrl: dataUrl };
    } catch (e) {
      return { error: 'Картинка не читается со страницы' };
    }
  }
  return { url: src };
})()`;

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
