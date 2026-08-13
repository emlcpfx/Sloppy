import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IMMUNE_MESSAGE, immuneMessage, isImmuneAuthor, isImmunePost } from './immune.ts';

test('Eric Levy is immune, a rando is not', () => {
  assert.equal(isImmuneAuthor('li:in:ericlevy'), true);
  assert.equal(isImmuneAuthor('li:company:clean-plate-fx'), true);
  assert.equal(isImmuneAuthor('li:in:sergey-argunov-3d-artist'), false);
  assert.equal(immuneMessage('li:in:ericlevy'), IMMUNE_MESSAGE);
});

test('his specific activity is immune even if the author id misses', () => {
  assert.equal(isImmunePost('urn:li:activity:7493503286445273089'), true);
  assert.equal(isImmunePost('urn:li:activity:1'), false);
  assert.equal(immuneMessage(null, 'urn:li:activity:7493503286445273089'), IMMUNE_MESSAGE);
});
