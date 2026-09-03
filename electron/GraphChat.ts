import type { GraphStore } from './GraphStore';
import { computeNodeInputHash, contextForNode } from './GraphEngine';
import { runChatMessage } from './TranslationService';

// Диалог узла-чата. Отдельный модуль, а не часть GraphEngine: движок гоняет граф по
// топологии и обязан быть предсказуемым, а тут — интерактивный обмен репликами, который
// начинает человек, и закончиться он может когда угодно.
//
// Что течёт дальше по графу: ПОСЛЕДНИЙ ответ модели. Вся переписка живёт рядом как
// контекст для модели и история для человека, но соседние узлы её не видят — иначе в них
// поехали бы вопросы пользователя вперемешку с ответами.

export interface ChatSink {
  chunk: (text: string) => void;
  done: (outcome: { ok: boolean; text?: string; error?: string }) => void;
}

// Один активный обмен на узел: пока модель отвечает, второй вопрос слать некуда —
// у node-llama-cpp всё равно один контекст, и второй запрос просто встал бы в очередь,
// а человек видел бы зависшее поле ввода.
const busy = new Set<string>();

export function isChatBusy(graphId: number, nodeId: string): boolean {
  return busy.has(`${graphId}:${nodeId}`);
}

export async function sendChatMessage(
  store: GraphStore,
  graphId: number,
  nodeId: string,
  text: string,
  sink: ChatSink,
): Promise<void> {
  const key = `${graphId}:${nodeId}`;
  const question = text.trim();
  if (!question) { sink.done({ ok: false, error: 'Пустой вопрос' }); return; }
  if (busy.has(key)) { sink.done({ ok: false, error: 'Модель ещё отвечает' }); return; }

  const doc = store.get(graphId);
  if (!doc) { sink.done({ ok: false, error: 'Граф не найден' }); return; }

  // Историю берём в том виде, в каком её вернул сам node-llama-cpp: формат opaque и
  // принадлежит библиотеке, собирать его руками — напрашиваться на поломку при обновлении.
  const history = store.getChatHistory(graphId, nodeId);

  // Материал со входа подмешиваем ТОЛЬКО в первую реплику: дальше он уже в истории, и
  // повторять его в каждом вопросе значило бы раздувать контекст и топить сам вопрос.
  let prompt = question;
  if (history.length === 0) {
    const material = contextForNode(doc, nodeId);
    if (material) {
      prompt = `Опирайся на приведённый материал.\n\n${material}\n\nВопрос: ${question}`;
    }
  }

  busy.add(key);
  // Реплику человека пишем СРАЗУ: если модель упадёт или приложение закроется на середине,
  // вопрос не должен пропасть — переспрашивать его вручную обиднее всего.
  store.appendChatMessage(graphId, nodeId, 'user', question);

  try {
    const outcome = await runChatMessage(prompt, history, (chunk) => sink.chunk(chunk), undefined, 'notebook');
    if (!outcome.ok) { sink.done({ ok: false, error: String(outcome.error) }); return; }
    const answer = outcome.out.trim();
    if (!answer) { sink.done({ ok: false, error: 'Модель вернула пустой ответ' }); return; }

    // ⚠️ Наружу по графу течёт только ТЕКСТ ответа: соседний узел ждёт материал, который умеет
    // подставить в свой промпт, а картинку подставить некуда. Вложения остаются у переписки.
    const files = outcome.files;
    store.appendChatMessage(graphId, nodeId, 'assistant', answer, files.length ? JSON.stringify(files) : null);
    if (Array.isArray(outcome.history)) store.setChatHistory(graphId, nodeId, outcome.history);
    // Наружу узел отдаёт последний ответ. Отпечаток берём тот же, что посчитал бы движок,
    // — тогда прогон графа не станет пересчитывать узел, у которого уже есть свежий ответ.
    const fresh = store.get(graphId);
    store.setNodeResult(graphId, nodeId, {
      inputHash: fresh ? computeNodeInputHash(fresh, nodeId) : null,
      output: answer,
      outputTitle: null,
      error: null,
    });
    sink.done({ ok: true, text: answer });
  } catch (e) {
    sink.done({ ok: false, error: (e as Error).message || 'Не получилось' });
  } finally {
    busy.delete(key);
  }
}
