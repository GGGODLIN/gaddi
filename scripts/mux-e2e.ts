#!/usr/bin/env bun
// THE THROWAWAY LAYER of mux conformance: tmux, zellij and tuios, each started fresh, probed, typed
// into, and torn down.
//
//   bun scripts/mux-e2e.ts                  # every multiplexer this box has
//   bun scripts/mux-e2e.ts --mux zellij     # just one
//
// WHY A THIRD LAYER. `bun test bridge/mux` drives each adapter through a fake transport, and
// `scripts/mux-probe.ts` reads a real multiplexer but may never write to it, because a live pane is
// somebody's session. Neither proves that a send reaches a real tmux, zellij or tuios pane and comes
// back on a read. This script owns the instance it writes to, so it may type.
//
// NOTHING OF THE OPERATOR'S IS REACHED. Every multiplexer runs under one temporary root: its own
// HOME (no shell rc, no mux config), XDG dirs, TMPDIR, a tmux socket path, a ZELLIJ_SOCKET_DIR and a
// tuios runtime dir. The probe and the send both run as children given that environment and no
// other, so neither can see a server the operator started. The root is deleted at the end, pass or fail.
//
// A multiplexer that is not installed is SKIPPED, loudly, and is not a pass. The exit code is
// non-zero only when an installed one failed.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildMuxRegistry, createMux, muxEndpointVar } from "../bridge/mux/registry.ts";
import type { MuxAdapter } from "../bridge/mux/types.ts";

const MUXES = ["tmux", "zellij", "tuios"] as const;
type Mux = (typeof MUXES)[number];

const SESSION = "collie-e2e";
const SHELL = "/bin/bash";
const READBACK_TIMEOUT_MS = 15_000;
const STARTUP_TIMEOUT_MS = 20_000;
const SEND_FLAG = "--send-child";

interface Instance {
  readonly endpoint: string;
  stop(): Promise<void>;
}

interface Result {
  readonly mux: Mux;
  readonly verdict: "pass" | "fail" | "skip";
  readonly lines: readonly string[];
}

async function run(argv: readonly string[], env: Readonly<Record<string, string>>, cwd: string): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn([...argv], { env, cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, out: out + err };
}

/** The environment every process of one run shares. Built once, from the temp root alone. */
type IsolatedEnv = {
  readonly PATH: string;
  readonly TERM: string;
  readonly LANG: string;
  readonly SHELL: string;
  readonly HOME: string;
  readonly TMPDIR: string;
  readonly XDG_RUNTIME_DIR: string;
  readonly XDG_CONFIG_HOME: string;
  readonly XDG_STATE_HOME: string;
  readonly XDG_DATA_HOME: string;
  readonly XDG_CACHE_HOME: string;
  readonly ZELLIJ_SOCKET_DIR: string;
};

function isolatedEnv(root: string): IsolatedEnv {
  const dirs = {
    HOME: join(root, "home"),
    TMPDIR: join(root, "tmp"),
    XDG_RUNTIME_DIR: join(root, "run"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"),
    ZELLIJ_SOCKET_DIR: join(root, "zellij"),
  };
  // zellij and tuios refuse a runtime or socket dir others can read.
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TERM: "xterm-256color",
    LANG: "en_US.UTF-8",
    SHELL,
    ...dirs,
  };
}

async function start(mux: Mux, env: IsolatedEnv, root: string): Promise<Instance> {
  const cwd = env.HOME;
  if (mux === "tmux") {
    const socket = join(root, "tmux.sock");
    const r = await run(["tmux", "-S", socket, "-f", "/dev/null", "new-session", "-d", "-s", SESSION, "-x", "120", "-y", "40", `${SHELL} --norc --noprofile`], env, cwd);
    if (r.code !== 0) throw new Error(`tmux new-session exited ${String(r.code)}: ${r.out.trim()}`);
    return { endpoint: socket, stop: async () => void (await run(["tmux", "-S", socket, "kill-server"], env, cwd)) };
  }
  if (mux === "zellij") {
    const r = await run(["zellij", "attach", "--create-background", SESSION], env, cwd);
    if (r.code !== 0) throw new Error(`zellij attach --create-background exited ${String(r.code)}: ${r.out.trim()}`);
    return {
      endpoint: SESSION,
      stop: async () => {
        await run(["zellij", "kill-session", SESSION], env, cwd);
        await run(["zellij", "delete-session", "--force", SESSION], env, cwd);
      },
    };
  }
  const r = await run(["tuios", "new", SESSION, "--detach"], env, cwd);
  if (r.code !== 0) throw new Error(`tuios new --detach exited ${String(r.code)}: ${r.out.trim()}`);
  return { endpoint: join(env.XDG_RUNTIME_DIR, "tuios", "tuios.sock"), stop: async () => void (await run(["tuios", "kill-server"], env, cwd)) };
}

/** Wait until the adapter sees a live pane: a detached session can take a moment to spawn its shell. */
async function firstPane(adapter: MuxAdapter): Promise<string> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await adapter.reachable()) {
      const pane = (await adapter.snapshot()).panes.find((p) => p.alive);
      if (pane !== undefined) return pane.paneId;
    }
    await Bun.sleep(250);
  }
  throw new Error(`no live pane within ${String(STARTUP_TIMEOUT_MS)} ms`);
}

/**
 * Type a command through the adapter, press Enter, and read the pane until its OUTPUT appears. The
 * printed word is split by `%s` in the command, so the typed line alone can never match it.
 */
async function sendAndReadBack(adapter: MuxAdapter, paneId: string): Promise<string[]> {
  const token = `t${Math.random().toString(36).slice(2, 10)}`;
  const expected = `COLLIE${token}E2E`;
  const typed = await adapter.typeText(paneId, `printf 'COLLIE%sE2E\\n' ${token}`);
  if (!typed.ok) return [`typeText refused: ${typed.reason}: ${typed.detail}`];
  const entered = await adapter.sendKeys(paneId, ["Enter"]);
  if (!entered.ok) return [`sendKeys(Enter) refused: ${entered.reason}: ${entered.detail}`];
  const deadline = Date.now() + READBACK_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    const grid = await adapter.readGrid(paneId, { scope: "viewport", lines: 40, styling: "strip" });
    if (grid.ok) {
      last = grid.value.text;
      if (last.split("\n").some((line) => line.trim() === expected)) return [];
    }
    await Bun.sleep(250);
  }
  return [`"${expected}" never appeared as a line within ${String(READBACK_TIMEOUT_MS)} ms; last read ended: ${JSON.stringify(last.trimEnd().slice(-200))}`];
}

async function e2e(mux: Mux): Promise<Result> {
  if (Bun.which(mux) === null) return { mux, verdict: "skip", lines: [`${mux} is not on PATH`] };
  // `/tmp`, not os.tmpdir(): macOS's per-user TMPDIR is long enough that zellij's socket path under
  // it passes the 104-byte Unix socket limit and zellij refuses to start.
  const root = mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), `cme2e-${mux}-`));
  const env = isolatedEnv(root);
  const lines: string[] = [];
  let instance: Instance | null = null;
  try {
    instance = await start(mux, env, root);

    const probe = await run(["bun", join(import.meta.dir, "mux-probe.ts"), "--mux", mux], { ...env, [muxEndpointVar(mux)]: instance.endpoint }, join(import.meta.dir, ".."));
    const checks = probe.out.split("\n").filter((l) => /^\s+[✓✗·]/.test(l));
    lines.push(`probe exit ${String(probe.code)}, ${String(checks.filter((l) => l.includes("✓")).length)} checks passed`);
    lines.push(...checks.filter((l) => !l.includes("✓")).map((l) => l.trim()));
    if (probe.code !== 0 || checks.length === 0) lines.push(probe.out.trim().split("\n").slice(-6).join(" | "));

    // A child, like the probe: the adapter spawns its multiplexer's CLI with Bun's environment as it
    // was at startup, and Bun.spawn does not see a later write to process.env, so an in-process
    // adapter would reach the operator's zellij socket dir instead of this run's.
    const send = await run(["bun", import.meta.path, SEND_FLAG, mux, instance.endpoint], env, join(import.meta.dir, ".."));
    lines.push(send.out.trim());

    const ok = probe.code === 0 && checks.length > 0 && send.code === 0;
    return { mux, verdict: ok ? "pass" : "fail", lines };
  } catch (err) {
    lines.push(err instanceof Error ? err.message : String(err));
    return { mux, verdict: "fail", lines };
  } finally {
    if (instance !== null) await instance.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

/** The child half: one send and read back, run under the isolated environment it was given. */
async function sendChild(mux: string, endpoint: string): Promise<never> {
  try {
    const adapter = createMux(buildMuxRegistry(), mux, { endpoint, timeoutMs: 10_000, options: {} });
    const paneId = await firstPane(adapter);
    const problems = await sendAndReadBack(adapter, paneId);
    console.log(problems.length === 0 ? `send and read back through the adapter on pane ${paneId}: ok` : problems.join("; "));
    process.exit(problems.length === 0 ? 0 : 1);
  } catch (err) {
    console.log(`send and read back threw: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === SEND_FLAG) await sendChild(args[1] ?? "", args[2] ?? "");
  const only = args.includes("--mux") ? args[args.indexOf("--mux") + 1] : undefined;
  const chosen = only === undefined ? [...MUXES] : MUXES.filter((m) => m === only);
  if (chosen.length === 0) {
    console.error(`unknown multiplexer "${String(only)}" — this script drives: ${MUXES.join(", ")}`);
    process.exit(2);
  }
  const results: Result[] = [];
  for (const mux of chosen) {
    const result = await e2e(mux);
    results.push(result);
    console.log(`${result.verdict.toUpperCase().padEnd(4)} ${mux}`);
    for (const line of result.lines) console.log(`     ${line}`);
  }
  const failed = results.filter((r) => r.verdict === "fail").length;
  const passed = results.filter((r) => r.verdict === "pass").length;
  if (passed === 0 && failed === 0) console.log("NOTHING WAS RUN — every multiplexer skipped. This run proves nothing.");
  process.exit(failed === 0 ? 0 : 1);
}

await main();
