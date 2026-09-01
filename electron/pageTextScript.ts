import { readFileSync } from 'node:fs'
import { PAGE_FACTS_SCRIPT } from './pageFacts'

// ── Скрипт извлечения текста страницы ────────────────────────────────────────
//
// ⚠️ Отдельным файлом от AiPanelManager, и это тот же приём, что с контекстным меню: строка,
// которую мы инжектим в чужую страницу, — не управление панелью. Она ничего не знает ни про
// окно, ни про вью, ни про чат; связывает её с панелью один вызов. А AiPanelManager за порогом
// храповика структуры (scripts/structure-check.mjs), и новая работа в нём оплачивается выносом,
// а не поднятием базы.
//
// ⚠️ Пороги, по которым РЕШАЮТ, годится ли результат Readability (READABILITY_MIN_CHARS/RATIO),
// намеренно остались в AiPanelManager: скрипт всегда считает ОБА варианта, а выбор между ними —
// не его дело. Ровно об этом комментарий у buildExtractionScript ниже.

// ── Извлечение текста страницы в контекст чата (Заход 4, Readability — этот заход) ──────────
// Переиспользует ТОТ ЖЕ мост, что и SELECTION_RECT_SCRIPT для поповера перевода (TabManager.ts) —
// executeJavaScript(script, true) на WebContents вкладки. Умный путь: Mozilla Readability (та же
// библиотека, что режим чтения в Firefox) — вычленяет заголовок+тело статьи, отбрасывая
// меню/футер/рекламу/сайдбары. НЕ переписываем эвристику вручную — читаем готовый Readability.js
// с диска и инжектим его ИСХОДНИК прямо в страницу (та же труба executeJavaScript, не отдельный
// jsdom-парсинг в main), выполняем на document.cloneNode(true) — так рекомендует сам README
// библиотеки: parse() мутирует DOM, клон не даёт сломать реальную страницу пользователя.
let readabilitySource: string | null = null
function getReadabilitySource(): string {
  if (readabilitySource === null) {
    readabilitySource = readFileSync(require.resolve('@mozilla/readability/Readability.js'), 'utf-8')
  }
  return readabilitySource
}

// Инжектируемый скрипт всегда считает ОБА варианта (readability + весь innerText) — решение, какой
// использовать, и оба порога живут в extractPageText (main), а не зашиты в саму строку скрипта:
// подкручивать READABILITY_MIN_CHARS/RATIO не нужно трогать генерацию скрипта.
// articleHtml (этот заход) — article.content, HTML статьи, который parse() и так вычисляет, но
// раньше просто выбрасывался. readabilityText/fullText — поля прежние, не тронуты.
export function buildExtractionScript(): string {
  return `(function(){
    ${getReadabilitySource()}
    ${PAGE_FACTS_SCRIPT}

    // Сначала факты — по НЕТРОНУТОМУ документу: чистка ниже могла бы задеть разметку,
    // из которой они читаются.
    var facts;
    try { facts = __oblakoCollectFacts(); } catch (e) { facts = null; }

    // Затем клон БЕЗ блоков отзывов. Это ключевая часть: на карточке товара отзывы длиннее
    // описания, и Readability уверенно выбирает именно их — не проваливаясь, поэтому прежний
    // фолбэк не срабатывал. Режем на клоне, живую страницу пользователя не трогаем.
    var removedChars = 0;
    var readabilityText = '';
    var articleHtml = '';
    try {
      // Помечаем находки атрибутом и клонируем СРАЗУ, без единого await между: так метки
      // переезжают на клон вместе с узлами. Раньше здесь был перенос по индексному пути от
      // корня — и он ломался: после первого же удаления индексы соседей съезжали, и остальные
      // пути вели не туда, из-за чего блок отзывов выживал целиком.
      //
      // ⚠️ Страховка от жадности ниже: если после чистки от страницы почти ничего не
      // осталось, значит эвристика зацепила само содержимое (бывает на нестандартной
      // вёрстке) — тогда честнее вернуть неочищенный текст, чем отдать модели огрызок.
      var marked = [];
      try {
        marked = __oblakoJunkNodes();
        for (var i = 0; i < marked.length; i++) marked[i].setAttribute('data-oblako-junk', '1');
      } catch (e) { marked = []; }

      var docClone = document.cloneNode(true);

      // Живую страницу возвращаем в исходный вид немедленно — она пользователя, не наша.
      for (var u = 0; u < marked.length; u++) {
        try { marked[u].removeAttribute('data-oblako-junk'); } catch (e) { /* узел исчез */ }
      }

      try {
        var junk = docClone.querySelectorAll('[data-oblako-junk]');
        for (var j = 0; j < junk.length; j++) {
          if (!junk[j].parentNode) continue; // уже уехал вместе с удалённым предком
          removedChars += (junk[j].textContent || '').length;
          junk[j].parentNode.removeChild(junk[j]);
        }
      } catch (e) { /* не вышло вычистить — Readability отработает по полному клону */ }

      var article = new Readability(docClone).parse();
      readabilityText = (article && article.textContent) ? article.textContent.trim() : '';
      articleHtml = (article && article.content) ? article.content : '';
    } catch (e) { readabilityText = ''; articleHtml = ''; }

    // ⚠️ Полный текст берём с ОЧИЩЕННОГО клона, а не с живой страницы. Иначе выходит две
    // беды разом: фолбэк возвращает отзывы, которые мы только что вырезали, и сравнение
    // «Readability дала слишком мало относительно всей страницы» становится нечестным —
    // очищенный результат меряется против неочищенного оригинала и всегда проигрывает.
    var fullText = '';
    try {
      var cloneBody = docClone.body;
      fullText = cloneBody ? (cloneBody.innerText || cloneBody.textContent || '') : '';
      fullText = fullText.replace(/[ \\t]+/g, " ").replace(/(\\r?\\n){3,}/g, "\\n\\n").trim();
    } catch (e) { fullText = ''; }
    // Клон не в дереве отрисовки — если текста не добыть, берём живую страницу как есть.
    var liveText = document.body ? (document.body.innerText || '') : '';
    if (!fullText) fullText = liveText;

    // Чистка сработала слишком жадно: осталась десятая часть или вовсе крохи. Значит
    // эвристика приняла содержимое за обвязку — откатываемся на неочищенный текст.
    var tooGreedy = liveText.length > 500
      && (fullText.length < 400 || fullText.length < liveText.length * 0.1);
    if (tooGreedy) {
      fullText = liveText;
      readabilityText = '';   // заставит пойти по ветке fallback ниже
      articleHtml = '';
    }

    if (facts) facts.removedReviewChars = removedChars;
    return {
      readabilityText: readabilityText, fullText: fullText,
      articleHtml: articleHtml, facts: facts
    };
  })()`
}

// Единственное место лимита — легко менять. Длинная страница (тысячи слов) иначе переполнит
// контекст Qwen вместе с историей беседы; обрезаем «в лоб» (начало текста), без суммаризации —
// та тоже в бэклог. Умный контент (Readability) обычно уже заметно короче — мусора меньше, но
// лимит всё равно нужен: длинная статья сама по себе может быть длиннее лимита.
// 28000 симв. ≈ 8-10k токенов — измерено (см. историю задач: ctxdiag-замер), n_ctx сейчас
// 43,520 токенов, свободного VRAM под УВЕЛИЧЕНИЕ n_ctx нет (0.09ГБ), но сам n_ctx уже выделен
// и почти не используется (~2-3%) — расти в рамках уже оплаченного бюджета не стоит VRAM,
// только удлиняет prefill. Оставлен запас на историю чата + системный промпт + ответ модели
// (n_ctx=43520 - text budget здесь ~8-10k ток. = десятки тысяч токенов на диалог).
export const PAGE_TEXT_MAX_CHARS = 28000
