# 9007 — A localhost link opens at the tailnet address

- **Status:** Accepted
- **Date:** 2026-10-10
- **Relates to:** [ADR 0001](./0001-one-managed-front-door.md) (one managed front door), which this
  keeps. [ADR 9002](./9002-the-agent-palette-stages-never-sends.md) (stage, never send), which the fix
  button follows. [ADR 0030](./0030-the-ui-is-translated-by-a-typed-dictionary-not-a-library.md),
  whose quick-reply exemption covers the fix message.
- **Trail:** the operator asked to tap an agent's `http://localhost:5173` on the phone and see the
  Mac's dev server. Measured on that Mac on 2026-10-10: Vite 8.1 and Astro bind `::1` alone by
  default and are unreachable over the tailnet; Python's `http.server` and `Bun.serve` bind every
  interface and answer 200 at the tailnet IP.

## Context

On the phone, `localhost` is the phone. The link an agent prints is right on the machine it runs
on and dead everywhere else. The phone already reaches that machine over the tailnet, so the same
port is one rewrite away, when the server listens beyond loopback. The two most common dev servers
do not, by default.

Three other roads were open:

- **Relay the dev server through the bridge.** The page would run under Collie's origin, beside the
  pairing token, and an agent's page is not code the bridge may serve there.
- **Publish each port with `tailscale serve`.** Works without the agent's help, but it is a second
  managed front door, which ADR 0001 refuses.
- **Rewrite the link and stop there.** Leaves the Vite and Astro case as a blank tab with no reason.

## Decision

**The phone rewrites the link to the machine's tailnet IP after the bridge says the port answers
there. When it answers on loopback only, the phone explains and offers to stage a message asking the
agent to rebind it.**

1. **The probe dials only this machine.** `GET /api/pane/<id>/port/<port>` makes one TCP connect each
   to `127.0.0.1`, `::1` and the machine's own tailnet IPv4 (the first non-internal address in
   100.64.0.0/10), 300 ms each, and closes it on open. No byte of the reply is read or relayed. It
   is a read under the pairing token, for ports 1024 to 65535 only, so it is never a scan of system
   services.
2. **The phone opens the IP, never the MagicDNS name.** Vite answers a request addressed to an
   unknown name with 403 and accepts any IP; its HMR socket connects at the IP too (both verified
   2026-10-10). Path, query and fragment are kept. Plain `http:` with an explicit port only.
3. **Loopback only stages a fix, never sends it.** The message is English on every locale, names
   the port and no framework, and asks the agent to listen on all interfaces and save that in the
   project's config. The operator reads it in the composer and taps Send.
4. **No answer is the old behaviour.** A crew member's pane (the route is not on the crew wire), an
   older bridge, a machine with no tailnet address, or a failed probe opens the link as printed.
5. **The new tab opens after the probe.** A browser that refuses it as a popup gets a sheet with a
   real link to tap.

## Consequences

- A dev server bound to every interface is reachable from every network the machine is on, the
  local Wi-Fi as well as the tailnet, not only from this phone. That is the agent's change, made on
  the operator's Send after reading a message that says "all interfaces"; Collie binds nothing.
- The tailnet address is read by range, so on a machine without Tailscale a carrier's shared
  address in 100.64.0.0/10 is taken for it, and the phone may open an address it cannot reach. The
  tab then fails the way the printed link did; nothing else is exposed.
- Extending the probe to crew members means adding the route to `bridge/crew/forward.ts` and a
  CREW_PROTOCOL.md decision; until then their links open as printed.
