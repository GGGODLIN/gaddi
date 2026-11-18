import { describe, expect, test } from "bun:test";
import type { NetworkInterfaceInfo } from "node:os";

import { crewRouteFor } from "./crew/forward.ts";
import { dialTcp, parseProbePort, probePort, tailnetIPv4, type Dial } from "./port-probe.ts";

const nic = (address: string, family: "IPv4" | "IPv6" = "IPv4", internal = false): NetworkInterfaceInfo =>
  // SAFETY: tailnetIPv4 reads only address, family and internal; the rest of the record is filler.
  ({ address, family, internal, netmask: "", mac: "", cidr: null }) as NetworkInterfaceInfo;

describe("parseProbePort", () => {
  test("plain digits in the dev-server range are a port", () => {
    expect(parseProbePort("5173")).toBe(5173);
    expect(parseProbePort("1024")).toBe(1024);
    expect(parseProbePort("65535")).toBe(65535);
  });

  test("system ports, out-of-range numbers and anything but digits are refused", () => {
    for (const raw of ["80", "1023", "65536", "0", "", "5173a", "-1", "1e4", " 5173", "99999"]) {
      expect({ raw, port: parseProbePort(raw) }).toEqual({ raw, port: null });
    }
  });
});

describe("tailnetIPv4", () => {
  test("the first non-internal IPv4 in 100.64/10 is the tailnet address, whatever the interface is called", () => {
    expect(
      tailnetIPv4({
        lo0: [nic("127.0.0.1", "IPv4", true)],
        en0: [nic("192.168.1.118")],
        utun7: [nic("fd7a:115c:a1e0::1", "IPv6"), nic("100.101.86.18")],
      }),
    ).toBe("100.101.86.18");
    expect(tailnetIPv4({ tailscale0: [nic("100.64.10.3")] })).toBe("100.64.10.3");
  });

  test("an address just outside the range, or none at all, is no tailnet", () => {
    expect(tailnetIPv4({ en0: [nic("100.63.255.1"), nic("100.128.0.1"), nic("10.0.0.2")] })).toBeNull();
    expect(tailnetIPv4({})).toBeNull();
  });
});

describe("probePort", () => {
  const listening = (open: readonly string[]): Dial => async (host) => open.includes(host);

  test("a server bound to ::1 alone counts as loopback, and the tailnet address says it is not reachable", async () => {
    expect(await probePort(5173, "100.101.86.18", listening(["::1"]))).toEqual({
      port: 5173,
      loopback: true,
      tailnet: false,
      address: "100.101.86.18",
    });
  });

  test("a server on every interface answers both ways", async () => {
    expect(await probePort(8000, "100.101.86.18", listening(["127.0.0.1", "100.101.86.18"]))).toMatchObject({
      loopback: true,
      tailnet: true,
    });
  });

  test("with no tailnet address the tailnet answer is unknown, and nothing dials for it", async () => {
    const dialled: string[] = [];
    const dial: Dial = async (host) => {
      dialled.push(host);
      return false;
    };
    expect(await probePort(5173, null, dial)).toEqual({ port: 5173, loopback: false, tailnet: null, address: null });
    expect(dialled.toSorted()).toEqual(["127.0.0.1", "::1"]);
  });
});

describe("dialTcp", () => {
  test("opens on a real listener and refuses once it is gone", async () => {
    const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = server.port;
    expect(await dialTcp("127.0.0.1", port, 1000)).toBe(true);
    server.stop(true);
    expect(await dialTcp("127.0.0.1", port, 1000)).toBe(false);
  });

  test("a host that never answers resolves false at the timeout", async () => {
    // 192.0.2.0/24 is TEST-NET-1: routed nowhere, so the connect hangs until the timer wins.
    const started = Date.now();
    expect(await dialTcp("192.0.2.1", 9, 100)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

test("the probe is not on the crew wire: a member's pane answers the lead's 501", () => {
  expect(crewRouteFor("/api/pane/w1:p1/port/5173")).toBeNull();
});
