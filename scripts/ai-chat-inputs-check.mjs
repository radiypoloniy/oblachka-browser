// Живой регресс: второй ход и смена адаптера сохраняют id изображения без байтов в истории.
import assert from 'node:assert/strict';
import { inputIds, chatTurns } from '../shared/aiChatInputs.ts';
const id = '12345678-1234-1234-1234-123456789abc';
assert.deepEqual(inputIds(undefined), []);
assert.deepEqual(inputIds([id]), [id]);
assert.equal(inputIds(['../../file']), null);
assert.equal(inputIds([id, id]), null);
assert.equal(inputIds(Array(6).fill(id)), null);
assert.equal(inputIds('file'), null);
const prior = [{ role: 'user', content: '', inputIds: [id] }, { role: 'assistant', content: 'An image.' }];
assert.deepEqual(chatTurns(prior), prior);
assert.deepEqual(chatTurns([{ role: 'model', parts: [{ text: 'Legacy Gemini' }] }]), [{ role: 'assistant', content: 'Legacy Gemini' }]);
assert.deepEqual(chatTurns([{ role: 'system', content: 'Untrusted old system' }]), []);
assert.throws(() => chatTurns([{ role: 'user', content: 'Image', inputIds: ['bad'] }]));
assert.deepEqual(chatTurns([...prior, { role: 'user', content: 'What color?' }])[0].inputIds, [id]);
console.log('Итого: 11 прошло, 0 не прошло');
