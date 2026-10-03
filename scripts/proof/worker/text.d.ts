// Wrangler loads .crt files as text (wrangler.toml, rules).
declare module '*.crt' {
  const text: string;
  export default text;
}

// The Workers TCP socket API, as far as the probe uses it.
declare module 'cloudflare:sockets' {
  type Socket = {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    opened: Promise<unknown>;
    closed: Promise<void>;
    close(): Promise<void>;
    startTls(options?: { expectedServerHostname?: string }): Socket;
  };
  export function connect(address: { hostname: string; port: number }, options?: { secureTransport?: 'off' | 'on' | 'starttls' }): Socket;
}
