import assert from 'node:assert/strict';
import { parseRerankIndices } from '../shared/rerankOutput.ts';

assert.deepEqual(parseRerankIndices(' 2, 0, 2, 5 ', 6), [2, 0, 5]);
assert.deepEqual(parseRerankIndices(' \n ', 6), []);
assert.throws(() => parseRerankIndices('Вот кандидаты 2,0,5', 6));
assert.throws(() => parseRerankIndices('2, 7', 6));
assert.throws(() => parseRerankIndices('2\n0', 6));
console.log('Список реранка принимает только номера существующих кандидатов');
