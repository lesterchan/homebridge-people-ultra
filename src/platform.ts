import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { PeopleUltraPlatformAccessory, type PeopleUltraDevice, type PersonDevice, type SensorType } from './platformAccessory.js';
import { PersistenceStore } from './persistence.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

type FakeGatoHistoryConstructor = new (
  accessoryType: 'motion',
  accessory: { displayName: string; log: Logging },
  optionalParams: Record<string, unknown>,
) => Service;

interface LegacyCharacteristicStatics {
  Formats?: Record<string, string>;
  Perms?: Record<string, string>;
  Units?: Record<string, string>;
}

interface PeopleUltraConfig extends PlatformConfig {
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

interface PersonConfig {
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

interface WebhookQueueEntry {
  newState: boolean;
  timeout: ReturnType<typeof setTimeout>;
}

const require = createRequire(import.meta.url);

export class PeopleUltraPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  private readonly discoveredCacheUUIDs: Set<string> = new Set();
  public readonly personAccessories: Map<string, PeopleUltraPlatformAccessory> = new Map();
  public readonly aggregateAccessories: Set<PeopleUltraPlatformAccessory> = new Set();
  public readonly storage: PersistenceStore;
  public readonly FakeGatoHistoryService?: FakeGatoHistoryConstructor;

  private readonly pluginConfig: PeopleUltraConfig;
  private readonly webhookQueue: Map<string, WebhookQueueEntry> = new Map();
  private webhookServer?: Server;

  constructor(
    public readonly log: Logging,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.pluginConfig = config as PeopleUltraConfig;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.storage = new PersistenceStore(join(api.user.storagePath(), 'plugin-persist', PLUGIN_NAME, 'state.json'), log);
    this.FakeGatoHistoryService = this.loadFakeGatoHistoryService();
    if (this.FakeGatoHistoryService) {
      this.installLegacyCharacteristicStatics();
    }

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
      if (this.pluginConfig.webhookEnabled === true) {
        this.startServer();
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.debug('Loading accessory from cache: %s', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  registerPersonAccessory(accessory: PeopleUltraPlatformAccessory) {
    if (accessory.device.kind === 'person') {
      this.personAccessories.set(accessory.device.target, accessory);
    }
  }

  registerAggregateAccessory(accessory: PeopleUltraPlatformAccessory) {
    if (accessory.device.kind === 'aggregate') {
      this.aggregateAccessories.add(accessory);
    }
  }

  refreshAggregateAccessories() {
    for (const accessory of this.aggregateAccessories) {
      accessory.refreshState();
    }
  }

  getAnyoneStateFromCache(): boolean {
    for (const accessory of this.personAccessories.values()) {
      if (accessory.stateCache) {
        return true;
      }
    }
    return false;
  }

  private discoverDevices() {
    this.personAccessories.clear();
    this.aggregateAccessories.clear();
    this.discoveredCacheUUIDs.clear();
    const devices = this.getConfiguredDevices();

    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${device.kind}:${device.id}`);
      const existingAccessory = this.accessories.get(uuid);

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache: %s', existingAccessory.displayName);
        existingAccessory.context.device = device;
        existingAccessory.updateDisplayName(device.name);
        this.api.updatePlatformAccessories([existingAccessory]);
        new PeopleUltraPlatformAccessory(this, existingAccessory as PlatformAccessory<{ device: PeopleUltraDevice }>);
      } else {
        this.log.info('Adding new accessory: %s', device.name);
        const accessory = new this.api.platformAccessory<{ device: PeopleUltraDevice }>(device.name, uuid);
        accessory.context.device = device;
        new PeopleUltraPlatformAccessory(this, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(uuid, accessory);
      }

      this.discoveredCacheUUIDs.add(uuid);
    }

    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.has(uuid)) {
        this.log.info('Removing stale accessory from cache: %s', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
      }
    }
  }

  private getConfiguredDevices(): PeopleUltraDevice[] {
    const people = Array.isArray(this.pluginConfig.people) ? this.pluginConfig.people : [];
    const devices: PeopleUltraDevice[] = people.map((person, index) => this.normalizePerson(person, index));

    if (this.pluginConfig.anyoneSensor === true) {
      devices.push({
        kind: 'aggregate',
        aggregateType: 'anyone',
        id: 'anyone',
        name: this.pluginConfig.anyoneSensorName || 'Anyone',
        type: this.normalizeSensorType(this.pluginConfig.anyoneSensorType, 'Anyone'),
      });
    }

    if (this.pluginConfig.nooneSensor === true) {
      devices.push({
        kind: 'aggregate',
        aggregateType: 'noone',
        id: 'noone',
        name: this.pluginConfig.nooneSensorName || 'No One',
        type: this.normalizeSensorType(this.pluginConfig.nooneSensorType, 'No One'),
      });
    }

    return devices;
  }

  private normalizePerson(person: PersonConfig, index: number): PersonDevice {
    const name = person.name || `People Sensor ${index + 1}`;
    const target = person.target || '127.0.0.1';

    if (!person.target) {
      this.log.warn('No target was given for %s. Defaulting to 127.0.0.1.', name);
    }

    return {
      kind: 'person',
      id: `${name}:${target}`,
      name,
      target,
      type: this.normalizeSensorType(person.type, name),
      threshold: person.threshold || this.pluginConfig.threshold || 15,
      pingInterval: person.pingInterval ?? this.pluginConfig.pingInterval ?? 10000,
      pingUseArp: person.pingUseArp ?? false,
      customDns: this.normalizeCustomDns(person),
      excludeFromWebhook: person.excludeFromWebhook ?? false,
      ignoreWebhookReEnter: person.ignoreWebhookReEnter ?? 0,
    };
  }

  private normalizeSensorType(type: SensorType | undefined, sensorName: string): SensorType {
    if (type === 'motion' || type === 'occupancy') {
      return type;
    }

    if (type !== undefined) {
      this.log.warn('Type "%s" for sensor %s is invalid. Defaulting to motion.', type, sensorName);
    }

    return 'motion';
  }

  private normalizeCustomDns(person: PersonConfig): string[] | false {
    if (person.enableCustomDns === false || !person.customDns) {
      return false;
    }

    return Array.isArray(person.customDns) ? person.customDns : [person.customDns];
  }

  private startServer() {
    if (this.webhookServer) {
      return;
    }

    const webhookPort = this.pluginConfig.webhookPort || 51828;
    this.webhookServer = createServer((request, response) => this.handleWebhook(request, response));
    this.webhookServer.listen(webhookPort, () => {
      this.log.info('Webhook: Started webserver on port %s.', webhookPort);
    });
    this.webhookServer.on('error', (error) => {
      this.log.error('Webhook server error: %s', error.message);
    });
  }

  private handleWebhook(request: IncomingMessage, response: ServerResponse) {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const sensor = requestUrl.searchParams.get('sensor');
    const state = requestUrl.searchParams.get('state');

    if (!sensor || state === null) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Webhook error: No sensor or state specified in request.');
      return;
    }

    const newState = state === 'true';
    this.log.info('Received webhook for %s -> %s', sensor.toLowerCase(), newState);

    let found = false;
    for (const accessory of this.personAccessories.values()) {
      const device = accessory.device as PersonDevice;
      if (device.name.toLowerCase() === sensor.toLowerCase()) {
        found = true;
        if (device.excludeFromWebhook !== true) {
          this.queueWebhook(device, newState);
        }
        break;
      }
    }

    if (!found) {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: false, error: `No sensor found matching "${sensor}".` }));
      return;
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ success: true }));
  }

  private queueWebhook(device: PersonDevice, newState: boolean) {
    const existingQueueEntry = this.webhookQueue.get(device.target);
    if (existingQueueEntry) {
      clearTimeout(existingQueueEntry.timeout);
    }

    this.webhookQueue.set(device.target, {
      newState,
      timeout: setTimeout(() => this.runWebhookFromQueueForTarget(device.target), device.ignoreWebhookReEnter * 1000),
    });
  }

  private runWebhookFromQueueForTarget(target: string) {
    const webhookQueueEntry = this.webhookQueue.get(target);
    const accessory = this.personAccessories.get(target);
    if (!webhookQueueEntry || !accessory) {
      return;
    }

    this.log.info('Running webhook for %s -> %s', target, webhookQueueEntry.newState);
    this.webhookQueue.delete(target);
    this.storage.setNumber(`lastWebhook_${target}`, Date.now());
    accessory.setNewState(webhookQueueEntry.newState);
  }

  private loadFakeGatoHistoryService(): FakeGatoHistoryConstructor | undefined {
    try {
      const fakeGatoFactory = require('fakegato-history') as (homebridge: object) => FakeGatoHistoryConstructor;
      return fakeGatoFactory({ hap: this.api.hap, user: this.api.user });
    } catch (error) {
      this.log.warn('Fakegato history support is unavailable: %s', (error as Error).message);
      return undefined;
    }
  }

  private installLegacyCharacteristicStatics() {
    const Characteristic = this.api.hap.Characteristic as typeof this.api.hap.Characteristic & LegacyCharacteristicStatics;

    Characteristic.Formats ??= {
      BOOL: 'bool',
      INT: 'int',
      FLOAT: 'float',
      STRING: 'string',
      UINT8: 'uint8',
      UINT16: 'uint16',
      UINT32: 'uint32',
      UINT64: 'uint64',
      DATA: 'data',
      TLV8: 'tlv8',
    };

    Characteristic.Perms ??= {
      READ: 'pr',
      WRITE: 'pw',
      NOTIFY: 'ev',
      HIDDEN: 'hd',
    };

    Characteristic.Units ??= {
      CELSIUS: 'celsius',
      PERCENTAGE: 'percentage',
      ARC_DEGREE: 'arcdegrees',
      LUX: 'lux',
      SECONDS: 'seconds',
    };
  }
}