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
import type { TabState, PageTranslateState } from '../shared/ipc'
import type { TabManager } from './TabManager'
import { translatePageBatch, resolveDirection } from './TranslationService'

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
  var MAX_ROOTS = ${MAX_ROOTS};
  var INLINE_TAGS = {A:1,B:1,STRONG:1,I:1,EM:1,SPAN:1,CODE:1,SUP:1,SUB:1,U:1,MARK:1,SMALL:1,ABBR:1,CITE:1,Q:1,BR:1,IMG:1};
  var SKIP_TAGS = {SCRIPT:1,STYLE:1,NOSCRIPT:1,CODE:1,PRE:1,TEXTAREA:1,SVG:1};
  var OPEN = '\\u27EA', CLOSE = '\\u27EB';

  window.__oblakoTr = {};
  var store = window.__oblakoTr;
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
    var r = el.getBoundingClientRect();
    var visible = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    units.push({ id: id, text: serialize(el), visible: visible });
  }

  function walk(el) {
    if (units.length >= MAX_ROOTS || el.nodeType !== 1) return;
    var tag = el.tagName;
    if (SKIP_TAGS[tag]) return;
    if (el.hasAttribute('contenteditable')) return;
    if (el.getAttribute('translate') === 'no') return;
    if (!isVisible(el)) return;

    if (el.children.length === 0) { markRoot(el); return; }
    if (isInlineOnly(el)) { markRoot(el); return; }
    for (var i = 0; i < el.children.length; i++) walk(el.children[i]);
  }

  if (document.body) walk(document.body);
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
  var els = document.querySelectorAll('[data-oblako-tr-id]');
  for (var i = 0; i < els.length; i++) {
    var id = els[i].getAttribute('data-oblako-tr-id');
    if (Object.prototype.hasOwnProperty.call(store, id)) els[i].innerHTML = store[id];
    els[i].removeAttribute('data-oblako-tr-id');
  }
  window.__oblakoTr = {};
})()`

// ── Батчинг и оркестрация перевода ───────────────────────────────────────────────────────────
interface WalkUnit { id: number; text: string; visible: boolean }
interface WalkResult { units: WalkUnit[]; truncated: boolean }

// Перевод многих мелких юнитов ПО ОДНОМУ — неприемлемо медленно (оверхед сессии/prefill на вызов,
// см. [perf] segment в TranslationService.ts): реальная страница легко даёт полсотни-сотню юнитов.
// Группируем по MAX_UNITS_PER_BATCH/MAX_CHARS_PER_BATCH, что раньше сработает.
const MAX_UNITS_PER_BATCH = 12
const MAX_CHARS_PER_BATCH = 3000
// Сколько первых юнитов достаточно для определения языка страницы — не гонять resolveDirection
// по всему тексту, короткого образца хватает (тот же приём, что quick-translate в AiPanelManager).
const SAMPLE_UNITS_FOR_DETECT = 5

function chunkUnits(units: WalkUnit[]): WalkUnit[][] {
  const batches: WalkUnit[][] = []
  let current: WalkUnit[] = []
  let currentChars = 0
  for (const u of units) {
    if (current.length > 0 && (current.length >= MAX_UNITS_PER_BATCH || currentChars + u.text.length > MAX_CHARS_PER_BATCH)) {
      batches.push(current)
      current = []
      currentChars = 0
    }
    current.push(u)
    currentChars += u.text.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

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

  const visible = walkResult.units.filter((u) => u.visible)
  const rest = walkResult.units.filter((u) => !u.visible)
  const ordered = [...visible, ...rest]

  const sample = ordered.slice(0, SAMPLE_UNITS_FOR_DETECT).map((u) => u.text).join(' ')
  const { src, tgt } = await resolveDirection('auto', sample)

  for (const batch of chunkUnits(ordered)) {
    if (mySeq !== runSeqByTab.get(tabId)) return true // отменено (навигация/повторный клик/переключение и новый запуск этой же вкладки)

    const result = await translatePageBatch(batch.map((u) => ({ id: u.id, text: u.text })), src, tgt)
    if (mySeq !== runSeqByTab.get(tabId)) return true

    if (!result.ok) {
      console.error(`[page-translate] батч упал: ${result.error}`)
      continue
    }
    if (result.translations.size === 0) continue

    if (wc.isDestroyed()) return true
    const entries = [...result.translations.entries()].map(([id, text]) => ({ id, text }))
    await wc.executeJavaScript(buildApplyScript(entries), true).catch((e) => {
      console.error('[page-translate] apply упал:', e)
    })
  }
  return true
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

// Регистрация IPC (ipcMain.on(IPC.PAGE_TRANSLATE_TOGGLE, () => void togglePageTranslate())) — в
// main.ts::registerIpc(), не здесь: это часть общего контракта shared/ipc.ts, регистрируется
// централизованно, тем же приёмом, что IPC.AI_PANEL_TOGGLE (в отличие от ad-hoc внутренних каналов
// AiPanelManager/TranslatePopoverManager, которых нет в shared/ipc.ts и которые саморегистрируются).
