import { Resolver } from 'node:dns/promises';
import type { Characteristic, PlatformAccessory, Service } from 'homebridge';
import { Formats, Perms, Units } from 'homebridge';

import arp from 'node-arp';
import ping from 'ping';
import find from 'local-devices';

import type { PeopleUltraPlatform } from './platform.js';

export type SensorType = 'motion' | 'occupancy';

export interface PersonDevice {
  kind: 'person';
  id: string;
  name: string;
  target: string;
  type: SensorType;
  threshold: number;
  pingInterval: number;
  pingUseArp: boolean;
  customDns: string[] | false;
  excludeFromWebhook: boolean;
  ignoreWebhookReEnter: number;
}

export interface AggregateDevice {
  kind: 'aggregate';
  aggregateType: 'anyone' | 'noone';
  id: string;
  name: string;
  type: SensorType;
}

export type PeopleUltraDevice = PersonDevice | AggregateDevice;

interface FakeGatoHistoryService extends Service {
  addEntry(entry: { time: number; status: 0 | 1 }): void;
  getInitialTime(): number;
}

interface DeviceContext {
  device: PeopleUltraDevice;
}

type CustomCharacteristicConstructor = (new () => Characteristic) & { UUID: string };

const MAC_ADDRESS_PATTERN = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

export class PeopleUltraPlatformAccessory {
  public readonly device: PeopleUltraDevice;
  public stateCache = false;

  private readonly service: Service;
  private historyService?: FakeGatoHistoryService;
  private pollTimeout?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly platform: PeopleUltraPlatform,
    private readonly accessory: PlatformAccessory<DeviceContext>,
  ) {
    this.device = accessory.context.device;
    this.configureAccessoryInformation();
    this.service = this.configurePrimaryService();

    if (this.device.kind === 'person') {
      this.platform.registerPersonAccessory(this);
      this.stateCache = this.isActive();
      this.configureHistoryService();
      if (this.device.pingInterval > -1) {
        this.schedulePoll(0);
      }
    } else {
      this.platform.registerAggregateAccessory(this);
    }
  }

  setNewState(newState: boolean) {
    if (this.device.kind !== 'person' || this.stateCache === newState) {
      return;
    }

    this.stateCache = newState;
    this.updatePrimaryCharacteristic(newState);
    this.platform.refreshAggregateAccessories();

    if (this.historyService) {
      this.historyService.addEntry({
        time: Math.floor(Date.now() / 1000),
        status: newState ? 1 : 0,
      });
    }

    const lastSuccessfulPing = this.platform.storage.getNumber(`lastSuccessfulPing_${this.device.target}`);
    const lastWebhook = this.platform.storage.getNumber(`lastWebhook_${this.device.target}`);
    const lastSuccessfulPingDate = lastSuccessfulPing ? new Date(lastSuccessfulPing).toISOString() : 'none';
    const lastWebhookDate = lastWebhook ? new Date(lastWebhook).toISOString() : 'none';
    const lookupType = this.device.pingUseArp ? 'arp lookup' : 'ping';

    this.platform.log.info(
      'Changed occupancy state for %s to %s. Last successful %s %s, last webhook %s.',
      this.device.target,
      newState,
      lookupType,
      lastSuccessfulPingDate,
      lastWebhookDate,
    );
  }

  refreshState() {
    this.updatePrimaryCharacteristic(this.getStateFromCache());
  }

  private configureAccessoryInformation() {
    const information = this.accessory.getService(this.platform.Service.AccessoryInformation)
      || this.accessory.addService(this.platform.Service.AccessoryInformation);

    information
      .setCharacteristic(this.platform.Characteristic.Name, this.device.name)
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'People Ultra')
      .setCharacteristic(this.platform.Characteristic.Model, this.device.kind === 'person' ? 'Presence Sensor' : 'Aggregate Presence Sensor')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, `hpu-${this.device.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  }

  private configurePrimaryService(): Service {
    if (this.device.type === 'occupancy') {
      const staleMotionService = this.accessory.getService(this.platform.Service.MotionSensor);
      if (staleMotionService) {
        this.accessory.removeService(staleMotionService);
      }

      const service = this.accessory.getService(this.platform.Service.OccupancySensor)
        || this.accessory.addService(this.platform.Service.OccupancySensor, this.device.name);
      service.setCharacteristic(this.platform.Characteristic.Name, this.device.name);
      service.getCharacteristic(this.platform.Characteristic.OccupancyDetected)
        .onGet(() => this.encodeState(this.getStateFromCache()));
      return service;
    }

    const staleOccupancyService = this.accessory.getService(this.platform.Service.OccupancySensor);
    if (staleOccupancyService) {
      this.accessory.removeService(staleOccupancyService);
    }

    const service = this.accessory.getService(this.platform.Service.MotionSensor)
      || this.accessory.addService(this.platform.Service.MotionSensor, this.device.name);
    service.setCharacteristic(this.platform.Characteristic.Name, this.device.name);
    service.getCharacteristic(this.platform.Characteristic.MotionDetected)
      .onGet(() => this.encodeState(this.getStateFromCache()));
    this.configureEveMotionCharacteristics(service);
    return service;
  }

  private configureEveMotionCharacteristics(service: Service) {
    const Characteristic = this.platform.Characteristic;

    class LastActivationCharacteristic extends Characteristic {
      static readonly UUID = 'E863F11A-079E-48FF-8F27-9C2605A29F52';

      constructor() {
        super('LastActivation', LastActivationCharacteristic.UUID, {
          format: Formats.UINT32,
          unit: Units.SECONDS,
          perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        });
      }
    }

    class DurationCharacteristic extends Characteristic {
      static readonly UUID = 'E863F12D-079E-48FF-8F27-9C2605A29F52';

      constructor() {
        super('Duration', DurationCharacteristic.UUID, {
          format: Formats.UINT16,
          unit: Units.SECONDS,
          minValue: 5,
          maxValue: 15 * 3600,
          validValues: [5, 10, 20, 30, 60, 120, 180, 300, 600, 1200, 1800, 3600, 7200, 10800, 18000, 36000, 43200, 54000],
          perms: [Perms.PAIRED_READ, Perms.NOTIFY, Perms.PAIRED_WRITE],
        });
      }
    }

    class SensitivityCharacteristic extends Characteristic {
      static readonly UUID = 'E863F120-079E-48FF-8F27-9C2605A29F52';

      constructor() {
        super('Sensitivity', SensitivityCharacteristic.UUID, {
          format: Formats.UINT8,
          minValue: 0,
          maxValue: 7,
          validValues: [0, 4, 7],
          perms: [Perms.PAIRED_READ, Perms.NOTIFY, Perms.PAIRED_WRITE],
        });
      }
    }

    this.ensureCharacteristic(service, LastActivationCharacteristic).onGet(() => this.getLastActivation());
    this.ensureCharacteristic(service, SensitivityCharacteristic).onGet(() => 4);
    this.ensureCharacteristic(service, DurationCharacteristic).onGet(() => 5);
  }

  private ensureCharacteristic(service: Service, characteristic: CustomCharacteristicConstructor) {
    if (!service.characteristics.some((existingCharacteristic) => existingCharacteristic.UUID === characteristic.UUID)) {
      service.addOptionalCharacteristic(characteristic);
    }

    return service.getCharacteristic(characteristic)!;
  }

  private configureHistoryService() {
    if (this.device.kind !== 'person' || this.device.type !== 'motion' || !this.platform.FakeGatoHistoryService) {
      return;
    }

    this.historyService = new this.platform.FakeGatoHistoryService('motion', {
      displayName: this.device.name,
      log: this.platform.log,
    }, {
      storage: 'fs',
      disableTimer: true,
    }) as FakeGatoHistoryService;

    const existingHistoryService = this.accessory.services.find((service) => service.UUID === this.historyService?.UUID);
    if (existingHistoryService) {
      this.accessory.removeService(existingHistoryService);
    }

    this.accessory.addService(this.historyService);
  }

  private getStateFromCache(): boolean {
    if (this.device.kind === 'aggregate') {
      const anyoneActive = this.platform.getAnyoneStateFromCache();
      return this.device.aggregateType === 'noone' ? !anyoneActive : anyoneActive;
    }

    return this.stateCache;
  }

  private updatePrimaryCharacteristic(state: boolean) {
    if (this.device.type === 'occupancy') {
      this.service.updateCharacteristic(this.platform.Characteristic.OccupancyDetected, this.encodeState(state));
    } else {
      this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, this.encodeState(state));
    }
  }

  private encodeState(state: boolean) {
    if (this.device.type === 'occupancy') {
      return state
        ? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
        : this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
    }

    return state ? 1 : 0;
  }

  private getLastActivation(): number {
    if (this.device.kind !== 'person') {
      return 0;
    }

    const lastSeen = this.platform.storage.getNumber(`lastSuccessfulPing_${this.device.target}`);
    if (!lastSeen || !this.historyService) {
      return 0;
    }

    return Math.floor(lastSeen / 1000) - this.historyService.getInitialTime();
  }

  private isActive(): boolean {
    if (this.device.kind !== 'person') {
      return this.getStateFromCache();
    }

    const lastSeen = this.platform.storage.getNumber(`lastSuccessfulPing_${this.device.target}`);
    if (!lastSeen) {
      return false;
    }

    return lastSeen > Date.now() - (this.device.threshold * 60 * 1000);
  }

  private schedulePoll(delay: number) {
    if (this.device.kind !== 'person') {
      return;
    }

    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
    }

    this.pollTimeout = setTimeout(() => {
      void this.pollTarget();
    }, delay);
  }

  private async pollTarget() {
    if (this.device.kind !== 'person') {
      return;
    }

    try {
      if (this.webhookIsOutdated()) {
        const target = await this.resolveTarget();
        if (target) {
          const state = this.device.pingUseArp ? await this.arpProbe(target) : await this.pingProbe(target);
          if (this.webhookIsOutdated()) {
            if (state) {
              this.platform.storage.setNumber(`lastSuccessfulPing_${this.device.target}`, Date.now());
            }
            if (this.successfulPingOccurredAfterWebhook()) {
              this.setNewState(this.isActive());
            }
          }
        }
      }
    } catch (error) {
      this.platform.log.debug('Presence check for %s failed: %s', this.device.target, (error as Error).message);
    } finally {
      this.schedulePoll(this.device.pingInterval);
    }
  }

  private async resolveTarget(): Promise<string | false> {
    if (this.device.kind !== 'person') {
      return false;
    }

    let target = this.device.target;

    if (MAC_ADDRESS_PATTERN.test(target)) {
      const devices = await find();
      const device = devices.find((localDevice) => localDevice.mac?.toLowerCase() === target.toLowerCase());
      if (!device) {
        return false;
      }
      target = device.ip;
    }

    if (this.device.customDns !== false) {
      const resolver = new Resolver();
      resolver.setServers(this.device.customDns);
      const records = await resolver.resolve4(target);
      [target] = records;
    }

    return target;
  }

  private async pingProbe(target: string): Promise<boolean> {
    const response = await ping.promise.probe(target);
    return response.alive;
  }

  private arpProbe(target: string): Promise<boolean> {
    return new Promise((resolve) => {
      arp.getMAC(target, (error, mac) => {
        resolve(!error && MAC_ADDRESS_PATTERN.test(mac));
      });
    });
  }

  private webhookIsOutdated(): boolean {
    if (this.device.kind !== 'person') {
      return true;
    }

    const lastWebhook = this.platform.storage.getNumber(`lastWebhook_${this.device.target}`);
    if (!lastWebhook) {
      return true;
    }

    return lastWebhook < Date.now() - (this.device.threshold * 60 * 1000);
  }

  private successfulPingOccurredAfterWebhook(): boolean {
    if (this.device.kind !== 'person') {
      return false;
    }

    const lastSuccessfulPing = this.platform.storage.getNumber(`lastSuccessfulPing_${this.device.target}`);
    if (!lastSuccessfulPing) {
      return false;
    }

    const lastWebhook = this.platform.storage.getNumber(`lastWebhook_${this.device.target}`);
    return !lastWebhook || lastSuccessfulPing > lastWebhook;
  }
}