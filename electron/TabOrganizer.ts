// Qwen-группировка открытых вкладок — замена ClusteringService.ts (эмбеддинг+агломерация в
// renderer) на прямой промпт модели: список вкладок целиком, названия групп придумывает сама
// модель по смыслу, а не частотный разбор слов заголовка (см. ClusteringService.ts::
// extractGroupName). ClusteringService.ts пока НЕ удалена — отдельным коммитом, после того как
// этот путь заработает на практике (см. бриф этого захода).
import type { TabManager } from './TabManager';
import type { HistoryManager } from './HistoryManager';
import type { SidebarNode, TabState, OrganizeCluster, OrganizeProposal } from '../shared/ipc';
import { normalizeForOmnibox } from '../shared/frecency';
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

const SNIPPET_MAX_CHARS = 200;

// Строка N. заголовок | домен | сниппет — сниппет опускается целиком (не выдумываем), если
// страница не проиндексирована (getFirstChunksByUrls ничего не вернул для этого URL).
function buildPromptLines(candidates: Candidate[], snippets: Map<string, string>): string[] {
  return candidates.map((c, i) => {
    const snippet = snippets.get(normalizeForOmnibox(c.url));
    const domain = extractHostname(c.url);
    const base = `${i + 1}. ${c.title} | ${domain}`;
    if (!snippet) return base;
    const trimmed = snippet.length > SNIPPET_MAX_CHARS ? snippet.slice(0, SNIPPET_MAX_CHARS) + '…' : snippet;
    return `${base} | ${trimmed}`;
  });
}

// Пример вывода прямо в промпте — на живой диагностике (история/RAG-заход) формат без примера
// периодически съезжал (копирование сырых строк корпуса вместо краткого "N: причина"), с
// примером сработал устойчиво. Последняя строка — инструкция ДЕЙСТВИЯ, не запрет: модель эхает
// последнее предложение промпта буквально (та же диагностика), поэтому там не может стоять
// «не пиши лишнего» — иначе именно это она и повторит.
function buildPrompt(lines: string[]): string {
  return (
    `Вот список открытых вкладок браузера. Каждая строка пронумерована и содержит заголовок, ` +
    `домен и, если он есть, короткий фрагмент текста страницы:\n\n` +
    `${lines.join('\n')}\n\n` +
    `Сгруппируй вкладки по смыслу — по общей теме, проекту или намерению пользователя, а не по ` +
    `формальному совпадению слов в заголовках. Группа — минимум 2 вкладки. Группировать нужно не ` +
    `всё: то, что не относится ни к одной осмысленной группе, просто не упоминай. Название группы ` +
    `— 2-4 слова по-русски, описывающие суть группы, а не повторяющие заголовок одной из вкладок. ` +
    `Если осмысленных групп нет вообще — это нормальный исход, оставь ответ пустым, не выдумывай ` +
    `группы искусственно.\n\n` +
    `Формат ответа — строго построчно, без вступлений и заключений, по одной группе на строку:\n` +
    `Название группы: номер,номер,номер\n\n` +
    `Пример:\n` +
    `Рабочие письма: 2,5,9\n` +
    `Новости технологий: 1,3\n\n` +
    `Верни группы в указанном формате.`
  );
}

// Парсинг ответа модели ("Название: 1,4,7" построчно) + валидация. Модель может вернуть
// несуществующие номера, повторить номер в двух группах или мусор — невалидное отбрасываем
// молча, не падаем.
function parseAndValidate(raw: string, unique: Candidate[]): OrganizeCluster[] {
  const usedNumbers = new Set<number>(); // конфликт — первое вхождение выигрывает
  const clusters: OrganizeCluster[] = [];

  for (const line of raw.split('\n')) {
    const match = line.match(/^([^:]{1,60}):\s*([\d,\s]+)\s*$/);
    if (!match) continue;
    const label = match[1]!.trim();
    if (!label) continue;

    const numbers = match[2]!
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= unique.length);

    const members: Candidate[] = [];
    for (const n of numbers) {
      if (usedNumbers.has(n)) continue; // уже в другой (более ранней) группе
      usedNumbers.add(n);
      members.push(unique[n - 1]!);
    }

    if (members.length < 2) continue; // группа не меньше 2 после чистки

    clusters.push({
      nodeIds:   members.map((m) => m.nodeId),
      nodeTypes: members.map((m) => m.nodeType),
      label,
    });
  }

  return clusters;
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

  if (unique.length >= 2) {
    const snippets = history.getFirstChunksByUrls(unique.map((c) => c.url));
    const lines = buildPromptLines(unique, snippets);
    const prompt = buildPrompt(lines);

    console.log(`[organize] промпт (${unique.length} вкладок, ${duplicates.length} дублей):\n${prompt}`);
    const result = await runTabOrganizePrompt(prompt);
    if (!result.ok) {
      return { ok: false, error: result.error, errorCode: result.errorCode };
    }
    const { out: raw, stopReason } = result;
    console.log(`[organize] сырой ответ модели:\n${raw}`);

    // Обрыв по лимиту токенов (не eogToken) — последняя строка ответа заведомо неполная (могла
    // потерять номера или название группы целиком), а не осмысленный конец. Отбрасываем только
    // её — остальные строки (уже сгенерированные полностью группы) остаются валидными.
    let cleanRaw = raw;
    if (stopReason !== 'eogToken') {
      const respLines = raw.split('\n');
      const droppedLine = respLines.pop();
      cleanRaw = respLines.join('\n');
      console.warn(
        `[organize] ⚠️ обрыв генерации по лимиту токенов (stopReason=${stopReason}) — ` +
        `последняя строка ответа отброшена как неполная: ${JSON.stringify(droppedLine)}`,
      );
    }

    clusters.push(...parseAndValidate(cleanRaw, unique));
  }

  // Группа дублей — добавляется отдельно, после групп модели, без участия модели вообще.
  if (duplicates.length >= 1) {
    clusters.push({
      nodeIds:   duplicates.map((d) => d.nodeId),
      nodeTypes: duplicates.map((d) => d.nodeType),
      label:     'Дубли',
    });
  }

  return { ok: true, clusters, modelWasCold };
}
