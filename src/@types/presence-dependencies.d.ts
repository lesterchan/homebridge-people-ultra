declare module 'local-devices' {
  export interface LocalDevice {
    ip: string;
    mac?: string;
    name?: string;
  }

  export default function find(): Promise<LocalDevice[]>;
}

declare module 'node-arp' {
  export function getMAC(ip: string, callback: (error: Error | null, mac: string) => void): void;

  const arp: {
    getMAC: typeof getMAC;
  };

  export default arp;
}

declare module 'ping' {
  export interface PingResponse {
    alive: boolean;
  }

  export const promise: {
    probe(target: string): Promise<PingResponse>;
  };

  const ping: {
    promise: typeof promise;
  };
  export default ping;
}

declare module 'fakegato-history';