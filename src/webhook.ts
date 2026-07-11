/**
 * Pure webhook request parsing and sensor matching.
 *
 * The HTTP plumbing (server, response writing, debounce timers) stays in
 * `PeopleUltraPlatform`; these helpers hold the parsing and name-matching
 * decisions so they can be unit-tested without a running server.
 */

import type { PersonDevice } from './platformAccessory.js';

export interface ParsedWebhook {
  /** The raw sensor name from the query string (not lower-cased). */
  sensor: string;
  /** The requested state — true unless the `state` param is anything other than "true". */
  newState: boolean;
}

/**
 * Parses the `sensor` and `state` query parameters from a webhook request URL.
 * Returns null when either required parameter is absent.
 */
export function parseWebhookRequest(rawUrl: string | undefined, host: string | undefined): ParsedWebhook | null {
  const url = new URL(rawUrl || '/', `http://${host || 'localhost'}`);
  const sensor = url.searchParams.get('sensor');
  const state = url.searchParams.get('state');

  if (!sensor || state === null) {
    return null;
  }

  return { sensor, newState: state === 'true' };
}

/** Finds the person whose name matches the sensor (case-insensitive), or undefined. */
export function matchSensor(devices: Iterable<PersonDevice>, sensor: string): PersonDevice | undefined {
  const wanted = sensor.toLowerCase();

  for (const device of devices) {
    if (device.name.toLowerCase() === wanted) {
      return device;
    }
  }

  return undefined;
}
