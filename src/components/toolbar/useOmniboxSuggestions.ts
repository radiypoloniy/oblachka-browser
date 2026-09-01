import { useCallback, useRef } from 'react';
import type { HistoryEntry, SmartTabHit, SuggestDropdownItem, TabState } from '../../../shared/ipc';
import { normalizeForOmnibox, scoreEntry } from '../../../shared/frecency';
import { composeSuggestions, looksLikeAddress } from '../../../shared/suggestList';
import { getSearchEngine, isSearchResultUrl } from '../../../shared/searchEngines';
import type { SearchEngineId } from '../../../shared/searchEngines';

// -- Подсказки по набранному тексту --------------------------------------------
//
// Сборка списка под адресной строкой: история, открытые вкладки, живые подсказки поисковика,
// разделы настроек, поиск вкладки по смыслу. Плюс дебаунс, который решает, что показать сразу,
// а что догоняет.
//
// !! Второй шов, вырезанный из Toolbar.tsx (первым была панель нетронутой строки, см.
// useOmniboxPanel). Форма та же: наружу -- одна функция, внутрь -- набор значений. Владение
// списком и выбором остаётся в тулбаре, хук только собирает содержимое.
//
// !! Счётчик поколений (seqRef) приходит СНАРУЖИ и общий с панелью. Здесь он несёт больше, чем
// там: каждый await ниже обязан проверить, не устарел ли его ответ, -- иначе медленная сеть
// затирает список, набранный после неё. Гвардов таких три, и все три обязательны.

// Дебаунс запроса к сети (мс).
// !! ДЕБАУНС ТОЛЬКО ДЛЯ СЕТИ. Раньше он стоял на ВСЁМ, включая локальную историю, и это была
// главная причина, по которой дропдаун ощущался медленнее чужих: человек нажимал букву, и
// РОВНО НИЧЕГО не происходило 150 мс, хотя ответ уже был готов.
// Замер (scripts/tmp-hbench, 40 000 записей, тот же движок SQLite): поиск по истории --
// 0,8-2,5 мс на совпадающем запросе и 14,5 мс в худшем случае (полный скан без совпадений).
// Ждать 150 мс ради ответа за 2 мс незачем; ждать имеет смысл только там, где цена вопроса
// секунды -- у живых подсказок поисковика (таймаут 3 с, см. SearchSuggestFetcher.ts).
const SUGGEST_DEBOUNCE = 150;
// Максимум строк в дропдауне.
const SUGGEST_MAX = 8;

type SuggestKind = SuggestDropdownItem['kind'];
type SuggestItem = SuggestDropdownItem;

export interface OmniboxSuggestionsDeps {
  /** Открытые вкладки: по ним ищется «перейти на уже открытую», а не завести вторую копию. */
  allTabs: TabState[];
  /** Выбранный поисковик -- для строки «Искать: …» и имени движка в списке. */
  searchEngineId: SearchEngineId;
  /** Общий с панелью счётчик поколений запроса -- см. разбор в шапке. */
  seqRef: React.MutableRefObject<number>;
  openDropdown: () => void;
  closeDropdown: (reason: string) => void;
  setSuggestions: (items: SuggestItem[]) => void;
  setSelectedIdx: (i: number) => void;
}

/**
 * Ранжирование истории и открытых вкладок под набранный запрос.
 *
 * ⚠️ Вынесено из хука отдельной функцией модуля, и порог храповика тут совпал с пользой: это
 * чистая арифметика над двумя списками, самое сложное место омнибокса, — держать её внутри
 * четырёхсотстрочного колбэка значило бы прятать её там, где никто не прочитает.
 *
 * Отдаёт готовые подсказки из истории и вкладок. Строка «Искать: …», живые подсказки поисковика
 * и разделы настроек приклеиваются снаружи — composeSuggestions в shared/suggestList.ts.
 */
function rankHistoryAndTabs(
  histEntries: HistoryEntry[], allTabs: TabState[], q: string, now: number,
): SuggestItem[] {
  // Открытые вкладки — по нормализованному URL (не substring по url/title). Точный матч:
  // подсказка помечается kind='tab' только если её URL совпадает с URL реально открытой
  // вкладки — раньше widely-substring-матч по allTabs ловил произвольные вкладки (в т.ч.
  // поисковые result-страницы), из-за чего они подписывались «вкладка» независимо от
  // релевантности запросу.
  const tabIdByUrl = new Map<string, string>();
  for (const t of allTabs) {
    if (!t.isHub) tabIdByUrl.set(normalizeForOmnibox(t.url), t.id);
  }

  // Дедуп по нормализованному URL — одна запись на СТРАНИЦУ (не на домен, как раньше через
  // normalizeForTiles/origin). utm-параметры/якорь/завершающий слэш схлопываются в один ключ
  // (см. normalizeForOmnibox) — это убирает 5-6 «копий» одной и той же страницы, которые
  // history.sqlite хранит отдельными строками (там UNIQUE по точному URL, см. HistoryManager.ts).
  // Разные СТРАНИЦЫ одного домена (не дубли) по-прежнему остаются разными записями — их
  // взаимный порядок решает ранжирование ниже (homepage поднимается при прочих равных).
  // Страницы результатов поиска — мимо: в базе лежит наследие, см. isSearchResultUrl.
  const byUrl = new Map<string, HistoryEntry>();
  for (const e of histEntries) {
    if (isSearchResultUrl(e.url)) continue;
    const key = normalizeForOmnibox(e.url);
    const cur = byUrl.get(key);
    if (!cur || scoreEntry(e, now) > scoreEntry(cur, now)) byUrl.set(key, e);
  }

  // Матч «на границе слова» — то же, что делают HistoryQuickProvider в Chromium и
  // location-bar в Firefox (bugzilla #393678/#429531): вхождение ПОСРЕДИ слова (например «ko»
  // внутри «drugih» в транслитерированном пути) почти всегда СЛУЧАЙНО совпадает с запросом и
  // не значит ничего для пользователя — особенно на коротких (2-3 симв.) запросах против
  // транслитерированных кириллических путей. Вхождение В НАЧАЛЕ слова (kod.ru, /kotipizza) —
  // обычно и есть то, что имел в виду пользователь. Оба браузера показывают «где угодно»-
  // совпадения ТОЛЬКО как самый нижний фоллбэк — см. ту же идею ниже в calcMatchScore (tier 1).
  function matchesAtWordBoundary(haystack: string, needle: string): boolean {
    let idx = haystack.indexOf(needle);
    while (idx !== -1) {
      const prev = idx === 0 ? '' : haystack[idx - 1]!;
      if (!/[a-z0-9а-яё]/i.test(prev)) return true;
      idx = haystack.indexOf(needle, idx + 1);
    }
    return false;
  }

  // Живой тест на «ko» показал: граница слова САМА ПО СЕБЕ не спасает от мусора — URL-слаги
  // русскоязычных сайтов это транслитерация кириллицы (rossiyskih-KOmand, KOtoryh, KOgda...),
  // и короткий запрос — это ровно начало кучи бытовых русских слов-транслитераций, так что
  // «в начале слова» массово совпадает, просто не показывая, что для пользователя оно значит.
  // Домен/заголовок — курируемый текст (реальное имя сайта/статьи), а путь — машинный SEO-слаг,
  // поэтому именно путь режем по длине запроса: короче порога — в пути вообще не ищем, отдаём
  // площадь только домену/заголовку (которые остаются достаточно избирательны и на 2-3 символах).
  const MIN_PATH_MATCH_LEN = 4;
  // Верхний тир calcMatchScore — «запрос выглядит как имя домена целиком». Вынесен в константу,
  // т.к. используется ещё раз ниже (см. синтез домашней страницы у byHost) — держать оба места
  // в синхроне важнее, чем инлайнить магическое число дважды.
  const HOSTNAME_PREFIX_TIER = 6;

  // Match-score: тип совпадения — главный сортировщик, frecency — вторичный.
  // query/hash-параметры намеренно исключены: они источник ложных хитов
  // (e.g. «the» в ?q=... подтягивает нерелевантные страницы).
  function calcMatchScore(e: HistoryEntry): number {
    let hostname = '';
    let pathname = '';
    try {
      const u = new URL(e.url);
      hostname = u.hostname.replace(/^www\./, '').toLowerCase();
      pathname = u.pathname.toLowerCase();
    } catch { /* невалидный URL */ }
    const title = e.title.toLowerCase();
    const pathLongEnough = q.length >= MIN_PATH_MATCH_LEN;
    if (hostname.startsWith(q))              return HOSTNAME_PREFIX_TIER; // префикс домена → максимум
    if (title.startsWith(q))                 return 5; // префикс заголовка
    if (matchesAtWordBoundary(hostname, q) || matchesAtWordBoundary(title, q)) return 4; // слово в домене/заголовке
    if (pathLongEnough && matchesAtWordBoundary(pathname, q)) return 3; // слово в пути
    // Живой фидбэк («пусть меньше, но качественнее»): раньше здесь был ещё фоллбэк —
    // вхождение ГДЕ УГОДНО (в т.ч. посреди слова, без границы). Он и давал мусор вроде страниц
    // логина/авторизации и случайных фото из истории — их заголовки/hostname часто СОДЕРЖАТ
    // запрос как случайную подстроку (например «the» внутри «auTHEntication»), не имея к нему
    // никакого смыслового отношения. Без него страница либо совпадает по-настоящему (домен/
    // заголовок/путь на границе слова), либо не показывается вообще — короче список, но каждая
    // строка в нём объяснима.
    return 0; // вообще ничего не совпало — отфильтровываем
  }

  // Итоговый скор: ×10000 за тип совпадения даёт ему абсолютный приоритет над частотой.
  const MATCH_TIER = 10_000;
  // При прочих равных (тот же match-tier, тот же домен) — главная страница домена выше
  // вглубь-страниц того же домена, как в Chrome (example.com над example.com/article/123).
  // Множитель на freq, не плоская добавка — масштабируется вместе с реальной частотой визитов,
  // а не перевешивает её произвольной константой.
  const HOMEPAGE_BOOST = 1.5;
  function isHomepage(url: string): boolean {
    try { return new URL(url).pathname === '/'; } catch { return false; }
  }
  function hostnameOf(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return url; }
  }

  // Единый ранжированный список — history и «вкладка» больше не строятся отдельно
  // (tabItems раньше шли ПЕРВЫМИ безусловно, до среза по SUGGEST_MAX, вытесняя
  // отранжированные по frecency записи истории независимо от их релевантности).
  const candidates = [...byUrl.entries()]
    .map(([key, e]) => ({
      e,
      match: calcMatchScore(e),
      freq: scoreEntry(e, now) * (isHomepage(e.url) ? HOMEPAGE_BOOST : 1),
      tabId: tabIdByUrl.get(key),
    }))
    .filter(({ match }) => match > 0);

  // Представитель домена (MAX_PER_HOSTNAME=1) — НЕ «первый после сортировки по скору»: живой
  // баг показал, что недавняя (сегодняшняя) статья почти всегда обгоняет главную страницу по
  // frecency (вес свежести ×4 против HOMEPAGE_BOOST ×1.5 — буст просто не отбивает разницу
  // бакетов), поэтому кап раньше исправно резал дубли, но оставлял вместо чистой guardian.com
  // случайную длинную статью. Матч по префиксу домена (tier 6, calcMatchScore) означает «это
  // про сайт целиком» — поэтому здесь представитель домена явно предпочитает главную страницу,
  // если она вообще есть среди совпавших кандидатов, и только при её отсутствии откатывается
  // на лучший по скору.
  const byHost = new Map<string, typeof candidates[number]>();
  for (const c of candidates) {
    const host = hostnameOf(c.e.url);
    const existing = byHost.get(host);
    if (!existing) { byHost.set(host, c); continue; }
    const cHome = isHomepage(c.e.url);
    const existingHome = isHomepage(existing.e.url);
    if (cHome && !existingHome) { byHost.set(host, c); continue; }
    if (!cHome && existingHome) continue;
    const cScore = c.match * MATCH_TIER + c.freq;
    const existingScore = existing.match * MATCH_TIER + existing.freq;
    if (cScore > existingScore) byHost.set(host, c);
  }

  // Живой тест на «the»: у Guardian реальная главная НИ РАЗУ не посещалась (только статьи) —
  // отбор выше честно откатывается на лучшую статью, но это по-прежнему случайная длинная
  // ссылка вместо чистого сайта. Матч tier 6 (calcMatchScore) означает «запрос похож на ИМЯ
  // САЙТА целиком», а не на конкретную статью — раз хомпейджа нет в истории, достраиваем его
  // адрес сами (тот же приём, что HistoryURLProvider в Chromium: инференс канонической ссылки
  // на сайт из одной только уверенности в домене, без обязательного точного визита на root).
  // Открытые вкладки (tabId) не трогаем — там клик всё равно ведёт по tabId, а не по url, но
  // подмена урла/тайтла исказила бы то, что реально показано во вкладке.
  for (const [host, c] of byHost) {
    if (c.tabId || c.match !== HOSTNAME_PREFIX_TIER || isHomepage(c.e.url)) continue;
    let root: string;
    try { root = `${new URL(c.e.url).protocol}//${host}/`; } catch { continue; }
    byHost.set(host, { ...c, e: { ...c.e, url: root, title: '' } });
  }

  const items: SuggestItem[] = [...byHost.values()]
    .sort((a, b) => (b.match * MATCH_TIER + b.freq) - (a.match * MATCH_TIER + a.freq))
    .slice(0, SUGGEST_MAX - 1)
    .map(({ e, tabId }) => (
      tabId
        ? { kind: 'tab' as SuggestKind, label: e.url, sub: e.title, url: e.url, tabId }
        : { kind: 'history' as SuggestKind, label: e.url, sub: e.title, url: e.url }
    ));

  // ⚠️ ОТКРЫТАЯ ВКЛАДКА НЕ ЗАНИМАЕТ ПЕРВУЮ СТРОКУ, пока есть любой другой кандидат.
  //
  // Ранжирование считает вкладки наравне с историей, и это правильно, но у открытой страницы
  // почти всегда лучшая частота — её же только что смотрели. В итоге стоило начать набирать
  // адрес похожей страницы, как первой строкой вставало «перейти на вкладку». А человек,
  // набирающий адрес РУКАМИ, чаще всего хочет открыть страницу, а не прыгнуть на уже открытую:
  // прыжок он сделал бы через список вкладок или поиск по вкладкам, где это одно движение.
  //
  // Строку не убираем и не понижаем в самый низ — переключение остаётся под рукой, просто оно
  // больше не перехватывает место самого вероятного намерения. Тот же принцип, что у Chrome:
  // «Switch to tab» существует, но не подменяет собой открытие адреса.
  const firstOther = items.findIndex((it) => it.kind !== 'tab');
  if (firstOther > 0 && items[0]?.kind === 'tab') {
    const [tabItem] = items.splice(0, 1);
    if (tabItem) items.splice(firstOther, 0, tabItem);
  }

  // Порядок секций — по образцу Яндекс.Браузера (см. живое сравнение): самый релевантный
  // результат наверху, СРАЗУ за ним — «искать в вебе» (это всегда доступный, надёжный
  // вариант, не обязательно ждать, пока пользователь долистает всю историю до него), и только
  // потом — остальные, менее уверенные совпадения из истории/вкладок и живые веб-подсказки
  // (те — с самым слабым сигналом, значение не привязано к посещённым страницам вообще).
  // ── Открытые вкладки, которых нет в истории ──────────────────────────────────────────────
  // ⚠️ Выше вкладка попадала в подсказки, ТОЛЬКО если её адрес нашёлся в истории (tabIdByUrl
  // навешивает пометку на запись истории). Открытая пять минут назад страница, до которой
  // frecency ещё не дорос, не показывалась вовсе — а именно её и ищут чаще всего.
  // Совпадение считаем сами, тем же правилом границы слова, что и для истории.
  const alreadyShown = new Set(items.map((i) => i.tabId).filter(Boolean));
  const liveTabItems: SuggestItem[] = allTabs
    .filter((t) => !t.isHub && !alreadyShown.has(t.id))
    .filter((t) => {
      const host = hostnameOf(t.url);
      const title = (t.title || '').toLowerCase();
      return host.startsWith(q) || title.startsWith(q)
        || matchesAtWordBoundary(host, q) || matchesAtWordBoundary(title, q);
    })
    .slice(0, 3)
    .map((t) => ({ kind: 'tab' as SuggestKind, label: t.url, sub: t.title, url: t.url, tabId: t.id }));
  return [...items, ...liveTabItems];
}

/**
 * Второй эшелон: вкладка ПО СМЫСЛУ (локальная модель, см. electron/TabSearch.ts).
 *
 * ⚠️ Отдельной функцией — не только ради длины хука. Это единственное место сборки, которое ходит
 * к МОДЕЛИ, а не к диску, и цена ошибки здесь другая: очередь генерации в проекте одна и общая.
 */
async function appendSmartTabs(
  query: string, q: string, deduped: SuggestItem[], seq: number,
  seqRef: React.MutableRefObject<number>, setSuggestions: (items: SuggestItem[]) => void,
): Promise<void> {
  // ── Второй эшелон: вкладка ПО СМЫСЛУ (локальная модель, см. electron/TabSearch.ts) ────────
  //
  // ⚠️ Условия намеренно узкие, и каждое — про цену. Очередь генерации в проекте одна и общая,
  // прервать начатую генерацию node-llama-cpp не даёт, поэтому спрашивать модель на каждую
  // букву нельзя: она заняла бы себя устаревшими запросами, а человек ждал бы перевод.
  //  • ничего не нашлось обычным способом — иначе модель решает уже решённое;
  //  • запрос похож на ОПИСАНИЕ (есть пробел, от 6 символов), а не на начало адреса;
  // ⚠️ Условие «вкладок достаточно» переехало в main (TabSearch.MIN_TABS): поиск идёт по ВСЕМ
  // окнам, а здесь видно только своё — в лёгком окне с двумя вкладками мы молчали бы ровно
  // тогда, когда искать по другим окнам и нужно.
  // Результат приезжает отдельным обновлением списка: ждать модель, ничего не показывая, нельзя.
  const hasTabHit = deduped.some((i) => i.kind === 'tab');
  if (!hasTabHit && q.includes(' ') && q.length >= 6) {
    const smartHits = await window.oblako.searchTabsSmart(query).catch(() => [] as SmartTabHit[]);
    if (seq !== seqRef.current || smartHits.length === 0) return;
    // ⚠️ Заголовок и адрес берём ИЗ ОТВЕТА, а не из своего списка вкладок: находка может жить в
    // другом окне, и здесь о ней нет ничего (AI-IDEAS.md №8).
    const smartItems: SuggestItem[] = smartHits.map((h, idx) => ({
      kind: 'tab' as SuggestKind,
      label: h.url,
      // Про чужое окно говорим прямо: иначе переход выглядит как телепорт — окно сменилось, а
      // почему, человек не понял.
      sub: h.otherWindow ? `${h.title} — в другом окне` : h.title,
      url: h.url,
      tabId: h.tabId,
      windowId: h.otherWindow ? h.windowId : undefined,
      // Подпись честная: человек должен понимать, что эти строки нашлись НЕ по совпадению
      // слов, а моделью, — иначе они выглядят как случайные (слов запроса в них нет).
      ...(idx === 0 ? { sectionHeader: 'Вкладки по смыслу' } : {}),
    }));
    if (smartItems.length === 0) return;
    const withSmart = [...deduped, ...smartItems];
    setSuggestions(withSmart);
    void window.oblako.setSuggestDropdownItems(withSmart);
  }
}

export interface OmniboxSuggestions {
  /** Собрать список по набранному тексту. Историю рисует сразу, сеть догоняет. */
  triggerSuggest: (q: string) => void;
  /**
   * Отставить: погасить отложенный запрос к сети и забыть, что список был показан.
   *
   * ⚠️ Нужно закрытию дропдауна, которое живёт в тулбаре. Поднятого поколения хватило бы, чтобы
   * ответ не долетел, но будить ради заведомо выброшенного результата историю и сеть незачем. А
   * сброс «список показан» обязателен: без него провизорная строка не появится при СЛЕДУЮЩЕМ
   * открытии, и между кликом в строку и первым ответом истории дропдаун будет пустым.
   */
  cancelPending: () => void;
}

export function useOmniboxSuggestions(d: OmniboxSuggestionsDeps): OmniboxSuggestions {
  const { allTabs, searchEngineId, seqRef, openDropdown, closeDropdown, setSuggestions, setSelectedIdx } = d;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Живые подсказки поисковика для ПОСЛЕДНЕГО запроса. Кладёт отложенный запрос, читает
  // buildSuggestions -- так история рисуется сразу, а сеть догоняет и перерисовывает список.
  const phrasesRef = useRef<{ q: string; phrases: string[] }>({ q: '', phrases: [] });
  // Показан ли сейчас непустой список. Нужен рефом, а не стейтом: читается внутри
  // buildSuggestions, который живёт в useCallback и со стейтом видел бы прошлое значение.
  const listShownRef = useRef(false);

  const buildSuggestions = useCallback(async (query: string, seq: number) => {
    if (!query.trim()) { closeDropdown('empty-query'); return; }
    // ⚠️ ГВАРД ОБЯЗАН СТОЯТЬ ЗДЕСЬ, А НЕ ТОЛЬКО ПОСЛЕ ЗАПРОСОВ. Он есть ниже трижды, но всюду
    // после первого await — а показ дропдауна происходит РАНЬШЕ них, синхронно. Запуск же сюда
    // приходит отложенно, через дебаунс: закрой омнибокс в те 150 мс (Esc, клик по ссылке, смена
    // вкладки) — closeDropdown поднимал seq, но таймер оставался жив, и провизорный показ ниже
    // открывал вью ЗАНОВО. Закрыть её после этого было уже нечем: editing к тому моменту false,
    // слушатель «клика мимо» снят, сигнал фокуса в контент отработал, — дропдаун висел до
    // следующего переключения вкладки. Ровно тот редкий залипающий дропдаун, который ловился
    // «раз в сколько-то» и не имел закономерности: нужно попасть закрытием в окно дебаунса.
    if (seq !== seqRef.current) return;
    const q = query.toLowerCase();

    // ⚠️ Дропдаун открывается СРАЗУ, до всяких ожиданий. Раньше он ждал ОБЕ загрузки —
    // историю и живые подсказки поисковика, — а сетевой части отведено 3 секунды таймаута
    // (SearchSuggestFetcher.ts). На медленной сети это означало пустоту под строкой на всё
    // это время: человек печатает, а подсказок нет вовсе. Отсюда «дропдаун появляется
    // слишком поздно».
    //
    // Показываем то, что известно без единого запроса: «искать это в интернете». Строка и так
    // будет первой в готовом списке — то есть провизорный вид не мигает чем-то посторонним, он
    // просто беднее. Как только приедут история и подсказки, список заменится целиком ниже.
    //
    // ⚠️ Выделения тут нет (setSelectedIdx(-1)): Enter в этот момент обязан вести туда же, куда
    // вёл бы без дропдауна вовсе, — на набранное. Иначе исход нажатия зависел бы от того,
    // успела ли долететь сеть.
    // ⚠️ ТОЛЬКО НА ПЕРВОЕ ОТКРЫТИЕ, а не на каждую букву. Смысл провизорного показа был в том,
    // что готовый список ждали 150 мс дебаунса плюс до трёх секунд сети. Теперь история приходит
    // за миллисекунды, и подставлять одну строку «Искать: …» на каждое нажатие значит дважды
    // перерисовывать список внутри одного кадра: он мигает, а в main летят лишние два сообщения
    // на КАЖДЫЙ символ. Когда дропдаун уже открыт со списком — просто ждём готовый.
    if (!listShownRef.current) {
      const provisional: SuggestItem[] = [{
        kind: 'search',
        label: `Искать: ${query}`,
        url: getSearchEngine(searchEngineId).buildUrl(query),
      }];
      setSuggestions(provisional);
      setSelectedIdx(-1);
      openDropdown();
      void window.oblako.setSuggestDropdownItems(provisional);
      void window.oblako.setSuggestDropdownHighlight(-1);
    }

    // Заход 10: история и живые suggest-подсказки — параллельно, каждая изолирована через
    // Promise.allSettled (не Promise.all — сбой ОДНОЙ не должен обрушить ДРУГУЮ). fetchSuggestions
    // сама по себе никогда не бросает (см. SearchSuggestFetcher.ts — любая ошибка/таймаут/отмена
    // ловится там и превращается в []), но изоляция здесь дублируется намеренно: buildSuggestions
    // не должен зависеть от внутренней гарантии другого модуля, чтобы сбой suggest-API НИ ПРИ
    // КАКИХ обстоятельствах не уронил историю/вкладки.
    // ⚠️ ЖДЁМ ТОЛЬКО ИСТОРИЮ. Она отвечает за миллисекунды (замер у SUGGEST_DEBOUNCE), а сеть
    // может думать до трёх секунд — держать из-за неё готовый список нельзя. Живые подсказки
    // приезжают своим ходом (см. triggerSuggest) и перезапускают эту же сборку: список просто
    // становится длиннее, а не появляется позже.
    let histEntries: HistoryEntry[] = [];
    const histResult = await Promise.allSettled([window.oblako.searchHistory(query)]);
    if (histResult[0]!.status === 'fulfilled') histEntries = histResult[0]!.value;
    if (seq !== seqRef.current) return;
    // Фразы берём из кэша и только для ЭТОГО запроса: чужие подсказки под свежим набором —
    // это подсказки не о том, и человек их читает как ошибку.
    const suggestPhrases = phrasesRef.current.q === query ? phrasesRef.current.phrases : [];

    const now = Date.now();

    const [topItem, ...restItems] = rankHistoryAndTabs(histEntries, allTabs, q, now);
    // Живые веб-подсказки — ОТДЕЛЬНОЙ группой НИЖЕ истории/вкладок (точных совпадений), как в
    // Chrome: сначала твоё, потом веб-автодополнение. Не участвуют в frecency-ранжировании items
    // (это не посещённые страницы) — порядок такой, какой вернул сам suggest-API движка.
    // Фраза, совпадающая с самим введённым текстом, отфильтровывается — её уже покрывает searchItem.
    const suggestItems: SuggestItem[] = suggestPhrases
      .filter((phrase) => phrase.trim().toLowerCase() !== q)
      .map((phrase) => ({
        kind: 'suggest' as SuggestKind,
        label: phrase,
        url: getSearchEngine(searchEngineId).buildUrl(phrase),
      }));

    const searchItem: SuggestItem = {
      kind: 'search',
      label: `Искать: ${query}`,
      url: getSearchEngine(searchEngineId).buildUrl(query),
    };


    // Порядок секций, подписи и правило «набран адрес → не переключай на вкладку, открывай» —
    // чистая логика под проверкой (shared/suggestList.ts, npm test -- suggest-list).
    const deduped = composeSuggestions({
      topItem,
      searchItem,
      restItems,
      suggestItems,
      query,
      engineName: getSearchEngine(searchEngineId).name,
    });
    if (seq !== seqRef.current) return;
    listShownRef.current = deduped.length > 0;
    setSuggestions(deduped);
    // ⚠️ Enter должен вести на ПЕРВУЮ строку, а не на набранные 2-4 символа — но только когда
    // первая строка это «герой» (лучшее совпадение из истории/вкладок). Жалоба была именно про
    // это: подсказка та самая, а Enter уходит на огрызок текста.
    //
    // ⚠️ Слепо выделять строку 0 НЕЛЬЗЯ. Без героя первой идёт searchItem («Искать: …»), и тогда
    // набранный адрес github.com ушёл бы В ПОИСК вместо перехода: разбор адреса живёт в
    // TabManager.resolveInput (схемы, хосты, бэнги), а сюда доезжает только готовая строка поиска.
    //
    // ⚠️ И даже с героем выделяем не всегда: если набранное похоже на адрес, «лучшее совпадение»
    // может оказаться ДРУГОЙ страницей того же сайта, и Enter увёл бы не туда. Признак нарочно
    // грубый и в спорную сторону — есть точка или схема, значит считаем адресом и оставляем
    // прежнее поведение. Дублировать здесь разбор resolveInput нельзя: две копии правил разъедутся
    // молча (в этом файле такое уже было с перечнем разделов настроек).
    const preselect = topItem && !looksLikeAddress(query) ? 0 : -1;
    setSelectedIdx(preselect);
    openDropdown();
    // Тот же список — дополнительно в нативную вью дропдауна (заход 3/5, параллельно старому
    // React-дропдауну выше). Формирование списка (история/вкладки/frecency/дедуп) не меняется —
    // только эта отправка добавлена.
    void window.oblako.setSuggestDropdownItems(deduped);
    // Новый список — подсветку во вью выставляем синхронно с selectedIdx выше (заход 4/5):
    // иначе вью подсвечивала бы строку, которой уже нет/сместилась. Теперь тем же значением
    // едет и предвыбор героя — человек обязан ВИДЕТЬ, куда уйдёт Enter, иначе это фокус с
    // непредсказуемым исходом.
    void window.oblako.setSuggestDropdownHighlight(preselect);

    await appendSmartTabs(query, q, deduped, seq, seqRef, setSuggestions);
  }, [allTabs, openDropdown, closeDropdown, searchEngineId, seqRef, setSuggestions, setSelectedIdx]);

  // ⚠️ «Вы это уже читали» жило здесь и переехало в поповер замочка (SitePopoverManager.ts).
  // Причина — в омнибоксе оказались ДВЕ фоновые AI-функции сразу, и они мешали друг другу:
  // связанные страницы стартовали по клику в строку, поиск вкладки по смыслу — при наборе, а
  // модель, очередь и невозможность прервать генерацию у них общие. Подробности в onFocus ниже.

  const triggerSuggest = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { closeDropdown('empty-query-trigger'); return; }
    const seq = ++seqRef.current;
    // ⚠️ История — БЕЗ ЗАДЕРЖКИ, прямо на нажатие. Это и есть разница с прежним поведением:
    // раньше здесь стоял единственный setTimeout на 150 мс, и первые 150 мс после буквы дропдаун
    // не показывал ничего, хотя ответ был готов за 2 мс.
    void buildSuggestions(q, seq);
    // Сеть — отложенно. Дошла — кладём в кэш и пересобираем список тем же seq: если человек
    // успел напечатать дальше, seq уже другой, и устаревшие подсказки не всплывут.
    debounceRef.current = setTimeout(() => {
      void window.oblako.fetchSuggestions(q).then((phrases) => {
        if (seq !== seqRef.current) return;
        if (phrases.length === 0) return;   // пересобирать список ради пустоты незачем
        phrasesRef.current = { q, phrases };
        void buildSuggestions(q, seq);
      }).catch(() => { /* сеть недоступна — список уже показан без подсказок */ });
    }, SUGGEST_DEBOUNCE);
  }, [buildSuggestions, closeDropdown, seqRef]);

  const cancelPending = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    listShownRef.current = false;
  }, []);

  return { triggerSuggest, cancelPending };
}
