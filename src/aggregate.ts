/**
 * Pure aggregate-sensor helpers.
 *
 * The "Anyone" / "No One" sensors derive their state entirely from the person
 * sensors' cached states. These helpers hold that derivation so it can be
 * unit-tested without any Homebridge accessories.
 */

/** True if at least one person state is active. Short-circuits on the first `true`. */
export function anyoneActive(states: Iterable<boolean>): boolean {
  for (const state of states) {
    if (state) {
      return true;
    }
  }

  return false;
}

/** Resolves an aggregate sensor's state from the "anyone home" flag and its type. */
export function aggregateState(anyoneHome: boolean, aggregateType: 'anyone' | 'noone'): boolean {
  return aggregateType === 'noone' ? !anyoneHome : anyoneHome;
}
