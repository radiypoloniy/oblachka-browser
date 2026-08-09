// Qwen-группировка открытых вкладок — замена бывшей эмбеддинг-кластеризации (ClusteringService.ts,
// удалена) на прямой промпт модели: список вкладок целиком, названия групп придумывает сама
// модель по смыслу, а не частотный разбор слов заголовка.
import type { TabManager } from './TabManager';
import type { HistoryManager } from './HistoryManager';
import type { SidebarNode, TabState, OrganizeCluster, OrganizeProposal, ModelErrorCode } from '../shared/ipc';
import { normalizeForOmnibox } from '../shared/frecency';
import { groupNameFromDomain } from '../shared/rules';
import { getLoadedModelId, runTabOrganizePrompt } from './TranslationService';

let tabManagerRef: TabManager | null = null;
export function setTabManager(tm: TabManager): void {
  tabManagerRef = tm;
}

let historyRef: HistoryManager | null = null;
export function setHistoryManager(h: HistoryManager): void {
  historyRef = h;
}

interface Candidate {
  nodeId: string;               // tabId для single; leftTabId для split-pair
  nodeType: 'single' | 'split-pair';
  title: string;
  url: string;
}

// Тот же фильтр верхнего уровня, что App.tsx:482-484/ClusteringService.ts::buildCandidates —
// single + split-pair, без pinned/hub/history/settings, GroupNode (существующие группы) не трогаем.
function buildCandidates(nodes: SidebarNode[], tabMap: Map<string, TabState>): Candidate[] {
  const result: Candidate[] = [];
  for (const node of nodes) {
    if (node.type === 'single') {
      const tab = tabMap.get(node.tabId);
      if (!tab || tab.isHub || tab.isPinned || tab.kind === 'history' || tab.kind === 'settings') continue;
      result.push({ nodeId: node.tabId, nodeType: 'single', title: tab.title, url: tab.url });
    } else if (node.type === 'split-pair') {
      const left = tabMap.get(node.leftTabId);
      if (!left) continue;
      result.push({ nodeId: node.leftTabId, nodeType: 'split-pair', title: left.title, url: left.url });
    }
    // GroupNode пропускаем — существующие группы не трогаем.
  }
  return result;
}

// Дубли — без модели, по normalizeForOmnibox(url) (shared/frecency.ts, тот же ключ, что уже
// использует Toolbar.tsx/HistorySearch.ts). Первое вхождение в порядке дерева — оригинал
// (остаётся вне группировки), остальные — дубли: не тратим токены модели на почти одинаковые
// строки и не путаем её ими.
function splitDuplicates(candidates: Candidate[]): { unique: Candidate[]; duplicates: Candidate[] } {
  const seen = new Set<string>();
  const unique: Candidate[] = [];
  const duplicates: Candidate[] = [];
  for (const c of candidates) {
    const key = normalizeForOmnibox(c.url);
    if (seen.has(key)) {
      duplicates.push(c);
    } else {
      seen.add(key);
      unique.push(c);
    }
  }
  return { unique, duplicates };
}

function extractHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Двухуровневые доменные зоны, где «последние две метки» дали бы бессмыслицу («co.uk»).
// Список короткий намеренно: полный public suffix list — это отдельная зависимость на мегабайт,
// а нам нужно лишь не склеить в одну группу два разных сайта.
const TWO_LEVEL_TLDS = new Set(['co.uk', 'org.uk', 'ac.uk', 'com.au', 'com.br', 'co.jp', 'com.tr', 'com.ua']);

// Сайт, которому принадлежит вкладка: daily.afisha.ru и m.afisha.ru — это один сайт afisha.ru.
// Группировать по ПОЛНОМУ хосту нельзя: поддомены новостных изданий разъехались бы по разным
// группам, хотя для человека это одно место.
function siteOf(url: string): string {
  const host = extractHostname(url);
  if (!host || /^[\d.:]+$/.test(host)) return host; // IP — оставляем как есть
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  return TWO_LEVEL_TLDS.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

const SNIPPET_MAX_CHARS = 200;

// Описание одной вкладки: заголовок | домен | сниппет. Сниппет опускается целиком (не
// выдумываем), если страница не проиндексирована (getFirstChunksByUrls ничего не вернул).
//
// ⚠️ БЕЗ номера. Номер приписывает только список первой фазы (см. buildPromptLines): во второй
// фазе нумерация означает ТЕМЫ, и лишний номер у самой вкладки её ломает — модель отвечала то
// номером вкладки, то отказом, и не раскладывалось НИ ОДНОЙ вкладки из восьми.
function describeCandidate(c: Candidate, snippets: Map<string, string>): string {
  const snippet = snippets.get(normalizeForOmnibox(c.url));
  const base = `${c.title} | ${extractHostname(c.url)}`;
  if (!snippet) return base;
  const trimmed = snippet.length > SNIPPET_MAX_CHARS ? `${snippet.slice(0, SNIPPET_MAX_CHARS)}…` : snippet;
  return `${base} | ${trimmed}`;
}

function buildPromptLines(candidates: Candidate[], snippets: Map<string, string>): string[] {
  return candidates.map((c, i) => `${i + 1}. ${describeCandidate(c, snippets)}`);
}

// ⚠️ ДВЕ ФАЗЫ, а не один прогон «разложи всё». Прежний вариант просил модель за одну генерацию
// придумать группы И расписать по ним все вкладки — то есть принять десятки решений разом. Стенд
// (`npm run ai-bench`) показал, чем это кончается: 1 из 3 проверок, результат гуляет от прогона к
// прогону (то две вкладки из восьми разложены, то четыре), борщ уезжает в одну группу с
// документацией Vue. Диагноз тот же, что был у разбора правил: расходятся решения, на которых
// модель почти не уверена, а чем их больше в одном ответе, тем больше шансов на срыв (подробный
// разбор — в TranslationService.ts::runPromptQueued).
//
// Поэтому: ОДИН прогон придумывает темы (короткий выход — только названия), а дальше КАЖДАЯ
// вкладка раскладывается своим отдельным прогоном, и это уже форма «выбери номер из списка» —
// единственная, которая в замерах не срывалась ни разу (см. поиск вкладки и смысловой Ctrl+F).
// ⚠️ Потолок тем НИЗКИЙ намеренно. С пятью на восьми вкладках модель придумывала тему почти на
// каждую вкладку («Расчёт налогов», «Домашняя кухня», «Здоровье и питание»…), после чего группы
// разваливались на одиночек и до человека не доезжало ничего: группа из одной вкладки — не группа.
// Тема обязана покрывать НЕСКОЛЬКО вкладок, иначе она бесполезна.
// ⚠️ Число тем считается ОТ ЧИСЛА ВКЛАДОК, а не фиксировано. Живой случай: на семнадцати вкладках
// потолок в четыре темы не оставил места теме «Погода» из двух статей — и дальше доменный слой
// разорвал эту пару: снобовская статья ушла в группу своего издания, а тассовская осталась одна.
// Пара по смыслу разъехалась не потому, что смысл проиграл домену (домен видит только остаток),
// а потому, что до этой пары смысл просто не дошёл.
// Одна тема на три вкладки — при десяти это прежние четыре (значение, на котором мерился стенд),
// при семнадцати — шесть. Потолок в семь: дальше первая фаза перестаёт быть коротким прогоном,
// а вторая идёт по прогону НА ТЕМУ.
const MIN_TOPICS = 2;
const MAX_TOPICS_CAP = 7;
function topicBudget(tabCount: number): number {
  return Math.min(MAX_TOPICS_CAP, Math.max(MIN_TOPICS, Math.ceil(tabCount / 3)));
}
const TOPICS_CUE = 'TOPICS:';
const ANSWER_CUE = 'ANSWER:';

// ⚠️ Инструкция по-английски при русском содержимом — то же правило, что у остальных структурных
// промптов проекта. Названия тем просим по-русски явно.
function buildTopicsPrompt(lines: string[], maxTopics: number): string {
  return (
    `Open browser tabs (number, title, domain, and a text snippet when available):\n\n` +
    `${lines.join('\n')}\n\n` +
    `Name the topics these tabs fall into — by shared subject, project or intent, not by ` +
    `matching words in titles.\n` +
    `Rules:\n` +
    `- at most ${maxTopics} topics;\n` +
    // Ключевое правило: тема ради одной вкладки бесполезна — такая группа всё равно будет
    // отброшена ниже, а место в списке тем она займёт.
    `- every topic must cover AT LEAST TWO tabs from the list above;\n` +
    `- never invent a topic for a single tab — tabs that fit nowhere simply stay ungrouped, ` +
    `and that is a fine outcome;\n` +
    // Широкая тема («Технологии») собирает под себя что угодно — обзор пылесоса рядом с
    // документацией фреймворка. Просим конкретную.
    `- prefer a specific theme ("Документация фреймворков") over a vague one ("Технологии");\n` +
    `- each topic name: 2-4 words, IN RUSSIAN, describing the theme rather than repeating ` +
    `one tab's title.\n\n` +
    `Reply with a single line, topics separated by semicolons:\n` +
    `${TOPICS_CUE} тема; тема; тема`
  );
}

// ── Имя для группы, собранной РУКАМИ (AI-IDEAS.md №5) ───────────────────────────
/**
 * Имя-заготовка для группы, собранной руками. Фоновой полосой, гейт «модель тёплая» — на стороне
 * вызывающего (main): холодную модель ради подписи не будим, тогда остаётся ручной ввод, как раньше.
 *
 * ⚠️ ПЕРЕИСПОЛЬЗУЕМ ПРОВЕРЕННЫЙ ПРОМПТ ТЕМ (buildTopicsPrompt), прося РОВНО ОДНУ тему: она и есть
 * имя группы. Свой промпт «назови эти вкладки» 4B не осилила — вместо имени рассуждала по-английски
 * («I'm not sure if this is the best approach…»), а с русским словом-плейсхолдером возвращала его
 * эхом (та же ловушка, что в RuleParser). Промпт тем на этой же модели даёт 3/3 на стенде и уже
 * умеет ровно то, что нужно: короткая русская тема на 2-4 слова по СМЫСЛУ вкладок, не по словам
 * заголовка. Одна вкладка имени не получает — это ещё не «группа по смыслу» (гейт и здесь, и у
 * вызывающего).
 */
export async function suggestGroupName(tabs: { title: string; url: string }[]): Promise<string | null> {
  const named = tabs.filter((t) => (t.title && t.title.trim()) || t.url);
  if (named.length < 2) return null;
  const lines = named.map((t, i) => `${i + 1}. ${t.title || '(без названия)'} | ${extractHostname(t.url)}`);
  const res = await runTabOrganizePrompt(buildTopicsPrompt(lines, 1), { background: true });
  if (!res.ok) return null;
  const first = parseTopics(res.out, 1)[0] ?? null;
  // Модель иногда возвращает слово-плейсхолдер из шаблона («тема») вместо ответа — это НЕ имя
  // (та же ловушка эха, что разобрана в RuleParser). Оставляем тогда «Новую группу».
  const name = first && !/^(тема|topic|название|name)$/i.test(first) ? first : null;
  // Сырой ответ в лог — тот же принцип, что у остального AI (см. CLAUDE.md): без него «не назвалось»
  // неотличимо от «мы не так разобрали».
  console.log(`[group-name] ${named.length} вкладок → ${JSON.stringify(name)}, ответ модели: ${JSON.stringify(res.out.slice(0, 160))}`);
  return name;
}

function parseTopics(out: string, maxTopics: number): string[] {
  const line = new RegExp(`${TOPICS_CUE}\\s*([^\\n]*)`, 'i').exec(out)?.[1] ?? '';
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const raw of line.split(/[;|]/)) {
    const t = raw.trim().replace(/^["'«»]|["'«»]$/g, '').replace(/\.$/, '').trim();
    // Отсекаем и пустое, и явный мусор: длинная «тема» — это модель начала пересказывать вкладки.
    if (!t || t.length > 40) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(t);
    if (topics.length >= maxTopics) break;
  }
  return topics;
}

// Отбор вкладок ПОД ОДНУ тему — по одному прогону на тему.
//
// ⚠️ Цикл именно такой, а не «по вкладке за прогон», и это выстрадано двумя замерами подряд.
// Когда спрашивали про одну вкладку по списку тем:
//  • с вариантом «ни одна не подходит» модель отвечала «none» практически на всё — борщ не попадал
//    в «Рецепты и здоровье», документация Vue не попадала в «Документацию фреймворков» (0
//    разложенных вкладок из 8 при вполне толковых темах): короткий вопрос «подходит ли?» она
//    читает как проверку и осторожничает;
//  • без этого варианта, когда выбор обязателен, она раскладывала что попало — борщ и пылесос
//    уезжали в «Транспорт и погода», React Hooks в «Расчёт налогов».
// Причина в том, ЧТО лежит списком. У нас работают ровно те промпты, где список — это богатые
// строки (заголовки вкладок, фрагменты страницы), а запрос один; список из четырёх коротких
// названий тем модели зацепиться не за что. Развернув цикл, получаем привычную форму: запрос —
// тема, список — вкладки со всеми их заголовками и сниппетами.
function buildTopicMembersPrompt(topic: string, topics: string[], lines: string[]): string {
  // ⚠️ Остальные темы показываем, хотя спрашиваем про одну. Без них первая же тема забирала себе
  // всё подряд: «Расчёт налогов» → рецепт борща и обзор пылесоса. Спрошенная в отрыве, модель не
  // знает, что у этих вкладок есть свой дом, и притягивает их за уши.
  const others = topics.filter((t) => t !== topic);
  return (
    `Open browser tabs:\n${lines.join('\n')}\n\n` +
    (others.length ? `Other topics exist for the remaining tabs: ${others.join('; ')}.\n\n` : '') +
    `Which of these tabs belong to the topic "${topic}"? Decide by MEANING — ` +
    `the words of the topic may not appear in the tab title at all.\n` +
    `A tab that belongs to one of the other topics must NOT be listed here.\n` +
    `Answer with a single line: "${ANSWER_CUE} <numbers separated by commas>".`
  );
}

// ⚠️ Разбираем только строку ПОСЛЕ метки — тот же урок, что у поиска вкладки: без этого номера
// вытаскиваются из перечня, который модель любит переписать, и выдаются за её выбор.
function parseMembers(out: string, tabCount: number): number[] {
  const line = new RegExp(`${ANSWER_CUE}\\s*([^\\n]*)`, 'i').exec(out)?.[1]?.trim();
  if (!line || /^(нет|none|no)\b/i.test(line)) return [];
  // После метки должны идти только номера — пересказ вместо ответа не разбираем.
  if (!/^[\d\s,;и]+$/i.test(line)) return [];
  const seen = new Set<number>();
  const picked: number[] = [];
  for (const m of line.matchAll(/\d+/g)) {
    const n = Number(m[0]);
    if (!Number.isInteger(n) || n < 1 || n > tabCount || seen.has(n)) continue;
    seen.add(n);
    picked.push(n);
  }
  return picked;
}

export async function suggestGroups(): Promise<OrganizeProposal> {
  // modelWasCold фиксируется ДО вызова модели (не после) — UI использует его, чтобы решить, было ли
  // это холодным стартом (ensureLoaded() внутри runTabOrganizePrompt ниже сама грузит модель, если
  // её ещё нет — гейта MODEL_NOT_LOADED больше нет, группировка теперь такой же явный триггер
  // загрузки, как открытие AI-панели, пользователь сам нажал кнопку).
  const modelWasCold = getLoadedModelId() === null;

  const tabs = tabManagerRef;
  const history = historyRef;
  if (!tabs || !history) return { ok: true, clusters: [], modelWasCold };

  const nodes = tabs.sidebarNodesSnapshot();
  const tabStates = tabs.snapshot();
  const tabMap = new Map(tabStates.map((t) => [t.id, t]));

  const candidates = buildCandidates(nodes, tabMap);
  const { unique, duplicates } = splitDuplicates(candidates);

  const clusters: OrganizeCluster[] = [];
  // Сбой модели запоминаем, но сразу наружу не отдаём: группировка по сайту от модели не зависит.
  let modelError: { error: string; errorCode?: ModelErrorCode } | null = null;

  if (unique.length >= 2) {
    const snippets = history.getFirstChunksByUrls(unique.map((c) => c.url));
    const lines = buildPromptLines(unique, snippets);

    // ── Фаза 1: темы ──
    // ⚠️ Сбой модели здесь НЕ отменяет группировку целиком: ниже есть доменный слой, который
    // работает без неё вовсе. Модель может быть не скачана, выгружена или не влезть в занятую
    // видеопамять — и в каждом из этих случаев собрать вкладки одного сайта мы всё равно можем.
    // Ошибку возвращаем только если в итоге не набралось НИ ОДНОЙ группы (см. конец функции).
    const maxTopics = topicBudget(unique.length);
    const topicsRes = await runTabOrganizePrompt(buildTopicsPrompt(lines, maxTopics));
    if (!topicsRes.ok) {
      console.warn('[organize] модель недоступна, остаётся группировка по сайту:', topicsRes.error);
      modelError = { error: topicsRes.error, errorCode: topicsRes.errorCode };
    }
    const rawTopics = topicsRes.ok ? topicsRes.out.trim() : '';
    const topics = parseTopics(rawTopics, maxTopics);
    console.log(`[organize] темы (${unique.length} вкладок, бюджет ${maxTopics}, ${duplicates.length} дублей): ${JSON.stringify(topics)}, ответ модели: ${JSON.stringify(rawTopics.slice(0, 160))}`);

    // ── Фаза 2: по вкладке за прогон ──
    // Тем нет — нормальный исход: модель не нашла, вокруг чего собирать. Ничего не выдумываем.
    if (topics.length > 0) {
      // Сначала СОБИРАЕМ заявки всех тем, и только потом решаем. Раньше выигрывала первая тема,
      // забравшая вкладку, — и этого достаточно, чтобы испортить всё: замер показал, что первая
      // тема склонна «загребать» лишнее («Расчёт налогов» → рецепт борща и обзор пылесоса), а
      // тема, которой вкладка принадлежит по-настоящему, приходила второй и оставалась ни с чем.
      const claims = new Map<number, string[]>(); // номер вкладки → темы, которые её просят
      for (const topic of topics) {
        const res = await runTabOrganizePrompt(buildTopicMembersPrompt(topic, topics, lines));
        if (!res.ok) {
          // Одна упавшая тема не отменяет остальные.
          console.warn(`[organize] тема «${topic}» не разобрана:`, res.error);
          continue;
        }
        const nums = parseMembers(res.out.trim(), unique.length);
        console.log(`[organize] «${topic}» → [${nums.join(',')}], ответ модели: ${JSON.stringify(res.out.trim().slice(0, 60))}`);
        for (const n of nums) claims.set(n, [...(claims.get(n) ?? []), topic]);
      }

      // ⚠️ Спорную вкладку отдаём теме, заявившей МЕНЬШЕ вкладок. Раньше такая вкладка не
      // попадала никуда — и это оказалось слишком дорого: на живом профиле из семнадцати вкладок
      // в группы попадали три. Причина в том, что широкая тема («Новости») гребёт под себя всё
      // подряд и спорит с конкретной («Криптовалютное законодательство»), после чего обе теряют
      // вкладку. Правило «выигрывает та, что заявила меньше» — это «конкретная сильнее общей»,
      // и оно не зависит от порядка тем, в отличие от прежнего «кто первый».
      const claimCount = new Map<string, number>();
      for (const wanted of claims.values()) {
        for (const t of wanted) claimCount.set(t, (claimCount.get(t) ?? 0) + 1);
      }
      const byTopic = new Map<string, Candidate[]>();
      for (const [num, wanted] of claims) {
        const topic = [...wanted].sort((a, b) => (claimCount.get(a) ?? 0) - (claimCount.get(b) ?? 0))[0]!;
        byTopic.set(topic, [...(byTopic.get(topic) ?? []), unique[num - 1]!]);
      }

      for (const topic of topics) {
        const members = byTopic.get(topic) ?? [];
        // Группа из одной вкладки — не группа: она ничего не упорядочивает, только добавляет
        // уровень вложенности вокруг единственной строки (правило было и в прежней версии).
        if (members.length < 2) continue;
        clusters.push({
          nodeIds: members.map((m) => m.nodeId),
          nodeTypes: members.map((m) => m.nodeType),
          label: topic,
        });
      }
      console.log(`[organize] разложено ${clusters.reduce((s, c) => s + c.nodeIds.length, 0)} из ${unique.length} вкладок в ${clusters.length} групп`);
    }
  }

  // ── Слой 2: один сайт, без модели ──
  //
  // ⚠️ Заводится ПОСЛЕ тематических групп и только для тех вкладок, что остались без группы.
  // Порядок принципиален: тематический слой умеет сшить статьи об одном с РАЗНЫХ сайтов
  // («Криптовалютное законодательство» из snob.ru и kod.ru), и доменная раскладка, применённая
  // первой, разорвала бы такую группу по изданиям.
  //
  // Зачем это вообще нужно, хотя модель у нас неплохая: на живом профиле из семнадцати вкладок
  // четыре были статьями одного издания, и ни одна не попала в группу. Собрать их — работа на
  // одну строку кода, и она не может ошибиться, в отличие от любой модели.
  {
    const grouped = new Set(clusters.flatMap((c) => c.nodeIds));
    const bySite = new Map<string, Candidate[]>();
    for (const c of unique) {
      if (grouped.has(c.nodeId)) continue;
      const site = siteOf(c.url);
      if (!site) continue;
      bySite.set(site, [...(bySite.get(site) ?? []), c]);
    }
    for (const [site, members] of bySite) {
      if (members.length < 2) continue;
      clusters.push({
        nodeIds: members.map((m) => m.nodeId),
        nodeTypes: members.map((m) => m.nodeType),
        // Имя от домена той же функцией, что у правил: afisha.ru → «Afisha».
        label: groupNameFromDomain(site) || site,
      });
    }
  }

  // Группа дублей — добавляется отдельно, после групп модели, без участия модели вообще.
  if (duplicates.length >= 1) {
    clusters.push({
      nodeIds:   duplicates.map((d) => d.nodeId),
      nodeTypes: duplicates.map((d) => d.nodeType),
      label:     'Дубли',
    });
  }

  // Модель не ответила И собрать по сайту тоже нечего — вот теперь это честная ошибка.
  if (modelError && clusters.length === 0) return { ok: false, ...modelError };
  return { ok: true, clusters, modelWasCold };
}

