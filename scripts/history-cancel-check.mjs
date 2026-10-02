import assert from 'node:assert/strict';
import { HistorySearchTasks } from '../electron/HistorySearchTasks.ts';
import { enqueueQwen, QueueCancelled, queueDepth } from '../electron/QwenQueue.ts';
import { assertSearchGenerationComplete } from '../shared/searchGeneration.ts';

const tasks = new HistorySearchTasks();
const first = tasks.start(1, 'first'), neighbour = tasks.start(2, 'neighbour');
const second = tasks.start(1, 'second');
assert.equal(first.signal.aborted, true); assert.equal(neighbour.signal.aborted, false);
tasks.cancel(1, 'first'); tasks.finish(1, first);
assert.equal(second.signal.aborted, false);
tasks.cancel(1, 'second'); assert.equal(second.signal.aborted, true);
let release, ran = false;
const busy = enqueueQwen(() => new Promise(resolve => { release = resolve; }));
const abort = new AbortController();
const waiting = enqueueQwen(async () => { ran = true; }, 'user', abort.signal);
const rejected = assert.rejects(waiting, QueueCancelled);
abort.abort(); await rejected;
assert.equal(queueDepth('user'), 0); assert.equal(ran, false);
release(); await busy;
assert.equal(await enqueueQwen(async () => 'next'), 'next');
for (const reason of ['stop', 'end_turn', 'STOP', 'eogToken']) assert.doesNotThrow(() => assertSearchGenerationComplete(reason));
for (const reason of ['length', 'MAX_TOKENS', 'maxTokens', 'abort', 'content_filter', 'unknown']) {
  assert.throws(() => assertSearchGenerationComplete(reason));
}
console.log('ok: отмена изолирована; ожидающая работа снимается; очередь продолжает работать; обрезка отклоняется');
