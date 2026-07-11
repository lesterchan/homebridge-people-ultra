# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — `rimraf ./dist && tsc`. Compiles `src/` → `dist/`. Always run after source changes.
- `npm run lint` — ESLint with `--max-warnings=0`. CI enforces this; do not bypass.
- `npm run typecheck` — `tsc -p tsconfig.test.json` (`--noEmit` over `src` **and** `test`). The normal build only compiles `src`, so this is what type-checks the test files.
- `npm test` — runs the `node:test` suites in `test/` via the `tsx` loader. No build step needed.
- `npm run test:coverage` — same as `npm test` with `--experimental-test-coverage`.
- `npm run watch` — builds, runs `npm link`, then starts nodemon (restarts Homebridge on `.ts` file changes). Uses `test/hbConfig/config.json` as the Homebridge config.
- `npm run prepublishOnly` — runs `lint`, `typecheck`, `test`, then `build`. Runs automatically before `npm publish`.

CI (`.github/workflows/build.yml`) runs lint → typecheck → build → coverage on Node 22.x and 24.x. Unit tests cover the pure logic modules (see Testing below); end-to-end behavior (real network probes, HAP wiring, the webhook server) is still verified by running Homebridge locally via `npm run watch`.

## Architecture

### Overview

`homebridge-people-ultra` is a Homebridge v2 plugin. It creates HomeKit presence sensors for people or devices on your local network. It is a TypeScript port of the archived [homebridge-people-pro](https://github.com/mfkrause/homebridge-people-pro).

Each configured "person" becomes a HomeKit Motion or Occupancy sensor. Two optional aggregate sensors ("Anyone" / "No One") reflect whether at least one person is home or no one is at home.

### Source files

| File                                    | Purpose                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `src/index.ts`                          | Plugin entry point — registers `PeopleUltraPlatform` with Homebridge        |
| `src/settings.ts`                       | `PLATFORM_NAME` and `PLUGIN_NAME` constants                                 |
| `src/platform.ts`                       | `PeopleUltraPlatform` — device discovery, webhook server, aggregate refresh |
| `src/platformAccessory.ts`              | `PeopleUltraPlatformAccessory` — polling, ping/ARP probes, state management |
| `src/persistence.ts`                    | `PersistenceStore` — JSON file for timestamps, debounced writes             |
| `src/config.ts`                         | Pure config normalization — `getConfiguredDevices`, defaulting, aggregates  |
| `src/presence.ts`                       | Pure presence predicates — `isActive`, `webhookIsOutdated`, `lastActivationSeconds` |
| `src/aggregate.ts`                      | Pure aggregate derivation — `anyoneActive`, `aggregateState`                |
| `src/webhook.ts`                        | Pure webhook parsing + sensor matching — `parseWebhookRequest`, `matchSensor` |
| `src/@types/presence-dependencies.d.ts` | Type declarations for `ping`, `node-arp`, and `local-devices`               |

### Device model

Two discriminated union members share the `PeopleUltraDevice` type:

- **`PersonDevice`** (`kind: 'person'`) — an IP address, hostname, or MAC address to monitor. Holds `target`, `threshold`, `pingInterval`, `pingUseArp`, `customDns`, `excludeFromWebhook`, `ignoreWebhookReEnter`.
- **`AggregateDevice`** (`kind: 'aggregate'`) — a derived sensor. `aggregateType` is either `'anyone'` (active when any person is home) or `'noone'` (active when nobody is home). Never polls; state is recalculated from all `PersonDevice` caches whenever any person changes.

Both are handled by `PeopleUltraPlatformAccessory`. The `device.kind` discriminant gates all person-only code paths.

### Presence detection logic

Presence is determined by two timestamps stored in `PersistenceStore`:

- `lastSuccessfulPing_${target}` — millisecond epoch of the most recent successful ping or ARP probe.
- `lastWebhook_${target}` — millisecond epoch of the most recent webhook trigger.

**`isActive()`** — returns `true` if `lastSuccessfulPing > Date.now() - threshold * 60 * 1000`.

**`webhookIsOutdated()`** — returns `true` if no webhook has been received, or if the last webhook is older than `threshold` minutes. When `false`, the poll cycle runs but does not update state (the webhook result takes precedence).

**`successfulPingOccurredAfterWebhook()`** — returns `true` if the last ping timestamp is more recent than the last webhook. This prevents a stale ping from overriding a fresh webhook.

State only updates via `setNewState()` when all three conditions hold: webhook is outdated **or** ping is newer than webhook.

### Polling loop

`schedulePoll(delay)` sets a `setTimeout` that calls `pollTarget()`. The `finally` block in `pollTarget` always reschedules, so polling continues even after network errors or MAC lookup failures.

```
schedulePoll(0)
  └─ pollTarget()
       ├─ webhookIsOutdated()?
       │    ├─ resolveTarget()   ← MAC→IP via local-devices, optional custom DNS
       │    └─ pingProbe() / arpProbe()
       └─ finally: schedulePoll(pingInterval)
```

`resolveTarget()` handles three target types:

1. **MAC address** — scans local network with `local-devices` to find the matching IP.
2. **Hostname with custom DNS** — uses a scoped `dns/promises.Resolver` instance (never mutates the global resolver).
3. **IP / hostname without custom DNS** — used directly.

Set `pingInterval: -1` to disable polling entirely (webhook-only mode).

### Webhook server

When `webhookEnabled: true`, `PeopleUltraPlatform` starts an HTTP server on `webhookPort` (default 51828).

```
GET /?sensor=<name>&state=true|false
```

The `sensor` value is matched case-insensitively against configured person names. On a match, `queueWebhook` replaces any pending debounce timer for that target. After `ignoreWebhookReEnter` seconds the webhook fires: `lastWebhook_${target}` is saved and `setNewState()` is called.

Returns `404` with `{ success: false }` if the sensor name is not found.

### Aggregate sensors

`PeopleUltraPlatform` maintains two `Map`/`Set` registries:

- `personAccessories` — keyed by `device.target` (IP or hostname).
- `aggregateAccessories` — set of aggregate accessories.

`refreshAggregateAccessories()` is called by every `PersonDevice` state change and by the HAP `onGet` handler. Aggregate state derives entirely from `getAnyoneStateFromCache()`, which iterates `personAccessories` and returns `true` if any `stateCache` is `true`.

### Eve history

Motion sensors (not occupancy) expose three custom Eve characteristics via `configureEveMotionCharacteristics`:

- `LastActivation` (`E863F11A`) — seconds since epoch of last ping, offset by `historyService.getInitialTime()` (computed by `presence.lastActivationSeconds()`).
- `Sensitivity` (`E863F120`) — constant `4`.
- `Duration` (`E863F12D`) — constant `5`.

`fakegato-history` is loaded at runtime using `createRequire` for CommonJS compatibility. The `installLegacyCharacteristicStatics()` shim patches `Characteristic.Formats/Perms/Units` onto the HAP class only if fakegato loaded successfully.

The three Eve characteristic classes are defined lazily and cached in `PeopleUltraPlatformAccessory.eveCharacteristics` (static) so they are only created once per process.

### Persistence

`PersistenceStore` reads and writes a single JSON file at `<storagePath>/plugin-persist/homebridge-people-ultra/state.json`. All values are numbers (millisecond timestamps). Writes are debounced 500 ms to avoid blocking the event loop on rapid ping updates.

### Testing

Unit tests live in `test/*.test.ts` and use Node's built-in `node:test` runner, executed through the `tsx` loader (no separate build). They cover the **pure logic modules** only — `config.ts`, `presence.ts`, `aggregate.ts`, `webhook.ts`, and `persistence.ts` — which is why that logic was extracted out of the Homebridge-coupled classes in the first place.

- Keep these modules free of Homebridge/HAP imports so they stay testable in isolation. `platform.ts` / `platformAccessory.ts` pass in plain values (stored timestamps, config objects, `Date.now()`, `getInitialTime()`) and consume the results.
- When you change presence, config, aggregate, or webhook behavior, add or update a test alongside it.
- Test files are **not** part of the `tsc` build (`tsconfig.json` only includes `src`); `npm run typecheck` (via `tsconfig.test.json`) is what type-checks them, and CI runs it.
- The `PersistenceStore` write test uses `node:test` fake timers (`mock.timers`) to fast-forward the 500 ms debounce.

Network probes, the webhook HTTP server, HAP wiring, and fakegato history are **not** unit-tested — verify those by running Homebridge locally (`npm run watch`).

## Conventions

- TypeScript `strict: true`, `module: nodenext`. Always use `.js` extensions on relative imports in `.ts` files.
- ESM-only (`"type": "module"` in `package.json`). `createRequire` is used only for the `fakegato-history` CJS package.
- ESLint enforces single quotes, 2-space indent, semicolons, trailing commas, and `max-len: 160`. Run `npm run lint` before committing.
- No `console.log` — always use `this.platform.log` (or `this.log` in the platform). Use `log.debug` for verbose diagnostics, `log.info` for state changes, `log.warn` for recoverable config issues, `log.error` for server errors.
- Platform constants (`PLATFORM_NAME`, `PLUGIN_NAME`) must stay in `src/settings.ts` and be imported from there — they are used in both `src/index.ts` and `src/platform.ts`.
