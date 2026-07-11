import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getConfiguredDevices,
  normalizeCustomDns,
  normalizePerson,
  normalizeSensorType,
  type PeopleUltraConfig,
} from '../src/config.js';

// A logger that records the messages it was asked to warn about.
function makeLog() {
  const warnings: string[] = [];
  return {
    warnings,
    warn(message: string, ...params: unknown[]) {
      void params;
      warnings.push(message);
    },
  };
}

// Build a valid PeopleUltraConfig from a partial without repeating the platform field.
function cfg(partial: Partial<PeopleUltraConfig> = {}): PeopleUltraConfig {
  return { platform: 'PeopleUltra', ...partial } as PeopleUltraConfig;
}

test('normalizeSensorType passes through valid types without warning', () => {
  const log = makeLog();
  assert.equal(normalizeSensorType('motion', 'A', log), 'motion');
  assert.equal(normalizeSensorType('occupancy', 'A', log), 'occupancy');
  assert.equal(log.warnings.length, 0);
});

test('normalizeSensorType defaults undefined to motion silently', () => {
  const log = makeLog();
  assert.equal(normalizeSensorType(undefined, 'A', log), 'motion');
  assert.equal(log.warnings.length, 0);
});

test('normalizeSensorType warns and defaults to motion for an invalid type', () => {
  const log = makeLog();
  assert.equal(normalizeSensorType('bogus' as never, 'A', log), 'motion');
  assert.equal(log.warnings.length, 1);
});

test('normalizeCustomDns is false when disabled or unset', () => {
  assert.equal(normalizeCustomDns({ enableCustomDns: false, customDns: '1.1.1.1' }), false);
  assert.equal(normalizeCustomDns({}), false);
  assert.equal(normalizeCustomDns({ customDns: '' }), false);
});

test('normalizeCustomDns wraps a single server and preserves an array', () => {
  assert.deepEqual(normalizeCustomDns({ customDns: '1.1.1.1' }), ['1.1.1.1']);
  assert.deepEqual(normalizeCustomDns({ customDns: ['1.1.1.1', '8.8.8.8'] }), ['1.1.1.1', '8.8.8.8']);
  assert.deepEqual(normalizeCustomDns({ enableCustomDns: true, customDns: '9.9.9.9' }), ['9.9.9.9']);
});

test('normalizePerson applies all defaults for an empty entry and warns on missing target', () => {
  const log = makeLog();
  const device = normalizePerson({}, 0, cfg(), log);
  assert.deepEqual(device, {
    kind: 'person',
    id: 'People Sensor 1:127.0.0.1',
    name: 'People Sensor 1',
    target: '127.0.0.1',
    type: 'motion',
    threshold: 15,
    pingInterval: 10000,
    pingUseArp: false,
    customDns: false,
    excludeFromWebhook: false,
    ignoreWebhookReEnter: 0,
  });
  assert.equal(log.warnings.length, 1); // the missing-target warning
});

test('normalizePerson does not warn when a target is provided', () => {
  const log = makeLog();
  const device = normalizePerson({ name: 'Phone', target: '10.0.0.5' }, 0, cfg(), log);
  assert.equal(device.id, 'Phone:10.0.0.5');
  assert.equal(device.target, '10.0.0.5');
  assert.equal(log.warnings.length, 0);
});

test('normalizePerson threshold falls back through person, config, then 15', () => {
  const log = makeLog();
  assert.equal(normalizePerson({ threshold: 5 }, 0, cfg({ threshold: 30 }), log).threshold, 5);
  assert.equal(normalizePerson({}, 0, cfg({ threshold: 30 }), log).threshold, 30);
  assert.equal(normalizePerson({}, 0, cfg(), log).threshold, 15);
  // threshold uses ||, so a configured 0 is treated as unset and falls back to 15.
  assert.equal(normalizePerson({ threshold: 0 }, 0, cfg(), log).threshold, 15);
});

test('normalizePerson pingInterval uses ?? so an explicit 0 is preserved', () => {
  const log = makeLog();
  assert.equal(normalizePerson({ pingInterval: 0 }, 0, cfg({ pingInterval: 5000 }), log).pingInterval, 0);
  assert.equal(normalizePerson({}, 0, cfg({ pingInterval: 5000 }), log).pingInterval, 5000);
  assert.equal(normalizePerson({}, 0, cfg(), log).pingInterval, 10000);
});

test('getConfiguredDevices returns an empty list when there are no people or aggregates', () => {
  assert.deepEqual(getConfiguredDevices(cfg(), makeLog()), []);
  assert.deepEqual(getConfiguredDevices(cfg({ people: 'nope' as never }), makeLog()), []);
});

test('getConfiguredDevices builds people plus both aggregate sensors', () => {
  const log = makeLog();
  const devices = getConfiguredDevices(
    cfg({
      people: [{ name: 'Phone', target: '10.0.0.5' }],
      anyoneSensor: true,
      nooneSensor: true,
    }),
    log,
  );

  assert.equal(devices.length, 3);
  assert.equal(devices[0].kind, 'person');
  assert.deepEqual(
    devices.slice(1).map((d) => [d.kind, d.id, d.name]),
    [
      ['aggregate', 'anyone', 'Anyone'],
      ['aggregate', 'noone', 'No One'],
    ],
  );
});

test('getConfiguredDevices honours custom aggregate names and types', () => {
  const log = makeLog();
  const devices = getConfiguredDevices(
    cfg({ anyoneSensor: true, anyoneSensorName: 'Somebody', anyoneSensorType: 'occupancy' }),
    log,
  );

  assert.equal(devices.length, 1);
  assert.equal(devices[0].name, 'Somebody');
  assert.equal(devices[0].type, 'occupancy');
});
