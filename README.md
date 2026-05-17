# homebridge-people-ultra

The People Ultra Homebridge plugin creates HomeKit presence sensors for people or devices on your local network. It is a TypeScript port of the now archived [homebridge-people-pro](https://github.com/mfkrause/homebridge-people-pro). The port is done by Codex on GPT 5.5 and is based on [homebridge-plugin-template](https://github.com/homebridge/homebridge-plugin-template).

The plugin can monitor targets by IP address, hostname, or MAC address. It can also run an optional webhook server for location-aware mobile apps such as Locative, and motion sensors can expose Eve history through fakegato.

## Installation

```shell
npm install -g homebridge-people-ultra
```

Then add the `PeopleUltra` platform to your Homebridge configuration.

## Configuration

```json
{
  "platform": "PeopleUltra",
  "name": "People Ultra",
  "anyoneSensor": true,
  "anyoneSensorName": "Anyone",
  "nooneSensor": true,
  "nooneSensorName": "No One",
  "webhookEnabled": true,
  "webhookPort": 51828,
  "people": [
    {
      "name": "Lester Chan",
      "target": "LesterChan-iPhone",
      "enableCustomDns": true,
      "customDns": ["8.8.8.8", "8.8.4.4"],
      "threshold": 15,
      "pingInterval": 10000,
      "ignoreWebhookReEnter": 0,
      "pingUseArp": true,
      "type": "occupancy"
    },
    {
      "name": "Someone",
      "target": "192.168.1.68",
      "threshold": 15,
      "pingInterval": 10000,
      "pingUseArp": false,
      "excludeFromWebhook": true
    }
  ]
}
```

## Platform Options

| Parameter          | Default        | Notes                                                                                |
| ------------------ | -------------- | ------------------------------------------------------------------------------------ |
| `name`             | `People Ultra` | Display name for the platform.                                                       |
| `anyoneSensor`     | `false`        | Adds an aggregate sensor that is active when at least one configured person is home. |
| `anyoneSensorName` | `Anyone`       | Name for the anyone sensor.                                                          |
| `anyoneSensorType` | `motion`       | `motion` or `occupancy`.                                                             |
| `nooneSensor`      | `false`        | Adds an aggregate sensor that is active when no configured person is home.           |
| `nooneSensorName`  | `No One`       | Name for the no one sensor.                                                          |
| `nooneSensorType`  | `motion`       | `motion` or `occupancy`.                                                             |
| `webhookEnabled`   | `false`        | Enables the webhook webserver.                                                       |
| `webhookPort`      | `51828`        | Port used by the webhook webserver.                                                  |
| `people`           | `[]`           | Array of people or targets to expose as sensors.                                     |

## Person Options

| Parameter              | Default  | Notes                                                                      |
| ---------------------- | -------- | -------------------------------------------------------------------------- |
| `name`                 | required | HomeKit sensor name.                                                       |
| `target`               | required | Hostname, IP address, or MAC address to monitor.                           |
| `enableCustomDns`      | `false`  | Enables custom DNS servers for hostname lookups.                           |
| `customDns`            | `[]`     | DNS server IP addresses used when custom DNS is enabled.                   |
| `type`                 | `motion` | `motion` or `occupancy`. Eve history is available only for motion sensors. |
| `threshold`            | `15`     | Minutes since last seen before the person is considered away.              |
| `pingInterval`         | `10000`  | Poll interval in milliseconds. Set to `-1` to disable ping/ARP polling.    |
| `pingUseArp`           | `false`  | Uses ARP lookup instead of ICMP ping.                                      |
| `excludeFromWebhook`   | `false`  | Ignores webhook updates for this sensor.                                   |
| `ignoreWebhookReEnter` | `0`      | Debounces repeated webhook enter or exit updates for this many seconds.    |

## How It Works

People Ultra records the last successful network sighting for each configured target. On every HomeKit state-lookup and poll cycle, that timestamp is compared with the configured threshold. If the target was seen recently enough, the person is treated as home.

When `pingUseArp` is enabled, the plugin checks ARP lookup results instead of using ICMP ping. When the target is a MAC address, the plugin first attempts to find the matching local IP address before checking presence.

## Webhooks

When webhooks are enabled, send requests in this format:

```text
http://[homebridge-ip]:51828/?sensor=[name]&state=true
http://[homebridge-ip]:51828/?sensor=[name]&state=false
```

The `sensor` value must match the configured person's `name`. A successful webhook stores a timestamp and updates that person's HomeKit state. Polling resumes after the webhook timestamp becomes older than the person's threshold.

## Development

```shell
npm install
npm run build
npm run lint
```

For local Homebridge testing:

```shell
npm run watch
```

The watch command uses `test/hbConfig/config.json` and restarts Homebridge when TypeScript files change.

## Thanks

Thanks to the following contributors for their code, feedback, and support:

- [PeteLawrence](https://github.com/PeteLawrence/homebridge-people) — original plugin author
- [simont77](https://github.com/simont77/fakegato-history) — author of fakegato-history
- [wr](https://github.com/wr) — added webhook support
- [benzman81](https://github.com/benzman81) — ported to a Platform; improved ping/webhook integration and many fixes
- [skrollme](https://github.com/skrollme) — upstream plugin author that homebridge-people-pro forked from
- [mfkrause](https://github.com/mfkrause) — author of homebridge-people-pro (this project's ancestor)
