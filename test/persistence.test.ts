import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';

import type { Logging } from 'homebridge';

import { PersistenceStore } from '../src/persistence.js';

// Minimal Logging stub — the store only ever calls warn().
const noopLog = { info() {}, warn() {}, error() {}, debug() {}, log() {} } as unknown as Logging;

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'people-ultra-'));
  return join(dir, 'nested', 'state.json');
}

test('setNumber then getNumber returns the value immediately', () => {
  const store = new PersistenceStore(tempFile(), noopLog);
  store.setNumber('lastSuccessfulPing_127.0.0.1', 1234);
  assert.equal(store.getNumber('lastSuccessfulPing_127.0.0.1'), 1234);
});

test('getNumber is undefined for an unknown key', () => {
  const store = new PersistenceStore(tempFile(), noopLog);
  assert.equal(store.getNumber('missing'), undefined);
});

test('load reads existing numbers and ignores non-number values', () => {
  const file = tempFile();
  // The store mkdir's the directory on construct; create it first for the seed write.
  new PersistenceStore(file, noopLog);
  writeFileSync(file, JSON.stringify({ a: 42, b: 'nope', c: true, d: 0 }), 'utf8');

  const store = new PersistenceStore(file, noopLog);
  assert.equal(store.getNumber('a'), 42);
  assert.equal(store.getNumber('d'), 0);
  assert.equal(store.getNumber('b'), undefined);
  assert.equal(store.getNumber('c'), undefined);
});

test('a missing file loads as empty state without throwing', () => {
  const store = new PersistenceStore(tempFile(), noopLog);
  assert.equal(store.getNumber('anything'), undefined);
});

test('writes are debounced and flushed to disk after 500ms', () => {
  const file = tempFile();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const store = new PersistenceStore(file, noopLog);
    store.setNumber('x', 1);
    store.setNumber('x', 2); // replaces the pending timer

    assert.throws(() => readFileSync(file, 'utf8')); // not written yet
    mock.timers.tick(500);

    const written = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(written.x, 2);
  } finally {
    mock.timers.reset();
    rmSync(file, { force: true });
  }
});

test('flush persists pending state immediately without waiting for the debounce', () => {
  const file = tempFile();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const store = new PersistenceStore(file, noopLog);
    store.setNumber('x', 7);

    assert.throws(() => readFileSync(file, 'utf8')); // debounce has not elapsed
    store.flush();

    assert.equal(JSON.parse(readFileSync(file, 'utf8')).x, 7);
  } finally {
    mock.timers.reset();
    rmSync(file, { force: true });
  }
});

test('flush with no pending write does not create a file or throw', () => {
  const file = tempFile();
  const store = new PersistenceStore(file, noopLog);
  store.flush(); // nothing queued
  assert.throws(() => readFileSync(file, 'utf8')); // still not written
});
