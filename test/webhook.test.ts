import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PersonDevice } from '../src/platformAccessory.js';
import { matchSensor, parseWebhookRequest } from '../src/webhook.js';

// matchSensor only reads `.name`, so a minimal cast is sufficient.
function person(name: string): PersonDevice {
  return { kind: 'person', name } as PersonDevice;
}

test('parseWebhookRequest returns null when the sensor is missing', () => {
  assert.equal(parseWebhookRequest('/?state=true', 'localhost'), null);
});

test('parseWebhookRequest returns null when the state is missing', () => {
  assert.equal(parseWebhookRequest('/?sensor=Phone', 'localhost'), null);
});

test('parseWebhookRequest parses sensor and a true state', () => {
  assert.deepEqual(parseWebhookRequest('/?sensor=Phone&state=true', 'localhost'), {
    sensor: 'Phone',
    newState: true,
  });
});

test('parseWebhookRequest treats any non-"true" state as false', () => {
  assert.equal(parseWebhookRequest('/?sensor=Phone&state=false', 'localhost')?.newState, false);
  assert.equal(parseWebhookRequest('/?sensor=Phone&state=1', 'localhost')?.newState, false);
});

test('parseWebhookRequest preserves the raw sensor casing', () => {
  assert.equal(parseWebhookRequest('/?sensor=LivingRoom&state=true', 'localhost')?.sensor, 'LivingRoom');
});

test('parseWebhookRequest tolerates a missing host header', () => {
  assert.equal(parseWebhookRequest('/?sensor=Phone&state=true', undefined)?.sensor, 'Phone');
});

test('matchSensor matches a person name case-insensitively', () => {
  const devices = [person('Living Room'), person('Phone')];
  assert.equal(matchSensor(devices, 'phone')?.name, 'Phone');
  assert.equal(matchSensor(devices, 'LIVING ROOM')?.name, 'Living Room');
});

test('matchSensor returns undefined when nothing matches', () => {
  assert.equal(matchSensor([person('Phone')], 'Tablet'), undefined);
  assert.equal(matchSensor([], 'Phone'), undefined);
});

test('matchSensor returns the first matching person', () => {
  const first = person('Phone');
  const second = person('phone');
  assert.equal(matchSensor([first, second], 'PHONE'), first);
});
