import { useCallback, useEffect, useRef } from 'react';
import type { HistoryEntry, PermissionRecord, OmniboxPanel, OmniboxPanelSite, OmniboxResume, SemanticSearchResult, SuggestDropdownItem } from '../../../shared/ipc';
import { normalizeForOmnibox, scoreEntry } from '../../../shared/frecency';
import { isSearchResultUrl } from '../../../shared/searchEngines';
import { pickResume, mergeOmniboxShelf } from '../../../shared/omniboxResume';

// ── Панель по клику в НЕТРОНУТУЮ строку ──────────────────────────────────────
//
// Всё, что человек видит, когда щёлкнул по адресной строке и ничего не набрал: строки «Продолжить»,
// одна полка сайтов, полоска текущего сайта и «вы это уже читали».
//
// ⚠️ Вынесено из Toolbar.tsx отдельным хуком, а не оставлено там: тулбар — единственный файл
// проекта, который пробивает все четыре порога храповика структуры сразу (размер, длина функции,
// число эффектов, число обращений к main), и разбирается он тем же способом, что App.tsx, — по
// швам. Этот шов самый чистый: наружу от него нужна одна функция, внутрь — семь значений.
//
// ⚠️ Владение выбором НЕ переехало и переезжать не должно. Список подсказок остаётся плоским
// массивом в тулбаре, selectedIdx индексирует его же, Enter выполняется там. Хук только
// СОБИРАЕТ содержимое панели и кладёт его в тот же список — второго источника истины нет.

// Сколько записей истории просматриваем ради списка «часто посещаемые» и сколько сайтов
// показываем. Глубина взята с запасом: у частого сайта в истории десятки страниц, и после
// схлопывания по сайту из трёхсот записей остаются единицы доменов.
const TOP_SITES_SCAN = 300;
const TOP_SITES_SHOWN = 8;
// Карточек «вы это уже читали» в панели. Поповер замочка показывает три строкой; здесь ряд
// карточек во всю ширину, и четвёртая ложится в него без переноса на обычной ширине окна.
const PANEL_RELATED_MAX = 4;
// Потолок набора «Рекомендуемые» — папка рисует его блоком 4×2. Тот же предел стоит и в
// SettingsManager (RECOMMENDED_MAX): диск не обязан верить рендереру.
const RECOMMENDED_MAX = 8;

type SuggestKind = SuggestDropdownItem['kind'];
type SuggestItem = SuggestDropdownItem;

function resumeItems(raw: OmniboxResume, currentUrl: string, now: number): SuggestItem[] {
  return pickResume(raw.closed, raw.other, currentUrl, now).map((row) => ({
    kind: row.tabId ? 'tab' as const : 'history' as const,
    label: row.url,
    sub: row.title,
    url: row.url,
    tabId: row.tabId,
    windowId: row.windowId,
    meta: row.meta,
    tagged: row.tagged,
  }));
}

export interface OmniboxPanelDeps {
  /** Адрес открытой страницы: из него собирается полоска сайта и по нему кэшируются дорисовки. */
  tabUrl: string | undefined;
  /** На хабе полоски сайта нет — показывать нечего. */
  isHub: boolean;
  /**
   * Счётчик поколений запросов, ОБЩИЙ с обычными подсказками.
   *
   * ⚠️ Именно общий, а не свой: панель и подсказки пишут в один список, и ответ, приехавший после
   * того, как человек начал набирать текст, обязан быть отброшен обоими путями одинаково. Заведи
   * хук свой счётчик — и медленная дорисовка панели затирала бы уже набранные подсказки.
   */
  seqRef: React.MutableRefObject<number>;
  openDropdown: () => void;
  closeDropdown: (reason: string) => void;
  setSuggestions: (items: SuggestItem[]) => void;
  setSelectedIdx: (i: number) => void;
}

function toRelatedItems(hits: SemanticSearchResult[]): SuggestItem[] {
  return hits.slice(0, PANEL_RELATED_MAX).map((h) => ({
    kind: 'history' as SuggestKind, label: h.url, sub: h.title || h.url, url: h.url,
  }));
}

// FTS при идущем реранке на экран не кладём: мелькание «почти тех» заголовков хуже секунды
// ожидания. Пока модель переставляет — скелет той же длины, в плоский выбор он не входит.
async function fillRelatedRow(p: {
  seq: number;
  seqRef: React.MutableRefObject<number>;
  pageUrl: string;
  resume: SuggestItem[];
  relatedRef: React.MutableRefObject<Map<string, SuggestItem[]>>;
  wait: { n: number };
  extra: () => Partial<OmniboxPanel>;
  pack: (extra?: Partial<OmniboxPanel>) => OmniboxPanel;
  setSuggestions: (items: SuggestItem[]) => void;
}): Promise<void> {
  const paint = (items: SuggestItem[]) => {
    p.wait.n = 0;
    if (items.length) p.relatedRef.current.set(p.pageUrl, items);
    void window.oblako.setSuggestDropdownPanel(p.pack(p.extra()));
    if (items.length) p.setSuggestions([...p.resume, ...items]);
  };
  const cached = p.relatedRef.current.get(p.pageUrl);
  if (cached) { paint(cached); return; }
  const first = await window.oblako.getRelatedPages().catch(() => ({ results: [], pending: false }));
  if (p.seq !== p.seqRef.current) return;
  if (!first.pending) { paint(toRelatedItems(first.results)); return; }
  if (first.results.length) {
    p.wait.n = Math.min(first.results.length, PANEL_RELATED_MAX);
    void window.oblako.setSuggestDropdownPanel(p.pack(p.extra()));
  }
  const ranked = await window.oblako.getRelatedPages().catch(() => ({ results: [], pending: false }));
  if (p.seq !== p.seqRef.current) return;
  paint(toRelatedItems(ranked.results));
}

export function useOmniboxPanel(d: OmniboxPanelDeps): { showTopSites: () => Promise<void> } {
  // ⚠️ Не оптимизация ради оптимизации: getPageChanges достаёт текст живой страницы и сравнивает
  // со снимком в истории, а панель открывается на каждый щелчок по адресной строке. Без кэша один
  // и тот же разбор шёл бы десятки раз на одной странице. Пустая строка = «спрашивали, изменений
  // нет» — это тоже ответ, и повторять его незачем.
  const pageChangesRef = useRef<Map<string, string>>(new Map());
  const relatedRef = useRef<Map<string, SuggestItem[]>>(new Map());
  // Набор закрепов на полке. Пока человек карандашом не трогал, сюда ничего не кладём —
  // дефолт Gmail/ChatGPT в панель не показываем. После правки список живёт здесь и на диске.
  const recommendedRef = useRef<SuggestItem[]>([]);

  const { tabUrl, isHub, seqRef, openDropdown, closeDropdown, setSuggestions, setSelectedIdx } = d;

  // Заход 11: раньше здесь был плоский список часто посещаемых, и после переезда омнибокса во
  // flex-поток (строка занимает всю свободную полосу) восемь строк слева оставляли пустой всю
  // правую половину карточки. Теперь это ПАНЕЛЬ (см. OmniboxPanel в shared/ipc.ts): строки
  // «Продолжить», плитки сайтов, полоска текущего сайта и «вы это уже читали».
  //
  // ⚠️ Дорисовка приезжает ВТОРЫМ пакетом и только СНИЗУ. Высота карточки задаёт высоту окна
  // (reportHeight → setBounds), поэтому блок, который вставился бы ВЫШЕ уже нарисованного, увёл
  // бы плитки из-под курсора в момент, когда человек в них целится. «Продолжить» поэтому едет
  // в ПЕРВОМ пакете вместе с плитками — не отдельным запросом после шапки сайта.
  //
  // ⚠️ Раньше здесь запрашивались обычные подсказки по тексту строки, а в строке лежит адрес
  // открытой страницы — поиск по истории находил её же, и дропдаун получался ЗЕРКАЛОМ: одна
  // строка, повторяющая то, что написано выше. Так же поступает Chrome: по клику он показывает
  // не отражение адреса, а то, куда человек ходит.
  //
  // ⚠️ Дедуп по САЙТУ, а не по странице: у частого сайта в истории десятки страниц, и без этого
  // весь список занял бы один домен. Внутри сайта берём страницу с лучшим frecency — та же
  // функция scoreEntry, что ранжирует обычные подсказки, второй копии правил не заводим.
  //
  // ⚠️ Открытую страницу из списка выбрасываем: предлагать переход туда, где человек и так стоит,
  // — это тот же зеркальный дропдаун, только длиннее.
  const showTopSites = useCallback(async () => {
    const seq = ++seqRef.current;
    const resumeP = window.oblako.getOmniboxResume().catch((): OmniboxResume => (
      { closed: [], other: [], recommendedCustom: false }
    ));
    let entries: HistoryEntry[] = [];
    try { entries = await window.oblako.getHistory(TOP_SITES_SCAN); } catch { return; }
    if (seq !== seqRef.current) return;
    const rawResume = await resumeP;
    if (seq !== seqRef.current) return;

    const now = Date.now();
    const pageUrl = tabUrl ?? '';
    const resume = resumeItems(rawResume, pageUrl, now);
    const currentKey = normalizeForOmnibox(pageUrl);
    const siteOf = (u: string): string => { try { return new URL(u).origin; } catch { return u; } };
    const best = new Map<string, HistoryEntry>();
    for (const e of entries) {
      if (isSearchResultUrl(e.url)) continue; // то же наследие, что и в подсказках по тексту
      if (normalizeForOmnibox(e.url) === currentKey) continue;
      const key = siteOf(e.url);
      const cur = best.get(key);
      if (!cur || scoreEntry(e, now) > scoreEntry(cur, now)) best.set(key, e);
    }
    const frequent: SuggestItem[] = [...best.values()]
      .sort((a, b) => scoreEntry(b, now) - scoreEntry(a, now))
      .slice(0, TOP_SITES_SHOWN)
      .map((e) => ({ kind: 'history' as SuggestKind, label: e.title || e.url, sub: e.url, url: e.url }));

    if (rawResume.recommendedCustom) {
      try {
        const list = await window.oblako.getRecommendedSites();
        if (seq !== seqRef.current) return;
        recommendedRef.current = list.map((s) => ({
          kind: 'history' as SuggestKind, label: s.title || s.url, sub: s.url, url: s.url,
        }));
      } catch { /* ref как был — карандаш уже мог положить набор */ }
    } else {
      recommendedRef.current = [];
    }
    const picked = recommendedRef.current;
    const shelf = mergeOmniboxShelf(
      rawResume.recommendedCustom ? picked.map((s) => ({ url: s.url, title: s.label })) : null,
      frequent.map((s) => ({ url: s.url, title: s.label })),
    );
    const items: SuggestItem[] = shelf.map((s) => ({
      kind: 'history' as SuggestKind, label: s.title || s.url, sub: s.url, url: s.url,
    }));

    const hasSite = !!pageUrl && !isHub;
    if (!items.length && !hasSite && !resume.length) { closeDropdown('empty-panel'); return; }

    const pack = (extra: Partial<OmniboxPanel> = {}): OmniboxPanel => ({
      sites: items, recommended: picked, resume, ...extra,
    });

    // Плитки только мышью: в плоском выборе — «Продолжить», потом «уже читали».
    setSuggestions(resume);
    // ⚠️ Ничего не предвыбираем: человек НИЧЕГО не набирал, и Enter обязан вести по адресу в
    // строке — туда же, куда вёл бы без дропдауна вовсе.
    setSelectedIdx(-1);
    openDropdown();
    void window.oblako.setSuggestDropdownPanel(pack());
    void window.oblako.setSuggestDropdownHighlight(-1);
    if (!hasSite) return;

    // ── Дорисовка: сведения о сайте ───────────────────────────────────────────────────────────
    // Всё, что ниже, — по одному запросу на КАЖДОЕ открытие панели, поэтому здесь только дешёвое:
    // счётчик адблока и список разрешений уже посчитаны в main, лезть за ними некуда.
    let host = '';
    try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { return; }
    const origin = (() => { try { return new URL(pageUrl).origin; } catch { return ''; } })();

    const [blocked, adblockOff, perms] = await Promise.all([
      window.oblako.getSiteBlockedCount(host).catch(() => 0),
      window.oblako.isAdblockAllowed(host).catch(() => false),
      window.oblako.listPermissions().catch(() => [] as PermissionRecord[]),
    ]);
    if (seq !== seqRef.current) return;

    const site: OmniboxPanelSite = {
      host,
      secure: pageUrl.startsWith('https://'),
      blocked,
      adblockOff,
      perms: perms.filter((p) => p.origin === origin && p.decision === 'granted').map((p) => p.permission),
      // Фраза «изменилось с прошлого раза» могла приехать на прошлом открытии панели по этому же
      // адресу — показываем сразу, второй раз страницу не разбираем (см. кэш ниже).
      changed: pageChangesRef.current.get(pageUrl),
    };
    void window.oblako.setSuggestDropdownPanel(pack({ site, siteUrl: pageUrl }));

    const relatedWait = { n: 0 };
    const panelExtra = (): Partial<OmniboxPanel> => {
      const extra: Partial<OmniboxPanel> = { site, siteUrl: pageUrl };
      const rel = relatedRef.current.get(pageUrl);
      if (rel) extra.related = rel;
      if (relatedWait.n) extra.relatedPending = relatedWait.n;
      return extra;
    };
    const relatedP = fillRelatedRow({
      seq, seqRef, pageUrl, resume, relatedRef, wait: relatedWait, extra: panelExtra, pack, setSuggestions,
    });

    // ⚠️ РАЗ НА АДРЕС. Вызов достаёт текст живой страницы и сравнивает со снимком в истории —
    // это не то, что можно звать на каждый щелчок по адресной строке (а щёлкают по ней постоянно).
    // Ответ «нет изменений» кэшируем пустой строкой, чтобы не спрашивать повторно.
    if (!pageChangesRef.current.has(pageUrl)) {
      const changes = await window.oblako.getPageChanges().catch(() => null);
      if (seq !== seqRef.current) return;
      const phrase = changes?.changed ? (changes.summary || 'Страница изменилась') : '';
      pageChangesRef.current.set(pageUrl, phrase);
      if (phrase) {
        site.changed = phrase;
        // related / скелет могли уже дорисоваться параллельно — не затирать ряд шапкой «изменилось».
        void window.oblako.setSuggestDropdownPanel(pack(panelExtra()));
      }
    }
    await relatedP;
  }, [tabUrl, isHub, seqRef, openDropdown, closeDropdown, setSuggestions, setSelectedIdx]);

  // Правка набора карандашом (вью → main → сюда). Владелец содержимого панели один, поэтому
  // применяем, сохраняем и пересобираем панель здесь же — вью только присылает намерение.
  const showTopSitesRef = useRef(showTopSites);
  showTopSitesRef.current = showTopSites;
  useEffect(() => window.oblako.onSuggestDropdownRecommend((edit) => {
    const cur = recommendedRef.current;
    const next = edit.action === 'remove'
      ? cur.filter((s) => s.url !== edit.url)
      : cur.some((s) => s.url === edit.url)
        ? cur
        : [...cur, { kind: 'history' as SuggestKind, label: edit.title || edit.url, sub: edit.url, url: edit.url }]
            .slice(0, RECOMMENDED_MAX);
    recommendedRef.current = next;
    void window.oblako.setRecommendedSites(next.map((s) => ({ url: s.url, title: s.label })))
      .then(() => { void showTopSitesRef.current(); });
  }), []);

  return { showTopSites };
}
