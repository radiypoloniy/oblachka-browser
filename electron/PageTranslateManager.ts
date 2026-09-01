// Полностраничный перевод: кнопка в тулбаре меняет текст ПРЯМО в DOM активной вкладки локальным
// Qwen (TranslationService.ts::translatePageBatch) — без поповера/панели, в отличие от
// TranslatePopoverManager.ts (перевод выделения по ПКМ) и AiPanelManager.ts::quick-translate
// (перевод текстом в чат AI-панели). Параллельная фича поверх ТОГО ЖЕ движка, обе другие не
// трогает и не переиспользует их код напрямую (кроме общих примитивов TranslationService.ts).
//
// Никакой отдельной WebContentsView/preload не заводится — вкладка уже обычная страница, работаем
// через её собственный WebContents.executeJavaScript (тот же приём, что TabManager.ts::
// SELECTION_RECT_SCRIPT / AiPanelManager.ts::buildExtractionScript). Скрипты ниже — намеренно
// ES5-стиль (var, без стрелочных функций) — тот же стиль, что у остальных инжектируемых скриптов
// в проекте, исполняются в контексте ПРОИЗВОЛЬНОГО чужого сайта.
import type { WebContents } from 'electron'
import type { TabState, PageTranslateState, PageTranslateProgress } from '../shared/ipc'
import type { TabManager } from './TabManager'
import { resolveDirection } from './TranslationService'
import { getActiveEngine, ensureActiveEngineWarm } from './TranslationEngineRegistry'
import type { TranslationResult } from './TranslationEngine'

let tabManagerRef: TabManager | null = null
export function setTabManager(tm: TabManager): void {
  tabManagerRef = tm
}

// Единственный подписчик (main.ts) — тот же приём, что aiKeyStore.onKeyStatusChanged/
// adblock.initialize(cb): main сам решает, куда слать (chromeView?.webContents.send(...)),
// этот модуль ничего не знает про chromeView.
let onStateChangedCb: ((state: PageTranslateState) => void) | null = null
export function onStateChanged(cb: (state: PageTranslateState) => void): void {
  onStateChangedCb = cb
}

// Тот же приём, что onStateChangedCb выше, но для прогресса внутри 'translating' (см.
// PageTranslateProgress в shared/ipc.ts) — отдельный колбэк, не переиспользует onStateChangedCb:
// прогресс меняется на порядок чаще состояния (троттлится в runTranslation, но всё равно чаще,
// чем idle/translating/translated), смешивать в один канал/тип незачем.
let onProgressChangedCb: ((progress: PageTranslateProgress | null) => void) | null = null
export function onProgressChanged(cb: (progress: PageTranslateProgress | null) => void): void {
  onProgressChangedCb = cb
}

// ── Состояние по вкладке ──────────────────────────────────────────────────────────────────────
const tabStates = new Map<string, PageTranslateState>()
// Монотонный счётчик НА ВКЛАДКУ (не общий на процесс!) — общий счётчик отменял бы фоновый перевод
// вкладки A только потому, что пользователь переключился на вкладку B и запустил перевод там.
// Переключение вкладок само по себе НЕ отменяет фоновый перевод — он доводится до конца в фоне,
// применяясь к DOM неактивной вкладки (Electron это позволяет), просто onStateChangedCb не зовётся,
// пока эта вкладка не активна (см. pushState). Отменяется только навигацией ЭТОЙ ЖЕ вкладки на
// новый документ (см. onTabsSynced) — старый window.__oblakoTr всё равно потерян вместе с ней.
const runSeqByTab = new Map<string, number>()
let activeTabId: string | null = null
let activeTabUrl = ''

function bumpSeq(tabId: string): number {
  const next = (runSeqByTab.get(tabId) ?? 0) + 1
  runSeqByTab.set(tabId, next)
  return next
}

function getState(id: string): PageTranslateState {
  return tabStates.get(id) ?? 'idle'
}

// Явный запрос состояния активной вкладки — на монтирование Toolbar.tsx (гонка старта: push из
// onStateChanged мог уйти ДО того, как renderer подписался), тот же приём, что getAdBlockState.
export function getActiveState(): PageTranslateState {
  return activeTabId ? getState(activeTabId) : 'idle'
}

function pushState(id: string, state: PageTranslateState): void {
  tabStates.set(id, state)
  if (id === activeTabId) onStateChangedCb?.(state)
}

// Прогресс — не хранится в tabStates (не переживает между запросами, незачем): только пуш активной
// вкладке, тот же гейт id===activeTabId, что у pushState.
function pushProgress(id: string, progress: PageTranslateProgress | null): void {
  if (id === activeTabId) onProgressChangedCb?.(progress)
}

// Единственная точка входа из main.ts — тот же onChange-хук, что уже вызывает
// AiPanelManager.onTabsSynced (см. main.ts). Снимок вкладок — источник правды по live-id/URL,
// отдельных колбэков в TabManager.ts не заводим.
export function onTabsSynced(tabsSnapshot: TabState[]): void {
  const liveIds = new Set(tabsSnapshot.map((t) => t.id))
  for (const id of tabStates.keys()) {
    if (!liveIds.has(id)) { tabStates.delete(id); runSeqByTab.delete(id) }
  }

  const active = tabsSnapshot.find((t) => t.isActive)
  if (!active) return

  const switched = active.id !== activeTabId
  const urlChanged = active.id === activeTabId && active.url !== activeTabUrl
  activeTabId = active.id
  activeTabUrl = active.url

  // Навигация активной вкладки на новый документ — старый JS-realm (и window.__oblakoTr вместе
  // с ним) пропал сам собой, состояние сбрасываем вслед за ним. bumpSeq отменяет ещё не
  // применённые батчи прежнего запуска — их apply-скрипт иначе попал бы в уже другой документ.
  if (urlChanged) {
    bumpSeq(active.id)
    tabStates.set(active.id, 'idle')
  }

  // Переключение на другую вкладку (или смена её URL) — если это активная вкладка, тулбар должен
  // немедленно увидеть её актуальное состояние, а не последнее состояние прежней активной вкладки.
  if (switched || urlChanged) onStateChangedCb?.(getState(active.id))
}

// ── Скрипты, исполняемые в контексте вкладки ─────────────────────────────────────────────────

// Потолок числа переводимых «корней» за один проход — защита от патологически больших страниц
// (бесконечный скролл, тысячи мелких элементов). Превышение просто логируется, не считается ошибкой.
const MAX_ROOTS = 400

// Обход DOM: минимальные «переводимые корни» — блочные элементы, чьи дети — только текст и
// разрешённый набор инлайновых тегов; контейнеры с блочными детьми пропускаются, спуск продолжается
// внутрь. Тот же принцип FILTER_ACCEPT/SKIP/REJECT, что в InPageTranslation.js Firefox Translations,
// упрощённый (без приоритетных тиров на этом шаге — приоритет вьюпорта считается отдельно по rect).
// Каждому корню — временный data-oblako-tr-id и сохранение исходного innerHTML в window.__oblakoTr
// (переживает между раундами executeJavaScript — тот же JS-realm страницы) для отката «оригинал».
// Инлайновые дети сериализуются в плейсхолдеры ⟪N⟫...⟪/N⟫ (⟪N⟫ без пары — void-теги br/img) —
// НЕ полный HTML с атрибутами: атрибуты через LLM гонять ненадёжно, она не обязана их дословно
// сохранить. Только ОДИН уровень вложенности — инлайн внутри инлайна схлопывается в plain-текст
// (осознанное упрощение, см. план: сложные вложенные форматирования теряют внутреннее различие,
// но структура DOM не ломается).
const WALK_SCRIPT = `(function(){
  // Сетка безопасности (см. runTranslation ниже, CRASH_CHECK_SCRIPT): buildApplyScript пересобирает
  // DOM-узлы, а фреймворки вроде React/Next.js держат СВОИ ссылки на них — на следующем же своём
  // обновлении фреймворк может упереться в рассинхрон и выбросить необработанное исключение,
  // которое его error boundary красит во весь экран ("Application error..."). Сами мы это
  // исключение поймать/предотвратить не можем (оно летит внутри чужого React), зато можем узнать
  // ПОСТФАКТУМ через window.onerror/unhandledrejection и откатить перевод. Флаг сбрасывается на
  // КАЖДЫЙ запуск (window.__oblakoTrCrashed = false ниже) — слушатель ставится один раз на JS-realm
  // (переживает между раундами executeJavaScript, как и window.__oblakoTr).
  window.__oblakoTrCrashed = false;
  if (!window.__oblakoTrErrorGuardInstalled) {
    window.__oblakoTrErrorGuardInstalled = true;
    window.addEventListener('error', function(){ window.__oblakoTrCrashed = true; }, true);
    window.addEventListener('unhandledrejection', function(){ window.__oblakoTrCrashed = true; });
  }
  var MAX_ROOTS = ${MAX_ROOTS};
  var INLINE_TAGS = {A:1,B:1,STRONG:1,I:1,EM:1,SPAN:1,CODE:1,SUP:1,SUB:1,U:1,MARK:1,SMALL:1,ABBR:1,CITE:1,Q:1,BR:1,IMG:1};
  var SKIP_TAGS = {SCRIPT:1,STYLE:1,NOSCRIPT:1,CODE:1,PRE:1,TEXTAREA:1,SVG:1};
  // Служебные зоны страницы (шапка/меню/футер/сайдбар) — не то, ради чего пользователь жмёт
  // «перевести страницу» (см. живой репорт: перевод обвешивал ВСЮ страницу, а не суть). Пропускаем
  // их безусловно, независимо от того, с какого корня начался walk() (см. findMainRoot ниже) —
  // даже внутри <article> может затесаться <nav> (оглавление) или <aside> (похожие статьи).
  var LANDMARK_TAGS = {NAV:1, HEADER:1, FOOTER:1, ASIDE:1};
  var LANDMARK_ROLES = {navigation:1, banner:1, contentinfo:1, complementary:1, search:1};
  var OPEN = '\\u27EA', CLOSE = '\\u27EB';

  window.__oblakoTr = {};
  var store = window.__oblakoTr;
  // Снимок ТЕКСТОВ корня, а не разметки. ⚠️ Нужен откату («показать оригинал»): innerHTML ниже
  // остаётся фолбэком, но восстанавливать им — значит пересоздать все узлы заново, а это ровно то,
  // от чего фреймворк падает (разбор — в buildApplyScript). По текстам откат ложится в те же самые
  // узлы, ничего не отцепляя.
  window.__oblakoTrPlan = {};
  var plan = window.__oblakoTrPlan;
  var nextId = 0;
  var units = [];
  var vw = window.innerWidth, vh = window.innerHeight;

  function isVisible(el) {
    if (el !== document.body && !el.offsetParent) return false;
    var cs = window.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function isInlineOnly(el) {
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      if (!INLINE_TAGS[kids[i].tagName]) return false;
    }
    return true;
  }

  function hasText(el) {
    return !!(el.textContent && el.textContent.trim().length > 0);
  }

  function serialize(el) {
    var parts = [];
    var childNodes = el.childNodes;
    var counter = 0;
    for (var i = 0; i < childNodes.length; i++) {
      var node = childNodes[i];
      if (node.nodeType === 3) {
        parts.push(node.nodeValue);
      } else if (node.nodeType === 1) {
        counter++;
        if (node.tagName === 'BR' || node.tagName === 'IMG') {
          parts.push(OPEN + counter + CLOSE);
        } else {
          parts.push(OPEN + counter + CLOSE + (node.textContent || '') + OPEN + '/' + counter + CLOSE);
        }
      }
    }
    return parts.join('');
  }

  function markRoot(el) {
    if (units.length >= MAX_ROOTS || !hasText(el)) return;
    nextId++;
    var id = nextId;
    el.setAttribute('data-oblako-tr-id', String(id));
    store[id] = el.innerHTML;
    // Промежутки между элементами и собственный текст каждого элемента — ровно то, что меняет
    // быстрый путь применения, и ровно то, что нужно вернуть.
    var pKids = el.childNodes, pGaps = [], pChild = [], pAcc = '';
    for (var p = 0; p < pKids.length; p++) {
      if (pKids[p].nodeType === 3) pAcc += pKids[p].nodeValue;
      else if (pKids[p].nodeType === 1) { pGaps.push(pAcc); pAcc = ''; pChild.push(pKids[p].textContent || ''); }
    }
    pGaps.push(pAcc);
    plan[id] = { gaps: pGaps, childTexts: pChild };
    var r = el.getBoundingClientRect();
    var visible = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    // Положение в КООРДИНАТАХ СТРАНИЦЫ (не вьюпорта): по нему юниты сортируются в порядке чтения,
    // а не в порядке разметки. Прокрутка во время обхода на эти числа не влияет.
    units.push({
      id: id, text: serialize(el), visible: visible,
      top: Math.round(r.top + window.scrollY), left: Math.round(r.left + window.scrollX),
    });
  }

  function walk(el) {
    if (units.length >= MAX_ROOTS || el.nodeType !== 1) return;
    var tag = el.tagName;
    if (SKIP_TAGS[tag]) return;
    if (LANDMARK_TAGS[tag] || LANDMARK_ROLES[el.getAttribute('role') || '']) return;
    if (el.hasAttribute('contenteditable')) return;
    if (el.getAttribute('translate') === 'no') return;
    if (!isVisible(el)) return;

    if (el.children.length === 0) { markRoot(el); return; }
    if (isInlineOnly(el)) { markRoot(el); return; }
    for (var i = 0; i < el.children.length; i++) walk(el.children[i]);
  }

  function textLen(el) {
    return (el.textContent || '').trim().length;
  }

  // Быстрый путь вместо полноценного Readability (как в AiPanelManager.ts::buildExtractionScript):
  // тому Readability нужен для ЧИСТОГО HTML статьи (markdown в чат), и он ради этого гоняется по
  // КЛОНУ документа — parse() перестраивает DOM. Нам клон не подходит: walk()/markRoot() держат
  // identity живых узлов (innerHTML в window.__oblakoTr, атрибут data-oblako-tr-id), которая на
  // клоне уже не та же самая нода, что на реальной странице. Семантических тегов достаточно на
  // подавляющем большинстве контентных сайтов (новости/блоги/документация/Wikipedia/GitHub) —
  // порог по длине текста страхует от пустых/декоративных <main> (SPA-обёртки без реальной
  // семантики). Не нашли уверенного кандидата — как раньше, весь document.body (веб-приложения,
  // дашборды и т.п., где понятия «главный контент» просто нет).
  // ⚠️ Берём САМОГО СОДЕРЖАТЕЛЬНОГО кандидата, а не первого в разметке. Раньше здесь стоял
  // querySelector, то есть «первый подходящий в порядке документа», — и на сайте, где блок
  // «читайте также» свёрстан карточками <article> выше основной статьи, корнем становился он.
  // Дальше всё шло как задумано и всё равно неправильно: переводились ссылки на другие материалы,
  // а сама статья оставалась за бортом. Живая жалоба 01.09.2026.
  function findMainRoot() {
    var cands = document.querySelectorAll('main, [role="main"], article');
    var best = null, bestLen = 200; // тот же порог: ниже него кандидат считается декоративным
    for (var c = 0; c < cands.length; c++) {
      var len = textLen(cands[c]);
      if (len > bestLen) { best = cands[c]; bestLen = len; }
    }
    return best || document.body;
  }

  var root = findMainRoot();
  if (root) walk(root);
  return { units: units, truncated: units.length >= MAX_ROOTS };
})()`

// Применение батча переводов: entries — [{id, text}] (text — перевод с плейсхолдерами ⟪N⟫, как их
// вернула модель). Для каждого корня переиспользует ЖИВЫЕ оригинальные дочерние элементы (не
// пересоздаёт их — сохраняются атрибуты/вложенные узлы/слушатели), только переставляет их на новые
// места и меняет текстовые узлы. Маркер, которому не нашлось валидной пары/оригинального ребёнка
// (модель напутала нумерацию) — деградирует до plain-текста на этом месте, не ломая остальной DOM.
function buildApplyScript(entries: Array<{ id: number; text: string }>): string {
  return `(function(){
    var DATA = ${JSON.stringify(entries)};
    var PAIR_RE = /\\u27EA(\\d+)\\u27EB([\\s\\S]*?)\\u27EA\\/\\1\\u27EB|\\u27EA(\\d+)\\u27EB/g;

    function applyOne(root, translated) {
      var origChildren = Array.prototype.slice.call(root.children);
      var used = {};
      var seq = [];
      var last = 0, m;
      PAIR_RE.lastIndex = 0;
      while ((m = PAIR_RE.exec(translated))) {
        if (m.index > last) seq.push({ t: 'text', v: translated.slice(last, m.index) });
        last = PAIR_RE.lastIndex;
        var n = m[1] !== undefined ? Number(m[1]) : Number(m[3]);
        var inner = m[2];
        var child = origChildren[n - 1];
        if (!child || used[n]) {
          if (inner !== undefined) seq.push({ t: 'text', v: inner });
          continue;
        }
        used[n] = true;
        if (inner !== undefined) child.textContent = inner;
        seq.push({ t: 'el', v: child });
      }
      if (last < translated.length) seq.push({ t: 'text', v: translated.slice(last) });

      // ⚠️ БЫСТРЫЙ ПУТЬ БЕЗ ПЕРЕСБОРКИ — ради чужих фреймворков, а не ради скорости.
      //
      // Живой случай (kod.ru, Next.js): «сначала переводит нормально, а потом Application error:
      // a client-side exception». Причина была ровно ниже: textContent = '' отцепляет ВСЕХ
      // детей разом, и пусть мы тут же возвращаем те же самые узлы обратно, React про эту
      // перестановку не знает: он держит свои ссылки и своё представление о том, где чей ребёнок.
      // На следующем СВОЁМ обновлении (наведение, переход, гидрация) он зовёт removeChild/
      // insertBefore на узле, который лежит уже не там, получает NotFoundError — и его error
      // boundary красит этим сообщением весь экран. Отсюда и «сначала норм»: падает не наш код и
      // не в момент перевода, а чужой и позже.
      //
      // Поэтому: если модель СОХРАНИЛА порядок и состав элементов (а это подавляющее большинство
      // случаев), структуру не трогаем вовсе — правим только значения текстовых узлов. Ноль
      // отцеплений, ноль вставок, React ничего не замечает.
      var sameOrder = true;
      var elCount = 0;
      for (var s = 0; s < seq.length; s++) {
        if (seq[s].t !== 'el') continue;
        if (seq[s].v !== origChildren[elCount]) { sameOrder = false; break; }
        elCount++;
      }
      if (sameOrder && elCount === origChildren.length) {
        // Текущие дети корня, разбитые на промежутки между элементами: [текст…] el [текст…] el …
        var gaps = [];
        var cur = [];
        var kids = Array.prototype.slice.call(root.childNodes);
        for (var g = 0; g < kids.length; g++) {
          if (kids[g].nodeType === 1) { gaps.push(cur); cur = []; }
          else if (kids[g].nodeType === 3) cur.push(kids[g]);
        }
        gaps.push(cur);
        // Желаемый текст для каждого промежутка — в том же порядке, что промежутки выше.
        var want = [];
        var acc = '';
        for (var w = 0; w < seq.length; w++) {
          if (seq[w].t === 'text') acc += seq[w].v;
          else { want.push(acc); acc = ''; }
        }
        want.push(acc);
        if (want.length === gaps.length) {
          for (var q = 0; q < gaps.length; q++) {
            var run = gaps[q];
            if (run.length > 0) {
              // ⚠️ nodeValue, а не замена узла: узел остаётся ТЕМ ЖЕ, и для фреймворка ничего не
              // произошло. Хвост прогона гасим пустой строкой — удалять нельзя по той же причине.
              run[0].nodeValue = want[q];
              for (var r = 1; r < run.length; r++) run[r].nodeValue = '';
            } else if (want[q] !== '') {
              // Текста в этом месте не было вовсе — вставляем. Единственная структурная правка
              // быстрого пути, и она ДОБАВЛЯЮЩАЯ: чужие узлы остаются на местах.
              var ins = document.createTextNode(want[q]);
              if (q < origChildren.length) root.insertBefore(ins, origChildren[q]);
              else root.appendChild(ins);
            }
          }
          return;
        }
      }

      // Медленный путь: модель переставила или потеряла маркеры — сохранить структуру нечем,
      // пересобираем. Риск для фреймворка здесь остаётся, и это осознанный размен: без пересборки
      // такой ответ пришлось бы выбрасывать целиком, оставляя абзац непереведённым.
      var frag = document.createDocumentFragment();
      for (var i = 0; i < seq.length; i++) {
        if (seq[i].t === 'text') frag.appendChild(document.createTextNode(seq[i].v));
        else frag.appendChild(seq[i].v);
      }
      root.textContent = '';
      root.appendChild(frag);
    }

    for (var k = 0; k < DATA.length; k++) {
      var root = document.querySelector('[data-oblako-tr-id="' + DATA[k].id + '"]');
      if (!root) continue;
      try {
        applyOne(root, DATA[k].text);
      } catch (e) {
        root.textContent = DATA[k].text.replace(/\\u27EA\\/?\\d+\\u27EB/g, '');
      }
    }
  })()`
}

// Откат к оригиналу — из window.__oblakoTr, без похода в main за исходным текстом. Безопасный
// no-op, если вкладка уже успела уйти на другой документ (window.__oblakoTr тогда не существует).
const RESTORE_SCRIPT = `(function(){
  var store = window.__oblakoTr || {};
  var plan = window.__oblakoTrPlan || {};

  // Вернуть тексты НА МЕСТО, ничего не отцепляя. Зеркало быстрого пути применения (см.
  // buildApplyScript): те же промежутки, те же узлы, только значения прежние.
  //
  // ⚠️ Живой случай (kod.ru, Next.js): перевод чинили, а «показать оригинал» продолжало ронять
  // сайт тем же Application error. Причина была здесь: innerHTML = … не возвращает узлы, а
  // СОЗДАЁТ новые вместо них. Для фреймворка это хуже перестановки — все его ссылки разом
  // становятся мусором, и падает он на первом же своём обновлении.
  function restoreInPlace(root, p) {
    var kids = Array.prototype.slice.call(root.childNodes);
    var els = [], gaps = [], cur = [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].nodeType === 1) { gaps.push(cur); cur = []; els.push(kids[i]); }
      else if (kids[i].nodeType === 3) cur.push(kids[i]);
    }
    gaps.push(cur);
    // Состав сошёлся — значит применение шло быстрым путём и структура цела.
    if (els.length !== p.childTexts.length || gaps.length !== p.gaps.length) return false;
    for (var e = 0; e < els.length; e++) els[e].textContent = p.childTexts[e];
    for (var g = 0; g < gaps.length; g++) {
      var run = gaps[g];
      if (run.length > 0) {
        run[0].nodeValue = p.gaps[g];
        for (var r = 1; r < run.length; r++) run[r].nodeValue = '';
      } else if (p.gaps[g] !== '') {
        var ins = document.createTextNode(p.gaps[g]);
        if (g < els.length) root.insertBefore(ins, els[g]); else root.appendChild(ins);
      }
    }
    return true;
  }

  var nodes = document.querySelectorAll('[data-oblako-tr-id]');
  for (var i = 0; i < nodes.length; i++) {
    var id = nodes[i].getAttribute('data-oblako-tr-id');
    var done = false;
    if (Object.prototype.hasOwnProperty.call(plan, id)) {
      try { done = restoreInPlace(nodes[i], plan[id]); } catch (e) { done = false; }
    }
    // ⚠️ Фолбэк на разметку остаётся: применение могло уйти медленным путём (модель переставила
    // маркеры) и пересобрать корень. Тогда текстами не отделаться — состав уже другой, и вернуть
    // страницу к исходному виду можно только разметкой, приняв её цену.
    if (!done && Object.prototype.hasOwnProperty.call(store, id)) nodes[i].innerHTML = store[id];
    nodes[i].removeAttribute('data-oblako-tr-id');
  }
  window.__oblakoTr = {};
  window.__oblakoTrPlan = {};
})()`

// Читает флаг, выставленный слушателем error/unhandledrejection в WALK_SCRIPT — см. комментарий
// там же. Простое выражение (не IIFE) — executeJavaScript возвращает значение выражения как есть;
// если __oblakoTrCrashed ещё не определён (WALK_SCRIPT почему-то не выполнялся) — undefined,
// сравнение с true даёт false, безопасный дефолт «не упало».
const CRASH_CHECK_SCRIPT = 'window.__oblakoTrCrashed === true'

// ── Батчинг и оркестрация перевода ───────────────────────────────────────────────────────────
interface WalkUnit { id: number; text: string; visible: boolean; top: number; left: number }
interface WalkResult { units: WalkUnit[]; truncated: boolean }

// Перевод многих мелких юнитов ПО ОДНОМУ — неприемлемо медленно (оверхед сессии/prefill на вызов,
// см. [perf] segment в TranslationService.ts): реальная страница легко даёт полсотни-сотню юнитов.
// Группируем по MAX_UNITS_PER_BATCH/MAX_CHARS_PER_BATCH, что раньше сработает. Это батчи для
// НЕвидимой (за кадром/ниже сгиба) части — там важен throughput, не задержка: пользователь их не
// видит, пока не проскроллит, так что крупный батч (меньше накладных на сессию/prefill) не ощущается
// как зависание.
const MAX_UNITS_PER_BATCH = 12
const MAX_CHARS_PER_BATCH = 3000
// Видимая (в вьюпорте на момент старта) часть — units уже отсортированы visible-first (см.
// runTranslation) — батчится МЕЛЬЧЕ, и не только первая порция, а ВСЯ видимая часть целиком (была
// одна ошибка здесь: мельче делался только самый первый батч, а второй-третий видимый батч уже
// снова прыгал на MAX_UNITS_PER_BATCH — на длинной видимой области перевод одним махом выдавал
// сразу несколько экранов текста, и молчание модели на время генерации ЭТОГО одного гигантского
// батча ощущалось как зависание, хотя суммарная скорость была та же). Каждый видимый батч — заведомо
// меньше одного экрана, так что перевод виден заметными частыми приращениями, а не одним редким
// скачком. Юниты, ниже сгиба, идут по MAX_UNITS_PER_BATCH — граница между видимой и невидимой
// частью всегда становится границей батча (см. chunkUnits), они не смешиваются в одном вызове.
const VISIBLE_BATCH_MAX_UNITS = 4
const VISIBLE_BATCH_MAX_CHARS = 900
// Сколько первых юнитов достаточно для определения языка страницы — не гонять resolveDirection
// по всему тексту, короткого образца хватает (тот же приём, что quick-translate в AiPanelManager).
const SAMPLE_UNITS_FOR_DETECT = 5

function chunkUnits(units: WalkUnit[]): WalkUnit[][] {
  const batches: WalkUnit[][] = []
  let current: WalkUnit[] = []
  let currentChars = 0
  let currentVisible: boolean | null = null
  for (const u of units) {
    const maxUnits = u.visible ? VISIBLE_BATCH_MAX_UNITS : MAX_UNITS_PER_BATCH
    const maxChars = u.visible ? VISIBLE_BATCH_MAX_CHARS : MAX_CHARS_PER_BATCH
    // Граница видимо/невидимо всегда рвёт батч — иначе последний видимый юнит мог бы утянуть за
    // собой начало невидимого хвоста в тот же вызов (или наоборот), смазывая гарантию «видимый
    // батч всегда маленький».
    const crossesVisibilityBoundary = currentVisible !== null && currentVisible !== u.visible
    if (current.length > 0 && (crossesVisibilityBoundary || current.length >= maxUnits || currentChars + u.text.length > maxChars)) {
      batches.push(current)
      current = []
      currentChars = 0
    }
    current.push(u)
    currentChars += u.text.length
    currentVisible = u.visible
  }
  if (current.length > 0) batches.push(current)
  return batches
}

// Троттлинг push прогресса — токен-стриминг внутри батча зовёт колбэк на КАЖДЫЙ токен (десятки раз
// в секунду), пуш каждого в renderer по IPC — шум без пользы (глазом всё равно не различить). То же
// значение, что достаточно для «живого» ощущения в чат-стриминге Hub.
const PROGRESS_THROTTLE_MS = 150

// Возвращает true, если на странице вообще нашлось что переводить (для итогового
// 'translated'/'idle' — см. togglePageTranslate). Батчи применяются ПО МЕРЕ готовности —
// прогрессивная отрисовка, видимая часть страницы обновляется первой (units уже отсортированы
// visible-first ниже), пока фон ещё переводится.
async function runTranslation(wc: WebContents, tabId: string, mySeq: number): Promise<boolean> {
  const walkResult = (await wc.executeJavaScript(WALK_SCRIPT, true)) as WalkResult | null
  if (!walkResult || walkResult.units.length === 0) return false
  if (walkResult.truncated) {
    console.warn(`[page-translate] превышен потолок в ${MAX_ROOTS} корней — переведена только часть страницы`)
  }

  // ⚠️ Внутри каждой группы — ПОРЯДОК ЧТЕНИЯ (сверху вниз, слева направо), а не порядок разметки.
  // Живая жалоба 01.09.2026: «сначала заголовок, потом элементы сайта, потом ссылки на другие
  // источники и лишь потом основной текст». Это и был порядок разметки: шапка, меню и боковые
  // блоки лежат в HTML раньше статьи, даже когда на экране они сбоку или ниже. Человек же смотрит
  // не в разметку, а на страницу, и ждёт перевода того, на что смотрит.
  //
  // ⚠️ Сортировка СТАБИЛЬНАЯ и с добивкой по id: у элементов одной строки top совпадает, и без
  // третьего ключа порядок между ними зависел бы от реализации сортировки.
  const byReading = (a: WalkUnit, b: WalkUnit): number =>
    (a.top - b.top) || (a.left - b.left) || (a.id - b.id)
  const visible = walkResult.units.filter((u) => u.visible).sort(byReading)
  const rest = walkResult.units.filter((u) => !u.visible).sort(byReading)
  const ordered = [...visible, ...rest]

  const sample = ordered.slice(0, SAMPLE_UNITS_FOR_DETECT).map((u) => u.text).join(' ')
  const { src, tgt } = await resolveDirection('auto', sample)

  const batches = chunkUnits(ordered)

  const charsByBatch = new Array<number>(batches.length).fill(0)
  let completedBatches = 0
  let lastProgressPushAt = 0
  const pushProgressThrottled = (force?: boolean) => {
    const now = Date.now()
    if (!force && now - lastProgressPushAt < PROGRESS_THROTTLE_MS) return
    lastProgressPushAt = now
    const charsStreamed = charsByBatch.reduce((a, b) => a + b, 0)
    pushProgress(tabId, { batchIndex: completedBatches, batchCount: batches.length, charsStreamed })
  }

  let crashedFlag = false
  const isCancelled = () => mySeq !== runSeqByTab.get(tabId) || crashedFlag

  async function applyAndCheckCrash(entries: Array<{ id: number; text: string }>): Promise<boolean> {
    if (wc.isDestroyed()) return false
    await wc.executeJavaScript(buildApplyScript(entries), true).catch((e) => {
      console.error('[page-translate] apply упал:', e)
    })

    // Сетка безопасности: страницы на React/Next.js и подобных фреймворках держат СВОИ ссылки на
    // DOM-узлы, которые buildApplyScript пересобирает (см. живой репорт — "Application error: a
    // client-side exception has occurred", это штатный экран краша React, не текст от модели).
    // Первопричину не лечим — нельзя: границы текста после перевода моделью уже не совпадают с
    // оригинальными, сохранить identity исходных text-нод при этом физически невозможно. Вместо
    // этого проверяем постфактум (см. CRASH_CHECK_SCRIPT/WALK_SCRIPT) — если фреймворк упал сразу
    // после применения батча, откатываем страницу к оригиналу и останавливаем перевод, вместо того
    // чтобы оставить пользователя с намертво сломанным сайтом.
    if (wc.isDestroyed()) return false
    const crashed = await wc.executeJavaScript(CRASH_CHECK_SCRIPT, true).catch(() => false)
    if (crashed) {
      console.error('[page-translate] страница выбросила необработанное исключение после применения батча — откатываю к оригиналу, перевод остановлен')
      crashedFlag = true
      await restoreOriginal(wc)
      return false
    }
    return true
  }

  // Движок — через registry (getActiveEngine), не импортируется напрямую (см. TranslationEngine.ts/
  // TranslationEngineRegistry.ts) — DOM-слой не знает и не должен знать, Qwen сейчас активен или
  // другой движок. src/tgt передаются в getActiveEngine — если у активного движка нет модели именно
  // под эту пару (см. живой баг: Bergamot выбирается, даже когда поддерживает только en-ru, а
  // страница на французском), registry сам откатится на другой готовый движок, а не завалит каждый
  // юнит молча. null — ни один зарегистрированный движок не готов (например, ни Qwen без GGUF-файла,
  // ни Bergamot без моделей на диске) — тот же путь ошибки, что и у остальных сбоев runTranslation:
  // исключение ловит togglePageTranslate() ниже (см. её try/catch) и переводит вкладку в 'idle'.
  // Конвейеризация: генерация батча i+1 встаёт в очередь движка сразу после готовности батча i, не
  // дожидаясь apply (executeJavaScript в вкладку — отдельный IPC-круговорот, во время которого
  // движок иначе простаивал бы). Сериализация вызовов — забота самого движка (withQwenQueue в
  // TranslationService.ts для Qwen).
  // ⚠️ Момент, когда Bergamot поднимает свой воркер: человек нажал «перевести страницу». На старте
  // он больше не греется — см. разбор у ensureActiveEngineWarm и showWhenReady.ts.
  await ensureActiveEngineWarm(src, tgt)
  const engine = getActiveEngine(src, tgt)
  if (!engine) {
    throw new Error('Перевод недоступен: нет готового движка')
  }
  const startBatch = (i: number) =>
    engine.translateBatch(
      batches[i]!.map((u) => ({ id: u.id, text: u.text })),
      src, tgt,
      undefined, // signal — отмена уже покрыта isCancelled()/bumpSeq на уровне оркестрации ниже
      (charsSoFar) => {
        charsByBatch[i] = charsSoFar
        pushProgressThrottled()
      },
    )
  let nextTranslate: Promise<TranslationResult[]> | null = batches.length > 0 ? startBatch(0) : null

  for (let i = 0; i < batches.length; i++) {
    if (isCancelled()) break
    const current = nextTranslate!
    nextTranslate = i + 1 < batches.length ? startBatch(i + 1) : null
    if (isCancelled()) break

    let result: TranslationResult[]
    try {
      result = await current
    } catch (e) {
      console.error(`[page-translate] батч упал: ${e}`)
      completedBatches++
      pushProgressThrottled(true)
      continue
    }

    if (result.length === 0) {
      completedBatches++
      pushProgressThrottled(true)
      continue
    }

    if (!(await applyAndCheckCrash(result))) break
    completedBatches++
    pushProgressThrottled(true) // граница батча — всегда видна, не только раз в PROGRESS_THROTTLE_MS
  }

  if (mySeq !== runSeqByTab.get(tabId)) { pushProgress(tabId, null); return true } // отменено (навигация/повторный клик/переключение и новый запуск этой же вкладки)
  pushProgress(tabId, null)
  return !crashedFlag
}

async function restoreOriginal(wc: WebContents): Promise<void> {
  if (wc.isDestroyed()) return
  await wc.executeJavaScript(RESTORE_SCRIPT, true).catch((e) => {
    console.error('[page-translate] restore упал:', e)
  })
}

// Единственная точка входа из main.ts (см. IPC.PAGE_TRANSLATE_TOGGLE) — тоггл для активной вкладки.
export async function togglePageTranslate(): Promise<void> {
  const tabId = activeTabId
  if (!tabId) return
  const wc = tabManagerRef?.getActiveWebContents() ?? null
  if (!wc || wc.isDestroyed()) return

  const state = getState(tabId)
  if (state === 'translating') return // уже идёт — кнопка в тулбаре и так должна быть неактивна

  if (state === 'translated') {
    bumpSeq(tabId)
    await restoreOriginal(wc)
    pushState(tabId, 'idle')
    return
  }

  await startTranslation(wc, tabId)
}

/** Общее тело запуска: им пользуются и кнопка в тулбаре, и правило-автоматизация. */
async function startTranslation(wc: WebContents, tabId: string): Promise<void> {
  const mySeq = bumpSeq(tabId)
  pushState(tabId, 'translating')
  try {
    const translated = await runTranslation(wc, tabId, mySeq)
    if (mySeq === runSeqByTab.get(tabId)) pushState(tabId, translated ? 'translated' : 'idle')
  } catch (e) {
    console.error('[page-translate] упало:', e)
    if (mySeq === runSeqByTab.get(tabId)) pushState(tabId, 'idle')
  }
}

/**
 * Перевести КОНКРЕТНУЮ вкладку — вход для правил-автоматизаций (действие «переводить страницу»).
 *
 * ⚠️ Не togglePageTranslate: тот работает с АКТИВНОЙ вкладкой и переключает состояние. Правило
 * срабатывает на навигации, которая может случиться в фоновой вкладке, и «переключить» для него
 * означало бы снять уже сделанный перевод. Здесь только запуск и только из состояния 'idle'.
 */
export function translateTabByRule(tabId: string): void {
  const wc = tabManagerRef?.getWebContentsForTab(tabId) ?? null
  if (!wc || wc.isDestroyed()) return
  if (getState(tabId) !== 'idle') return
  void startTranslation(wc, tabId)
}

// Регистрация IPC (ipcMain.on(IPC.PAGE_TRANSLATE_TOGGLE, () => void togglePageTranslate())) — в
// main.ts::registerIpc(), не здесь: это часть общего контракта shared/ipc.ts, регистрируется
// централизованно, тем же приёмом, что IPC.AI_PANEL_TOGGLE (в отличие от ad-hoc внутренних каналов
// AiPanelManager/TranslatePopoverManager, которых нет в shared/ipc.ts и которые саморегистрируются).
