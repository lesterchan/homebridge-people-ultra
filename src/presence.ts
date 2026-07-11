/**
 * Pure presence-detection predicates.
 *
 * These functions hold the timestamp math that drives sensor state. They take
 * plain values (millisecond epochs, threshold in minutes, the current time) so
 * they can be unit-tested without a Homebridge accessory or persistence store.
 * `PeopleUltraPlatformAccessory` wraps them and supplies the stored timestamps.
 */

/** Milliseconds represented by a threshold given in minutes. */
export function thresholdMs(thresholdMinutes: number): number {
  return thresholdMinutes * 60 * 1000;
}

/** True when the most recent successful ping is within the threshold window. */
export function isActive(lastSuccessfulPing: number | undefined, thresholdMinutes: number, now: number): boolean {
  if (!lastSuccessfulPing) {
    return false;
  }

  return lastSuccessfulPing > now - thresholdMs(thresholdMinutes);
}

/**
 * True when there is no usable webhook signal — either none was ever received,
 * or the last one is older than the threshold window. When false, a fresh
 * webhook takes precedence over polling.
 */
export function webhookIsOutdated(lastWebhook: number | undefined, thresholdMinutes: number, now: number): boolean {
  if (!lastWebhook) {
    return true;
  }

  return lastWebhook < now - thresholdMs(thresholdMinutes);
}

/**
 * True when the last successful ping is more recent than the last webhook, so a
 * ping result is allowed to override the webhook state.
 */
export function successfulPingOccurredAfterWebhook(
  lastSuccessfulPing: number | undefined,
  lastWebhook: number | undefined,
): boolean {
  if (!lastSuccessfulPing) {
    return false;
  }

  return !lastWebhook || lastSuccessfulPing > lastWebhook;
}
