import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isActive,
  successfulPingOccurredAfterWebhook,
  thresholdMs,
  webhookIsOutdated,
} from '../src/presence.js';

const NOW = 600_000; // arbitrary fixed "now" in ms
const THRESHOLD = 15; // minutes
const WINDOW = THRESHOLD * 60 * 1000; // 900_000 ms

test('thresholdMs converts minutes to milliseconds', () => {
  assert.equal(thresholdMs(15), 900_000);
  assert.equal(thresholdMs(0), 0);
});

test('isActive is false when there is no ping timestamp', () => {
  assert.equal(isActive(undefined, THRESHOLD, NOW), false);
  assert.equal(isActive(0, THRESHOLD, NOW), false);
});

test('isActive is true for a ping inside the threshold window', () => {
  assert.equal(isActive(NOW - 60_000, THRESHOLD, NOW), true);
});

test('isActive is false for a ping exactly at or beyond the window edge', () => {
  assert.equal(isActive(NOW - WINDOW, THRESHOLD, NOW), false);
  assert.equal(isActive(NOW - WINDOW - 1, THRESHOLD, NOW), false);
});

test('webhookIsOutdated is true when no webhook has been received', () => {
  assert.equal(webhookIsOutdated(undefined, THRESHOLD, NOW), true);
  assert.equal(webhookIsOutdated(0, THRESHOLD, NOW), true);
});

test('webhookIsOutdated is false for a fresh webhook inside the window', () => {
  assert.equal(webhookIsOutdated(NOW - 60_000, THRESHOLD, NOW), false);
});

test('webhookIsOutdated is true once the webhook falls outside the window', () => {
  assert.equal(webhookIsOutdated(NOW - WINDOW - 1, THRESHOLD, NOW), true);
});

test('successfulPingOccurredAfterWebhook is false without a ping', () => {
  assert.equal(successfulPingOccurredAfterWebhook(undefined, NOW), false);
});

test('successfulPingOccurredAfterWebhook is true when no webhook exists', () => {
  assert.equal(successfulPingOccurredAfterWebhook(NOW, undefined), true);
});

test('successfulPingOccurredAfterWebhook compares timestamps', () => {
  assert.equal(successfulPingOccurredAfterWebhook(NOW, NOW - 1), true);
  assert.equal(successfulPingOccurredAfterWebhook(NOW - 1, NOW), false);
  assert.equal(successfulPingOccurredAfterWebhook(NOW, NOW), false);
});
