import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuditLog } from "./audit.ts";
import { loadConfig, resolveJournalRoots, type Config } from "./config.ts";
import { muxAck, muxOk, type MuxAck, type MuxAdapter, type MuxGrid, type MuxOutcome, type MuxSnapshot } from "./mux/types.ts";
import { retellPane, switchAccountPane } from "./server.ts";
import type { StateEngine } from "./state-engine.ts";
import type { AgentView } from "./types.ts";

// The two this-host-only pane routes (switch account, retell) at the HTTP boundary.

const SID = "1519794a-e8f5-4a29-a687-f3154a08c1b2";
const root = mkdtempSync(join(tmpdir(), "collie-local-routes-"));
mkdirSync(join(root, "-work-repo"));
// A session started in `default`: the route must type that mode back, not leave the account's own.
writeFileSync(
  join(root, "-work-repo", `${SID}.jsonl`),
  [
    JSON.stringify({ type: "permission-mode", permissionMode: "default", sessionId: SID }),
    JSON.stringify({ type: "assistant", message: { content: [] } }),
  ].join("\n"),
);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const cfg: Config = { ...loadConfig({ HOME: root }), journalRoots: { ...resolveJournalRoots({}, root), claude: [root] } };
const audit = new AuditLog(() => {});

function claudePane(overrides: Partial<AgentView> = {}): AgentView {
  return {
    paneId: "w1:p1",
    workspaceId: "w1",
    workspaceLabel: "repo",
    workspaceNumber: 1,
    tabId: "w1:t1",
    agent: "claude",
    status: "idle",
    cwd: "/work/repo",
    focused: false,
    agentSession: { kind: "id", value: SID },
    ...overrides,
  };
}

function engineWith(pane: AgentView): StateEngine {
  const stub: Partial<StateEngine> = {
    pokeNow: () => {},
    current: () => ({ agents: [pane], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" }),
  };
  // SAFETY: both routes reach only `current()` and, after a switch, `pokeNow()`.
  return stub as StateEngine;
}

/** A pane whose Claude exits as soon as `/exit` is submitted. */
function exitingMux() {
  let exited = false;
  const typed: string[] = [];
  const fake: Partial<MuxAdapter> = {
    sendKeys: async (_pane: string, keys: readonly string[]): Promise<MuxAck> => {
      if (keys[0] === "Enter" && typed.at(-1) === "/exit") exited = true;
      return muxAck();
    },
    typeText: async (_pane: string, text: string): Promise<MuxAck> => {
      typed.push(text);
      return muxAck();
    },
    snapshot: async (): Promise<MuxSnapshot> => {
      // SAFETY: the switch reads only paneId and agent off a pane.
      const pane = { paneId: "w1:p1", agent: exited ? "shell" : "claude" } as MuxSnapshot["panes"][number];
      return { panes: [pane], spaces: [], tabs: [] };
    },
    readGrid: async (paneId: string): Promise<MuxOutcome<MuxGrid>> =>
      muxOk({ paneId, text: exited ? `claude --resume ${SID}\n❯` : "❯ ", truncated: false, revision: 1 }),
    refresh: async () => {},
  };
  // SAFETY: only the members supplied above are reachable from the switch route.
  return { mux: fake as MuxAdapter, typed };
}

interface RouteBody {
  account?: string;
  mode?: string;
  sessionId?: string;
}
const post = (body: RouteBody) =>
  new Request("http://127.0.0.1/api/pane/w1%3Ap1/x", { method: "POST", body: JSON.stringify(body) });
const accounts = () => Promise.resolve([{ label: "Personal", command: "cc -personal" }]);

describe("POST /api/pane/:id/switch-account", () => {
  test("a second request for the same pane is refused while the first runs", async () => {
    const { mux, typed } = exitingMux();
    const engine = engineWith(claudePane());
    const first = switchAccountPane(mux, engine, cfg, "w1:p1", post({ account: "Personal" }), audit, null, "s", accounts);
    const second = await switchAccountPane(mux, engine, cfg, "w1:p1", post({ account: "Personal" }), audit, null, "s", accounts);
    expect(await second.json()).toMatchObject({ ok: false, code: "account.in_progress" });
    expect(await (await first).json()).toEqual({ ok: true });
    expect(typed).toEqual(["/exit", `cc -personal --resume ${SID} --permission-mode default`]);
  });

  test("a working pane without the interrupt flag is refused and nothing is typed", async () => {
    const { mux, typed } = exitingMux();
    const res = await switchAccountPane(
      mux,
      engineWith(claudePane({ status: "working" })),
      cfg,
      "w1:p1",
      post({ account: "Personal" }),
      audit,
      null,
      "s",
      accounts,
    );
    expect(await res.json()).toMatchObject({ ok: false, code: "account.confirm_interrupt" });
    expect(typed).toEqual([]);
  });

  test("an account outside accounts.toml is refused", async () => {
    const { mux } = exitingMux();
    const res = await switchAccountPane(mux, engineWith(claudePane()), cfg, "w1:p1", post({ account: "rm -rf" }), audit, null, "s", accounts);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "account.not_allowlisted" });
  });
});

describe("POST /api/pane/:id/retell", () => {
  test("no retell.toml is a 404 and spawns nothing", async () => {
    let spawned = false;
    const res = await retellPane(engineWith(claudePane()), "w1:p1", post({ mode: "plain" }), audit, null, "s", async () => [], () => {
      spawned = true;
      throw new Error("spawned");
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "retell.off" });
    expect(spawned).toBe(false);
  });

  test("the child gets the multiplexer's session id, never one from the body", async () => {
    const seen: string[][] = [];
    const answer = JSON.stringify({ ok: true, sessionId: SID, mode: "lost", label: "跟丟了", answer: "a", cached: false, source: "x" });
    const res = await retellPane(
      engineWith(claudePane()),
      "w1:p1",
      post({ mode: "lost", sessionId: "00000000-0000-0000-0000-000000000000" }),
      audit,
      null,
      "s",
      async () => [{ command: ["/bin/ww"] }],
      (argv) => {
        seen.push([...argv]);
        return { exited: Promise.resolve(0), stdout: Promise.resolve(answer), kill: () => {} };
      },
    );
    expect(await res.json()).toMatchObject({ ok: true, mode: "lost", answer: "a" });
    expect(seen).toEqual([["/bin/ww", "--session-id", SID, "--json"]]);
  });

  const slowAnswer = (mode: string) => JSON.stringify({ ok: true, sessionId: SID, mode, label: "x", answer: "a", cached: false, source: "x" });

  test("the same pane id in two sessions is two panes: both retell at once", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const spawn = () => ({ exited: gate.then(() => 0), stdout: gate.then(() => slowAnswer("plain")), kill: () => {} });
    const config = async () => [{ command: ["/bin/ww"] }];
    const first = retellPane(engineWith(claudePane()), "w1:p1", post({ mode: "plain" }), audit, null, "one", config, spawn);
    const second = retellPane(engineWith(claudePane()), "w1:p1", post({ mode: "plain" }), audit, null, "two", config, spawn);
    release();
    expect(await (await second).json()).toMatchObject({ ok: true });
    expect(await (await first).json()).toMatchObject({ ok: true });
  });

  test("a pane that started another conversation while the retelling ran gets no stale answer", async () => {
    let pane = claudePane();
    const stub: Partial<StateEngine> = {
      current: () => ({ agents: [pane], shellPanes: [], workspaces: [], tabs: [], bridge: "connected" }),
    };
    // SAFETY: the retell route reaches only `current()`.
    const engine = stub as StateEngine;
    const spawn = () => {
      // The operator ran /clear, and Claude reported a new session id for the same pane.
      pane = claudePane({ agentSession: { kind: "id", value: "00000000-0000-0000-0000-000000000001" } });
      return { exited: Promise.resolve(0), stdout: Promise.resolve(slowAnswer("plain")), kill: () => {} };
    };
    const res = await retellPane(engine, "w1:p1", post({ mode: "plain" }), audit, null, "s", async () => [{ command: ["/bin/ww"] }], spawn);
    expect(await res.json()).toMatchObject({ ok: false, code: "retell.session_changed" });
  });
});
