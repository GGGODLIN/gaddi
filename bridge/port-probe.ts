// Which way a dev server on this machine answers, so the phone can open an agent's
// `http://localhost:<port>` link at an address it can reach (ADR 9007).
//
// The bridge only dials ITSELF: loopback, then its own tailnet address, one TCP connect each, closed
// the moment it opens. No byte of the dev server's reply is read or relayed, so the page never runs
// under Collie's origin and the pairing token never meets it. This is not an outbound call and not a
// second front door: the phone opens the tailnet address in its own browser, outside Collie.
import type { NetworkInterfaceInfo } from "node:os";

/** How long one connect may take. A listener on this machine answers in well under a millisecond. */
export const PORT_PROBE_TIMEOUT_MS = 300;

/**
 * The lowest port the phone asks about. Below it sit system services, not dev servers, and the
 * phone opens such a link as it always did, so the probe is never a scan of this machine's daemons.
 */
export const MIN_PROBE_PORT = 1024;

export interface PortProbe {
  port: number;
  /** Something accepts a connection on 127.0.0.1 or ::1. */
  loopback: boolean;
  /** Something accepts one on this machine's tailnet address; null when the machine has none. */
  tailnet: boolean | null;
  /** This machine's tailnet IPv4 address, the host the phone should open; null when it has none. */
  address: string | null;
}

/** One TCP connect: resolves true when it opened, false on a refusal, an error or the timeout. */
export type Dial = (hostname: string, port: number, timeoutMs: number) => Promise<boolean>;

/** The port as a number, or null for anything but plain digits in [MIN_PROBE_PORT, 65535]. */
export function parseProbePort(raw: string): number | null {
  if (!/^\d{1,5}$/.test(raw)) return null;
  const port = Number(raw);
  return port >= MIN_PROBE_PORT && port <= 65535 ? port : null;
}

/**
 * This machine's tailnet IPv4 address: the first non-internal IPv4 in 100.64/10, the shared
 * address space Tailscale allocates from. Read by range, not by interface name, because the name is
 * `utunN` on macOS and `tailscale0` on Linux. IPv4 only: Vite and most dev servers accept a request
 * addressed to an IP without a host allowlist, and the phone types none of this.
 */
export function tailnetIPv4(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | null {
  for (const list of Object.values(interfaces)) {
    for (const entry of list ?? []) {
      if (entry.internal || entry.family !== "IPv4") continue;
      const [a, b] = entry.address.split(".").map(Number);
      if (a === 100 && b !== undefined && b >= 64 && b <= 127) return entry.address;
    }
  }
  return null;
}

/**
 * What answers on `port`. Both loopback spellings are tried because Vite and Astro bind `::1` alone
 * by default and a Python or Bun server binds IPv4; all three connects run at once.
 */
export async function probePort(port: number, address: string | null, dial: Dial): Promise<PortProbe> {
  const [v4, v6, tailnet] = await Promise.all([
    dial("127.0.0.1", port, PORT_PROBE_TIMEOUT_MS),
    dial("::1", port, PORT_PROBE_TIMEOUT_MS),
    address === null ? Promise.resolve(null) : dial(address, port, PORT_PROBE_TIMEOUT_MS),
  ]);
  return { port, loopback: v4 || v6, tailnet, address };
}

/** {@link Dial} over `Bun.connect`. A socket that opens after the timeout is closed, never kept. */
export const dialTcp: Dial = async (hostname, port, timeoutMs) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const connect = Bun.connect({ hostname, port, socket: { data() {} } }).then(
    (socket) => {
      socket.end();
      return true;
    },
    () => false,
  );
  const ok = await Promise.race([connect, timeout]);
  clearTimeout(timer);
  return ok;
};
