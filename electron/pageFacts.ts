// ── Факты со страницы: слой ПЕРЕД Readability ────────────────────────────────
//
// Зачем. Readability ищет самый большой связный блок текста. На статье это и есть статья,
// а на карточке товара — блок отзывов: он длиннее описания и характеристик вместе взятых.
// При этом Readability формально НЕ проваливается (текста много), поэтому прежний фолбэк
// «взять весь innerText» не срабатывал, и в модель уезжали мнения о доставке вместо
// характеристик. Замер по живым страницам: у Ozon есть JSON-LD Product (название, цена,
// рейтинг, описание), а характеристики лежат в списках <dl>; у Wildberries структурных
// данных нет вовсе.
//
// Отсюда устройство: сначала собираем ФАКТЫ (структурные данные + пары «ключ-значение»),
// потом чистим DOM от блоков отзывов и только затем отдаём его Readability. Итоговый текст —
// карточка фактов сверху, проза снизу: лимит символов режет хвост, и факты обязаны быть
// в начале, иначе их срежет первыми.

export interface PageFacts {
  kind: string | null;          // Product / Recipe / Article / … из schema.org
  name: string | null;
  brand: string | null;
  price: string | null;
  currency: string | null;
  rating: string | null;
  ratingCount: string | null;
  availability: string | null;
  description: string | null;
  specs: Array<{ k: string; v: string }>;
  removedReviewChars: number;   // сколько текста отзывов вырезали — для лога
}

// Ограничения: страница может подсунуть сотни пар (навигация, футер) — берём разумный срез.
const MAX_SPECS = 60;
const MAX_KEY_CHARS = 60;
const MAX_VALUE_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 1200;

// Фрагмент, исполняемый В КОНТЕКСТЕ СТРАНИЦЫ. Отдельной строкой, потому что уезжает внутрь
// executeJavaScript вместе с исходником Readability (см. buildExtractionScript).
//
// ⚠️ Никакого доступа к Node здесь нет и быть не должно: это чужая страница.
export const PAGE_FACTS_SCRIPT = `
function __oblakoText(el, limit) {
  var t = (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, ' ').trim();
  return limit ? t.slice(0, limit) : t;
}

// Мусор, который надо убрать ДО Readability. Две группы с разной степенью уверенности.
//
// Отзывы: на карточке товара они длиннее описания, и Readability уверенно выбирает именно
// их — не проваливаясь, поэтому фолбэк по «слишком мало текста» не срабатывал.
//
// Обвязка сайта: шапка, футер, навигация. На маркетплейсах это десятки ссылок («Москва,
// Отели, Авиабилеты, Стать продавцом…»), которые идут ПЕРЕД товаром и съедают бюджет
// символов раньше, чем до товара дойдёт очередь.
//
// Здесь намеренно НЕ ловим по вольным словам вроде promo/banner/sidebar: на товарных
// страницах такие классы часто висят на самом товаре, и жадная чистка убила бы содержимое.
// Берём только структурные теги, ARIA-роли и узкий список имён с границами слова.
function __oblakoJunkNodes() {
  var found = [];
  function add(el) { if (el && found.indexOf(el) < 0) found.push(el); }

  // ── Отзывы ──
  var reviewAttr = /review|otzyv|otziv|comment|feedback|\\u043e\\u0442\\u0437\\u044b\\u0432/i;
  var withAttrs = document.querySelectorAll('[data-widget], [id], [class]');
  for (var i = 0; i < withAttrs.length; i++) {
    var el = withAttrs[i];
    var sig = (el.getAttribute('data-widget') || '') + ' ' + (el.id || '') + ' '
      + (typeof el.className === 'string' ? el.className : '');
    if (reviewAttr.test(sig)) add(el);
  }
  var heads = document.querySelectorAll('h1, h2, h3');
  var headHit = /^\\s*(\\u043e\\u0442\\u0437\\u044b\\u0432|review|\\u043a\\u043e\\u043c\\u043c\\u0435\\u043d\\u0442\\u0430\\u0440)/i;
  for (var j = 0; j < heads.length; j++) {
    if (headHit.test(heads[j].textContent || '')) add(heads[j].closest('section, div'));
  }

  // ── Обвязка сайта ──
  var chrome = document.querySelectorAll(
    'header, footer, nav, aside, [role="navigation"], [role="banner"], [role="contentinfo"]'
  );
  for (var c = 0; c < chrome.length; c++) add(chrome[c]);

  var nameHit = /(^|[-_ ])(header|footer|nav|navbar|navigation|menu|breadcrumbs?|cookie|newsletter|subscribe)([-_ ]|$)/i;
  for (var n = 0; n < withAttrs.length; n++) {
    var e2 = withAttrs[n];
    var sig2 = (e2.id || '') + ' ' + (typeof e2.className === 'string' ? e2.className : '');
    if (nameHit.test(sig2)) add(e2);
  }

  return found;
}

function __oblakoCollectFacts() {
  var facts = {
    kind: null, name: null, brand: null, price: null, currency: null,
    rating: null, ratingCount: null, availability: null, description: null,
    specs: [], removedReviewChars: 0
  };

  // 1. JSON-LD. Обходим вложенность @graph — часть сайтов кладёт Product именно туда.
  try {
    var blocks = document.querySelectorAll('script[type="application/ld+json"]');
    var queue = [];
    for (var i = 0; i < blocks.length; i++) {
      try {
        var parsed = JSON.parse(blocks[i].textContent || 'null');
        if (parsed) queue.push(parsed);
      } catch (e) { /* битый JSON-LD — не повод ронять извлечение */ }
    }
    while (queue.length) {
      var node = queue.shift();
      if (Array.isArray(node)) { for (var a = 0; a < node.length; a++) queue.push(node[a]); continue; }
      if (!node || typeof node !== 'object') continue;
      if (node['@graph']) queue.push(node['@graph']);
      var type = node['@type'];
      var typeStr = Array.isArray(type) ? type.join('/') : String(type || '');
      if (!typeStr) continue;
      if (!facts.kind) facts.kind = typeStr;
      if (node.name && !facts.name) facts.name = String(node.name).slice(0, 200);
      if (node.description && !facts.description) facts.description = String(node.description);
      if (node.brand && !facts.brand) facts.brand = String(node.brand.name || node.brand).slice(0, 100);
      var offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
      if (offers && !facts.price) {
        if (offers.price != null) facts.price = String(offers.price);
        if (offers.priceCurrency) facts.currency = String(offers.priceCurrency);
        if (offers.availability) facts.availability = String(offers.availability).replace(/^.*\\//, '');
      }
      if (node.aggregateRating && !facts.rating) {
        if (node.aggregateRating.ratingValue != null) facts.rating = String(node.aggregateRating.ratingValue);
        if (node.aggregateRating.reviewCount != null) facts.ratingCount = String(node.aggregateRating.reviewCount);
        else if (node.aggregateRating.ratingCount != null) facts.ratingCount = String(node.aggregateRating.ratingCount);
      }
      // Характеристики иногда всё же лежат здесь.
      if (Array.isArray(node.additionalProperty)) {
        for (var p = 0; p < node.additionalProperty.length; p++) {
          var pr = node.additionalProperty[p];
          if (pr && pr.name && pr.value != null) facts.specs.push({ k: String(pr.name), v: String(pr.value) });
        }
      }
    }
  } catch (e) { /* структурных данных нет — идём дальше */ }

  // 2. og-теги как запасной источник имени и описания.
  try {
    var ogт = document.querySelector('meta[property="og:title"]');
    var ogd = document.querySelector('meta[property="og:description"]');
    if (!facts.name && ogт && ogт.content) facts.name = String(ogт.content).slice(0, 200);
    if (!facts.description && ogd && ogd.content) facts.description = String(ogd.content);
  } catch (e) { /* нет og — не беда */ }

  // 3. Пары «ключ — значение»: <dl> и двухколоночные строки таблиц. Именно здесь у Ozon
  //    лежат характеристики, которых нет в JSON-LD.
  try {
    var dls = document.querySelectorAll('dl');
    for (var d = 0; d < dls.length; d++) {
      var dts = dls[d].querySelectorAll('dt');
      for (var t = 0; t < dts.length; t++) {
        var dd = dts[t].nextElementSibling;
        if (!dd || dd.tagName !== 'DD') continue;
        var k = __oblakoText(dts[t], ${MAX_KEY_CHARS});
        var v = __oblakoText(dd, ${MAX_VALUE_CHARS});
        if (k && v) facts.specs.push({ k: k, v: v });
      }
    }
    var rows = document.querySelectorAll('table tr');
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].children;
      if (cells.length !== 2) continue;
      var k2 = __oblakoText(cells[0], ${MAX_KEY_CHARS});
      var v2 = __oblakoText(cells[1], ${MAX_VALUE_CHARS});
      if (k2 && v2 && k2 !== v2) facts.specs.push({ k: k2, v: v2 });
    }
  } catch (e) { /* нет списков — специфик просто не будет */ }

  return facts;
}
`;

// Собирает карточку фактов. Пусто — значит фактов не нашлось, и текст остаётся как был.
export function composeFactsCard(facts: PageFacts): string {
  const lines: string[] = [];
  if (facts.name) lines.push(`Название: ${facts.name}`);
  if (facts.brand) lines.push(`Бренд: ${facts.brand}`);
  if (facts.price) lines.push(`Цена: ${facts.price}${facts.currency ? ` ${facts.currency}` : ''}`);
  if (facts.availability) lines.push(`Наличие: ${facts.availability}`);
  if (facts.rating) {
    lines.push(`Рейтинг: ${facts.rating}${facts.ratingCount ? ` (оценок: ${facts.ratingCount})` : ''}`);
  }

  // Дедуп: одна и та же характеристика часто лежит и в <dl>, и в таблице.
  const seen = new Set<string>();
  const specs: string[] = [];
  for (const { k, v } of facts.specs) {
    const key = k.replace(/[:\s]+$/, '').trim();
    const value = v.trim();
    if (!key || !value) continue;
    const dedup = `${key.toLowerCase()}=${value.toLowerCase()}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    specs.push(`- ${key}: ${value}`);
    if (specs.length >= MAX_SPECS) break;
  }
  if (specs.length) lines.push('Характеристики:', ...specs);

  if (facts.description) {
    const desc = facts.description.replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION_CHARS);
    if (desc) lines.push('', `Описание: ${desc}`);
  }

  return lines.join('\n');
}

// Есть ли что показывать. Одного имени мало — оно почти всегда есть из og и не добавляет
// ничего к заголовку страницы; карточку заводим только когда собрали что-то содержательное.
export function factsAreUseful(facts: PageFacts): boolean {
  return !!(facts.price || facts.rating || facts.specs.length >= 3
    || (facts.description && facts.description.length > 200));
}
