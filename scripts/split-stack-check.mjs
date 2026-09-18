// Стопка хранит ссылки на вкладки, но не владеет их жизненным циклом.
// Проверяем, что замена/удаление/обмен сторон не дублируют id и не портят текущую пару.
import assert from 'node:assert/strict';
import { SplitPairRegistry } from '../electron/SplitPairRegistry.ts';

const registry = new SplitPairRegistry();
const pair = {
  leftId: 'article', rightId: 'notes', activePanel: 'left', splitRatio: 0.5,
  leftStack: [], rightStack: [],
};
registry.add(pair);

assert.equal(registry.replacePanel(pair, 'article', 'search'), 'left');
assert.deepEqual(pair.leftStack, ['article']);
assert.equal(pair.leftId, 'search');

assert.equal(registry.replacePanel(pair, 'search', 'article'), 'left');
assert.deepEqual(pair.leftStack, ['search']);
assert.equal(pair.leftId, 'article');

assert.equal(registry.replacePanel(pair, 'notes', 'mail'), 'right');
assert.deepEqual(pair.rightStack, ['notes']);
registry.swap(pair);
assert.equal(pair.leftId, 'mail');
assert.deepEqual(pair.leftStack, ['notes']);
assert.deepEqual(pair.rightStack, ['search']);

registry.forget('notes');
assert.deepEqual(pair.leftStack, []);
assert.equal(pair.leftId, 'mail');
assert.equal(pair.rightId, 'article');

console.log('ok split stack: замена, возврат, перестановка и удаление связи');
