import { createHash } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { GraphDoc, GraphNode, GraphProgress } from '../shared/graph';
import { downstreamOf, topoOrder, upstreamOf } from '../shared/graph';
import type { GraphStore } from './GraphStore';
import { extractUrlText } from './NotebookExtract';
import { generateStudio, type StudioKind } from './NotebookStudio';
import { runChatMessage } from './TranslationService';

// Исполнитель графа. Живёт в main, потому что ему нужны Qwen и фоновое извлечение страниц;
// renderer только рисует холст и просит «посчитай», результаты приезжают событиями.
//
// ⚠️ Узлы считаются СТРОГО ПОСЛЕДОВАТЕЛЬНО, в топологическом порядке. Это не упрощение на
// первое время: у node-llama-cpp один общий контекст на всё приложение, и TranslationService
// уже заворачивает все входы в withQwenQueue (см. его qwenQueueTail). Запустить два
// Qwen-узла разом всё равно не выйдет — они встанут в ту же очередь, только пользователь
// увидит «считаются оба» вместо честного «второй ждёт». Параллелить имело бы смысл лишь
// сетевые source.url, но ради этого расходиться с очередью модели не стоит.

// Тот же бюджет, что у грунтинга блокнота (src/newtab/notebook.ts): модель локальная и
// небольшая, длинный ввод не столько не влезает, сколько замедляет ответ.
const CONTEXT_MAX_CHARS = 24_000;

export type ProgressSink = (p: GraphProgress) => void;

// Токен отмены на граф. Прервать УЖЕ ИДУЩУЮ генерацию нельзя — node-llama-cpp не даёт
// прервать session.prompt(), а рвать общий контекст ради одного узла значит уронить
// перевод и AI-панель заодно. Поэтому отмена честно означает «не начинать следующий узел».
const running = new Map<number, { cancelled: boolean }>();

export function isGraphRunning(graphId: number): boolean {
  return running.has(graphId);
}

export function cancelGraphRun(graphId: number): void {
  const token = running.get(graphId);
  if (token) token.cancelled = true;
}

// Отпечаток входов: тип узла + его конфиг + тексты, пришедшие на вход. Совпал с сохранённым —
// пересчитывать нечего. Именно поэтому правка одного узла не гонит весь граф заново.
function hashInputs(node: GraphNode, inputs: string[]): string {
  return createHash('sha256')
    .update(JSON.stringify({ kind: node.kind, config: node.config, inputs }))
    .digest('hex');
}

function collectInputs(doc: GraphDoc, nodeId: string, outputs: Map<string, string>): string[] {
  const result: string[] = [];
  for (const e of doc.edges) {
    if (e.toNode !== nodeId) continue;
    const value = outputs.get(e.fromNode);
    if (value) result.push(value);
  }
  return result;
}

function buildContext(inputs: string[]): string {
  let total = 0;
  const parts: string[] = [];
  for (const raw of inputs) {
    const chunk = raw.trim();
    if (!chunk) continue;
    if (total + chunk.length > CONTEXT_MAX_CHARS) {
      const left = CONTEXT_MAX_CHARS - total;
      if (left > 0) parts.push(chunk.slice(0, left));
      break;
    }
    parts.push(chunk);
    total += chunk.length;
  }
  return parts.join('\n\n---\n\n');
}

interface NodeOutcome {
  ok: boolean;
  output?: string;
  outputTitle?: string;
  error?: string;
}

// ── Помощь узлу-веб-приложению ───────────────────────────────────────────────
// Прогонять его движок не может: обмен идёт через руку человека (см. graphWebApps.ts).
// Поэтому наружу отдаются две чистые функции — панель спрашивает ими «что вставлять»
// и «каким отпечатком помечать пойманный ответ», а состояние нигде не дублируется.

function inputsForNode(doc: GraphDoc, nodeId: string): string[] {
  const outputs = new Map<string, string>();
  for (const n of doc.nodes) if (n.output) outputs.set(n.id, n.output);
  return collectInputs(doc, nodeId, outputs);
}

// Отпечаток входов узла по СОХРАНЁННОМУ графу. Нужен, чтобы пойманный человеком ответ
// лёг в базу с тем же хешем, что посчитал бы движок: тогда ответ живёт ровно до правки
// входов и не пересчитывается зря.
export function computeNodeInputHash(doc: GraphDoc, nodeId: string): string | null {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  return hashInputs(node, inputsForNode(doc, nodeId));
}

// Текст, который кнопка «Вставить» кладёт в поле чужого чата.
export function composeWebAppPrompt(doc: GraphDoc, nodeId: string): string {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return '';
  const instruction = (node.config.instruction ?? '').trim();
  const context = buildContext(inputsForNode(doc, nodeId));
  if (!context) return instruction;
  return instruction ? `${instruction}\n\n${context}` : context;
}

async function executeNode(
  win: BrowserWindow | null,
  node: GraphNode,
  inputs: string[],
  onChunk: (text: string) => void,
): Promise<NodeOutcome> {
  switch (node.kind) {
    case 'source.note': {
      const text = (node.config.text ?? '').trim();
      return text ? { ok: true, output: text } : { ok: false, error: 'Заметка пустая' };
    }

    case 'source.url': {
      const url = (node.config.url ?? '').trim();
      if (!url) return { ok: false, error: 'Не указан адрес' };
      if (!win) return { ok: false, error: 'Окно недоступно' };
      const res = await extractUrlText(win, url);
      if (!res.ok || !res.text) return { ok: false, error: 'Не удалось прочитать страницу' };
      return { ok: true, output: res.text, outputTitle: res.title };
    }

    case 'qwen.transform': {
      const instruction = (node.config.instruction ?? '').trim();
      if (!instruction) return { ok: false, error: 'Не задана инструкция' };
      const context = buildContext(inputs);
      // Без входов узел всё равно осмыслен — это просто запрос к модели без материала.
      const prompt = context
        ? `${instruction}\n\nОпирайся ТОЛЬКО на приведённый ниже материал.\n\n${context}`
        : instruction;
      const outcome = await runChatMessage(prompt, [], onChunk);
      if (!outcome.ok) return { ok: false, error: String(outcome.error) };
      const out = outcome.out.trim();
      return out ? { ok: true, output: out } : { ok: false, error: 'Модель вернула пустой ответ' };
    }

    case 'artifact.summary':
    case 'artifact.mindmap':
    case 'artifact.infographic':
    case 'artifact.quiz': {
      const context = buildContext(inputs);
      if (!context) return { ok: false, error: 'На вход не пришёл текст' };
      // Тот же generateStudio, что у блокнота: он сам валидирует JSON теста (normalizeQuiz),
      // поэтому в renderer уезжает уже разобранная структура, а не сырой ответ модели.
      const kind = node.kind.slice('artifact.'.length) as StudioKind;
      const res = await generateStudio(kind, context);
      return res.ok && res.text
        ? { ok: true, output: res.text }
        : { ok: false, error: res.error ?? 'Не получилось' };
    }

    case 'webapp.chat':
      // Сюда поток не доходит: узел перехвачен в runGraph до вызова executeNode (обмен —
      // через руку человека). Ветка оставлена, чтобы switch оставался исчерпывающим.
      return { ok: false, error: 'Этот узел заполняете вы' };

    case 'output.text': {
      const joined = buildContext(inputs);
      return joined ? { ok: true, output: joined } : { ok: false, error: 'На вход ничего не пришло' };
    }

    default:
      return { ok: false, error: 'Неизвестный тип узла' };
  }
}

// targetNodeId=null — считать весь граф. Иначе берём цепочку, которая узел ПИТАЕТ (upstream,
// чтобы входы были свежими), сам узел и всё, что ниже по течению (downstream).
//
// Downstream здесь не роскошь: без него прогон Qwen-узла оставлял «Результат» ниже с прошлым
// содержимым и зелёной галкой «готово» — то есть узел показывал устаревший текст как
// актуальный. Соседние ветки, не связанные с этим узлом, по-прежнему не трогаются.
export async function runGraph(
  win: BrowserWindow | null,
  store: GraphStore,
  graphId: number,
  targetNodeId: string | null,
  emit: ProgressSink,
): Promise<void> {
  if (running.has(graphId)) return; // повторный запуск того же графа игнорируем
  const doc = store.get(graphId);
  if (!doc) return;

  const order = topoOrder(doc.nodes, doc.edges);
  if (!order) {
    emit({
      graphId,
      nodeId: targetNodeId ?? doc.nodes[0]?.id ?? '',
      status: 'error',
      error: 'В графе есть цикл — связи образуют кольцо',
    });
    return;
  }

  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  let scope: Set<string> | null = null;
  if (targetNodeId) {
    scope = upstreamOf(targetNodeId, doc.edges);
    for (const id of downstreamOf([targetNodeId], doc.edges)) scope.add(id);
  }
  const plan = order.filter((id) => byId.has(id) && (!scope || scope.has(id)));

  const token = { cancelled: false };
  running.set(graphId, token);

  // Сразу показываем весь план очередью — иначе при последовательном прогоне выглядит,
  // будто работает один узел, а остальные зависли без объяснения.
  for (const id of plan) emit({ graphId, nodeId: id, status: 'queued' });

  // Тексты, доступные ниже по течению. Кладём и то, что взяли из кэша, — иначе следующий
  // узел не увидит вход и посчитает себя пустым.
  const outputs = new Map<string, string>();
  for (const n of doc.nodes) {
    if (n.output) outputs.set(n.id, n.output);
  }

  // Узлы, чью ветку считать бессмысленно: сами упали или питаются от упавшего. Без этого
  // набора цикл дошёл бы до зависимого узла и посчитал его с неполным входом, выдав
  // правдоподобный, но неверный результат — худший вид ошибки.
  const broken = new Set<string>();
  const planSet = new Set(plan);

  try {
    for (const nodeId of plan) {
      if (token.cancelled) {
        emit({ graphId, nodeId, status: 'idle' });
        continue;
      }
      if (broken.has(nodeId)) {
        emit({ graphId, nodeId, status: 'idle' });
        continue;
      }
      const node = byId.get(nodeId)!;
      const inputs = collectInputs(doc, nodeId, outputs);
      const hash = hashInputs(node, inputs);

      // Кэш: и отпечаток совпал, и результат есть, и прошлый прогон не был ошибкой.
      if (node.inputHash === hash && node.output !== null && !node.error) {
        outputs.set(nodeId, node.output);
        emit({ graphId, nodeId, status: 'done', output: node.output, outputTitle: node.outputTitle ?? undefined });
        continue;
      }

      // Узел-веб-приложение машина посчитать не может — за него отвечает человек.
      // Честно останавливаем ветку в состоянии «ждёт вас», а не делаем вид, что считаем:
      // иначе прогон выглядел бы зависшим. Соседние ветки продолжаются.
      if (node.kind === 'webapp.chat') {
        emit({
          graphId, nodeId, status: 'awaiting',
          error: 'Откройте узел, вставьте промпт, отправьте и заберите ответ',
        });
        for (const dep of downstreamOf([nodeId], doc.edges)) {
          if (dep !== nodeId && planSet.has(dep)) broken.add(dep);
        }
        continue;
      }

      emit({ graphId, nodeId, status: 'running' });
      let outcome: NodeOutcome;
      try {
        outcome = await executeNode(win, node, inputs, (chunk) => {
          emit({ graphId, nodeId, status: 'running', chunk });
        });
      } catch (e) {
        outcome = { ok: false, error: (e as Error).message || 'Узел упал' };
      }

      if (outcome.ok && outcome.output) {
        outputs.set(nodeId, outcome.output);
        store.setNodeResult(graphId, nodeId, {
          inputHash: hash,
          output: outcome.output,
          outputTitle: outcome.outputTitle ?? null,
          error: null,
        });
        emit({ graphId, nodeId, status: 'done', output: outcome.output, outputTitle: outcome.outputTitle });
      } else {
        // Отпечаток при ошибке НЕ сохраняем: иначе повтор без правок счёл бы узел
        // посчитанным и молча пропустил его.
        store.setNodeResult(graphId, nodeId, {
          inputHash: null,
          output: null,
          outputTitle: null,
          error: outcome.error ?? 'Не получилось',
        });
        emit({ graphId, nodeId, status: 'error', error: outcome.error ?? 'Не получилось' });
        // Ветку ниже по течению гасим, соседние ветки продолжаем — они не виноваты.
        for (const id of downstreamOf([nodeId], doc.edges)) {
          if (id !== nodeId && planSet.has(id)) broken.add(id);
        }
      }
    }
  } finally {
    running.delete(graphId);
  }
}
