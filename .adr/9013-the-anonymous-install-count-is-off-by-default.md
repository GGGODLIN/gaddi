# 9013 — The anonymous install count is off by default

- **Status:** Accepted
- **Date:** 2026-11-07
- **Shipped in:** pending
- **Amends:** upstream [ADR 0129](./0129-an-anonymous-install-count-on-by-default.md) in this fork
  (keeps [ADR 0034](./0034-collie-collects-nothing-and-opt-in-is-the-ceiling.md)'s default-off posture)
- **Trail:** upstream `v1.27.0`–`v1.27.2` sync review (`4c35b3dea`) · `bridge/telemetry.ts`
  (`telemetryState`) · `bridge/config-schema.ts` (`COLLIE_TELEMETRY`) ·
  `web/src/lib/i18n/messages/*.ts` (`telemetry.card.cause.default`) · fork-only divergence

## Context

Upstream `v1.27.0` ([ADR 0129](./0129-an-anonymous-install-count-on-by-default.md)) adds a daily
anonymous install ping (`v: 2`, carrying a random 128-bit install ID, UTC day, version, OS, arch,
install kind, release line, crew role and the trouble-card tally) sent to
`https://ping.colliepwa.dev/v1/ping`, and turns it **on by default** on tagged release builds unless
disabled by `DO_NOT_TRACK`, `COLLIE_TELEMETRY=0`, `telemetry = false` in `config.toml`, or the switch
in Settings on the phone.

In a published fork (`GGGODLIN/gaddi`), turning upstream's telemetry on by default would cause fork
installs to report their versions and trouble tallies to upstream's endpoint (`ping.colliepwa.dev`)
without an explicit choice by the operator.

## Decision

This fork keeps upstream's telemetry machinery, routes, `collie doctor` line and Settings card intact,
and flips step 10 of the decision ladder (`decidedBy: "default"`) from **on** to **off**:

1. **Default is off (`{ on: false, decidedBy: "default" }`).** When neither `COLLIE_TELEMETRY`,
   `config.toml` (`[bridge] telemetry`), nor the phone's Settings switch (`telemetry.json`) votes on,
   the bridge sends nothing, creates no install ID on disk, stores no trouble tally, and shows no
   one-time dashboard notice (`shouldShowTelemetryNotice` requires `view.on && view.decidedBy === "default"`).
2. **Opt-in remains available on the same surfaces.** An operator who wants to send the daily ping can
   turn it on from **Settings → System → Telemetry** on the phone (`setting: "on"`), set
   `COLLIE_TELEMETRY=1`, or set `telemetry = true` under `[bridge]` in `config.toml`. Every hard off
   switch (`DO_NOT_TRACK`, `COLLIE_TELEMETRY=0`, `CI`, `COLLIE_UPDATE_MIRROR`, a `-dev` build, or an
   unvetted `COLLIE_TELEMETRY_URL`) still wins over any on vote, and the phone's switch can still turn
   off an env or config on vote.
3. **Settings copy matches the default.** `telemetry.card.cause.default` across all twelve locale
   dictionaries reads "Off, the default. Turn it on with the switch." (and its translations), and the
   switch remains enabled when `decidedBy === "default"` because `"default"` is not in `LOCKED_OFF`.
