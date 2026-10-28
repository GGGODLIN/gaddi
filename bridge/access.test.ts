import { describe, expect, test } from "bun:test";

import type { Config } from "./config.ts";
import { checkAccess } from "./server.ts";
import { DEFAULT_MAX_UPLOAD_BYTES } from "./uploads.ts";

function req(headers: Record<string, string>): Request {
  return new Request("http://collie.invalid/api/snapshot", { headers });
}

function cfg(overrides: Partial<Config> = {}): Config {
  return {
    mux: "herdr",
    muxEndpoint: "/tmp/herdr.sock",
    tmuxBin: "",
    zellijBin: "",
    ternBin: "",
    socketPath: "/tmp/herdr.sock",
    port: 8787,
    host: "127.0.0.1",
    pollMs: 1500,
    pollIdleMs: 12_000,
    notifyDelayMs: 30_000,
    notifyDescription: false,
    cacheWarnSeconds: 300,
    readLines: 200,
    transcript: true,
    accountWindows: [],
    journalRoots: {
      claude: ["/tmp/claude-projects"],
      codex: ["/nope/codex"],
      pi: ["/nope/pi"],
      opencode: ["/nope/opencode"],
      grok: ["/nope/grok"],
      hermes: ["/nope/hermes"],
      muse: ["/nope/muse"],
      openclaw: ["/nope/openclaw"],
      kiro: ["/nope/kiro"],
    },
    submitKeys: ["Enter"],
    commandsFile: "/nope/commands.toml",
    keysFile: "/nope/keys.toml",
    quickRepliesFile: "/nope/quick-replies.toml",
    themeFile: "/nope/theme.toml",
    fontsDir: "/nope/fonts",
    launchersFile: "/nope/launchers.toml",
    accountsFile: "/nope/accounts.toml",
    retellFile: "/nope/retell.toml",
    clipboardFile: "/nope/clipboard.toml",
    cacheRulesFile: "/nope/cache-rules.toml",
    trustedUser: "",
    trustedUserOptional: false,
    accessTeam: "",
    accessAud: [],
    auditContent: "preview",
    redact: true,
    sent: "on",
    deviceHeader: "",
    deviceAllowlist: [],
    allowedOrigins: [],
    publicHosts: [],
    tailscaleHosts: [],
    allowAnyHost: true,
    allowNonLoopbackBind: false,
    vapidPublic: "",
    vapidPrivate: "",
    vapidSubject: "mailto:admin@example.com",
    stateDir: "/tmp/state",
    multiSession: true,
    surfaceShadow: false,
    sendProtocol: false,
    walky: true,
    skipServe: false,
    basePath: "/",
    maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
    uploadExtraTypes: [],
    ...overrides,
  };
}

describe("checkAccess — strict same-origin gate (no blanket loopback Origin trust)", () => {
  // A loopback Origin is not trusted by its name. On a phone, any app can serve a page from its own
  // localhost; that page's requests to a collie carry `Origin: http://localhost…`, and trusting the
  // name let it drive every collie the phone could reach (box-door-f8, 2026-10-07).
  test("refuses a localhost / 127.0.0.1 / [::1] origin that is not the collie's own", () => {
    for (const origin of ["http://localhost", "http://localhost:8787", "http://127.0.0.1:3000", "http://[::1]:8080"]) {
      for (const level of ["read", "write"] as const) {
        expect(checkAccess(req({ origin, host: "collie.example.ts.net" }), cfg(), level), `${origin} ${level}`).toEqual({
          ok: false,
          reason: "cross-origin rejected",
        });
      }
    }
  });

  test("refuses a loopback origin on another port even when the Host is loopback too", () => {
    // A reverse proxy that rewrites Host to the upstream (nginx's default) makes every request look
    // loopback-to-loopback, so "both loopback" cannot stand in for "same origin".
    expect(
      checkAccess(req({ origin: "http://localhost:5173", host: "127.0.0.1:8787" }), cfg(), "write"),
    ).toEqual({ ok: false, reason: "cross-origin rejected" });
  });

  test("allows the collie's own loopback origin, and a listed one", () => {
    expect(checkAccess(req({ origin: "http://127.0.0.1:8787", host: "127.0.0.1:8787" }), cfg(), "write")).toEqual({
      ok: true,
    });
    expect(
      checkAccess(
        req({ origin: "http://localhost:5173", host: "127.0.0.1:8787" }),
        cfg({ allowedOrigins: ["http://localhost:5173"] }),
        "write",
      ),
    ).toEqual({ ok: true });
  });
});
