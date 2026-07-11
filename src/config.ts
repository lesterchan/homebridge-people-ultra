/**
 * Pure config-normalization helpers.
 *
 * These turn the loosely-typed Homebridge platform config into the strict
 * `PeopleUltraDevice` list the rest of the plugin consumes, applying all of the
 * defaulting rules (target, sensor type, thresholds, custom DNS, aggregates).
 * They take plain config objects plus a minimal logger so they can be
 * unit-tested without a running Homebridge instance.
 */

import type { PlatformConfig } from 'homebridge';

import type { PeopleUltraDevice, PersonDevice, SensorType } from './platformAccessory.js';

export interface PersonConfig {
  name?: string;
  target?: string;
  enableCustomDns?: boolean;
  customDns?: string[] | string;
  type?: SensorType;
  threshold?: number;
  pingInterval?: number;
  pingUseArp?: boolean;
  excludeFromWebhook?: boolean;
  ignoreWebhookReEnter?: number;
}

export interface PeopleUltraConfig extends PlatformConfig {
  anyoneSensor?: boolean;
  anyoneSensorName?: string;
  anyoneSensorType?: SensorType;
  nooneSensor?: boolean;
  nooneSensorName?: string;
  nooneSensorType?: SensorType;
  webhookEnabled?: boolean;
  webhookPort?: number;
  threshold?: number;
  pingInterval?: number;
  people?: PersonConfig[];
}

/** Minimal logger surface used by normalization — satisfied by Homebridge `Logging`. */
export interface NormalizeLogger {
  warn(message: string, ...parameters: unknown[]): void;
}

/** Coerces an arbitrary configured sensor type to a valid `SensorType`, defaulting to motion. */
export function normalizeSensorType(type: SensorType | undefined, sensorName: string, log: NormalizeLogger): SensorType {
  if (type === 'motion' || type === 'occupancy') {
    return type;
  }

  if (type !== undefined) {
    log.warn('Type "%s" for sensor %s is invalid. Defaulting to motion.', type, sensorName);
  }

  return 'motion';
}

/** Resolves the custom DNS setting to a server array, or false when disabled/unset. */
export function normalizeCustomDns(person: PersonConfig): string[] | false {
  if (person.enableCustomDns === false || !person.customDns) {
    return false;
  }

  return Array.isArray(person.customDns) ? person.customDns : [person.customDns];
}

/** Builds a `PersonDevice` from a single person config entry, applying all defaults. */
export function normalizePerson(person: PersonConfig, index: number, config: PeopleUltraConfig, log: NormalizeLogger): PersonDevice {
  const name = person.name || `People Sensor ${index + 1}`;
  const target = person.target || '127.0.0.1';

  if (!person.target) {
    log.warn('No target was given for %s. Defaulting to 127.0.0.1.', name);
  }

  return {
    kind: 'person',
    id: `${name}:${target}`,
    name,
    target,
    type: normalizeSensorType(person.type, name, log),
    threshold: person.threshold || config.threshold || 15,
    pingInterval: person.pingInterval ?? config.pingInterval ?? 10000,
    pingUseArp: person.pingUseArp ?? false,
    customDns: normalizeCustomDns(person),
    excludeFromWebhook: person.excludeFromWebhook ?? false,
    ignoreWebhookReEnter: person.ignoreWebhookReEnter ?? 0,
  };
}

/** Produces the full device list — every configured person plus any enabled aggregate sensors. */
export function getConfiguredDevices(config: PeopleUltraConfig, log: NormalizeLogger): PeopleUltraDevice[] {
  const people = Array.isArray(config.people) ? config.people : [];
  const devices: PeopleUltraDevice[] = people.map((person, index) => normalizePerson(person, index, config, log));

  if (config.anyoneSensor === true) {
    devices.push({
      kind: 'aggregate',
      aggregateType: 'anyone',
      id: 'anyone',
      name: config.anyoneSensorName || 'Anyone',
      type: normalizeSensorType(config.anyoneSensorType, 'Anyone', log),
    });
  }

  if (config.nooneSensor === true) {
    devices.push({
      kind: 'aggregate',
      aggregateType: 'noone',
      id: 'noone',
      name: config.nooneSensorName || 'No One',
      type: normalizeSensorType(config.nooneSensorType, 'No One', log),
    });
  }

  return devices;
}
