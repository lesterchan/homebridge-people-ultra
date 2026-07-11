import assert from 'node:assert/strict';
import { test } from 'node:test';

import { aggregateState, anyoneActive } from '../src/aggregate.js';

test('anyoneActive is false for an empty set', () => {
  assert.equal(anyoneActive([]), false);
});

test('anyoneActive is false when every person is away', () => {
  assert.equal(anyoneActive([false, false, false]), false);
});

test('anyoneActive is true when at least one person is home', () => {
  assert.equal(anyoneActive([false, true, false]), true);
});

test('anyoneActive short-circuits on the first active state', () => {
  function* states(): Iterable<boolean> {
    yield true;
    throw new Error('should not be reached after the first active state');
  }
  assert.equal(anyoneActive(states()), true);
});

test('aggregateState anyone mirrors the anyone-home flag', () => {
  assert.equal(aggregateState(true, 'anyone'), true);
  assert.equal(aggregateState(false, 'anyone'), false);
});

test('aggregateState noone inverts the anyone-home flag', () => {
  assert.equal(aggregateState(true, 'noone'), false);
  assert.equal(aggregateState(false, 'noone'), true);
});
