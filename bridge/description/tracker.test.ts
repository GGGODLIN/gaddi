import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProbeTail } from "../journal/cache-probe.ts";
import type { RowReducer } from "../journal/reduce.ts";
import { parseRecap } from "../journal/recap.ts";
import type { AgentSessionRef, JournalAdapter, TranscriptEntry, TranscriptSource } from "../journal/types.ts";
import type { AgentView } from "../types.ts";
import { DescriptionTracker, WIDE_TAIL_BYTES } from "./tracker.ts";

// The tracker on a fake clock, a counting fake journal, and a REAL temporary recap directory — the
// recap read goes through `containedRealpath`, which only real paths can exercise.

const NOW = 1_800_000_000_000;
const SID = "41145801-7cff-4488-ae31-c2a4f9df1f8f";

const dir = mkdtempSync(join(tmpdir(), "collie-recap-"));
const outside = mkdtempSync(join(tmpdir(), "collie-recap-out-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

interface RecapBody {
  version?: number;
  sessionId?: string;
  at: number;
  now: string;
  goal?: string;
  next?: string;
}

function writeRecap(id: string, body: RecapBody): void {
  writeRaw(id, JSON.stringify(body));
}

function writeRaw(id: string, text: string): void {
  writeFileSync(join(dir, `${id}.json`), text);
}

function fakeJournal(agent = "claude") {
  const calls = { stat: 0, tail: 0, load: 0 };
  interface FakeState {
    stat: { size: number; mtimeMs: number } | null;
    entries: TranscriptEntry[];
  }
  const state: FakeState = {
    stat: { size: 10, mtimeMs: 100 },
    entries: [],
  };
  const source: TranscriptSource = {
    resolve: async () => "/logs/one.jsonl",
    stat: async () => {
      calls.stat++;
      return state.stat;
    },
    load: async () => {
      calls.load++;
      return { text: "", complete: true, size: 0, mtimeMs: 300 };
    },
    // The description tracker reads the tail probe, not the live window. These exist because the
    // journal seam now requires them of every source.
    readSince: async () => ({ lines: [], cursor: "", reset: true, fromStart: true }),
  };
  const adapter: JournalAdapter = {
    agent,
    source,
    parse: () => state.entries,
    reducer: (): RowReducer => {
      throw new Error("the description tracker does not fold a live window");
    },
  };
  const tail = async (): Promise<ProbeTail | null> => {
    calls.tail++;
    return { path: "/logs/one.jsonl", lines: [], mtimeMs: 100 };
  };
  return { adapter, calls, state, tail };
}

const pane = (agent: string, session: string | undefined, over: Partial<AgentView> = {}): AgentView => {
  const view: AgentView = {
    paneId: "w1:p1",
    workspaceId: "w1",
    workspaceLabel: "project",
    workspaceNumber: 1,
    tabId: "t1",
    agent,
    status: "working",
    cwd: "/p",
    focused: false,
    kind: "agent",
    ...over,
  };
  if (session !== undefined) view.agentSession = { kind: "id", value: session };
  return view;
};

function clock(start = NOW) {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

const prompt = (text: string, ts: string): TranscriptEntry => ({
  uuid: ts,
  ts,
  role: "user",
  parts: [{ kind: "text", text }],
});

describe("the recap file", () => {
  test("a fresh recap is the description", async () => {
    writeRecap(SID, { version: 1, sessionId: SID, at: NOW - 1000, goal: "目標", now: "現在", next: "下一步" });
    const j = fakeJournal();
    const tracker = new DescriptionTracker({ claude: j.adapter }, () => NOW, { recapDir: dir, tail: j.tail });
    await tracker.refresh([pane("claude", SID)]);
    expect(tracker.describe(pane("claude", SID))).toEqual({
      now: "現在",
      goal: "目標",
      next: "下一步",
      source: "recap",
      at: NOW - 1000,
    });
  });

  test("a prompt newer than the recap falls back to the prompt", async () => {
    const id = "stale-1";
    writeRecap(id, { at: Date.parse("2026-09-24T10:00:00.000Z"), now: "舊的" });
    const j = fakeJournal();
    j.state.entries = [prompt("新的指令", "2026-09-24T10:05:00.000Z")];
    const tracker = new DescriptionTracker({ claude: j.adapter }, () => NOW, { recapDir: dir, tail: j.tail });
    await tracker.refresh([pane("claude", id)]);
    expect(tracker.describe(pane("claude", id))?.now).toBe("你：新的指令");
  });

  test("missing, malformed, bad-id and escaping files are all no recap", async () => {
    writeRaw("bad-json", "{not json");
    writeFileSync(join(outside, "secret.json"), JSON.stringify({ at: 1, now: "leak" }));
    symlinkSync(join(outside, "secret.json"), join(dir, "escape.json"));
    const tracker = new DescriptionTracker({}, () => NOW, { recapDir: dir });
    const ids = ["no-such-session", "bad-json", "../etc", "escape"];
    await tracker.refresh(ids.map((id, i) => pane("claude", id, { paneId: `w1:p${String(i)}` })));
    for (const id of ids) expect(tracker.describe(pane("claude", id))).toBeUndefined();
  });

  test("only a Claude pane reads a recap", async () => {
    writeRecap("codex-ses", { at: NOW, now: "不該讀到" });
    const j = fakeJournal("codex");
    const tracker = new DescriptionTracker({ codex: j.adapter }, () => NOW, { recapDir: dir, tail: j.tail });
    await tracker.refresh([pane("codex", "codex-ses")]);
    expect(tracker.describe(pane("codex", "codex-ses"))).toBeUndefined();
  });

  test("parseRecap takes the real sample and rejects a recap with no `now`", () => {
    const sample =
      '{"version":1,"sessionId":"41145801-7cff-4488-ae31-c2a4f9df1f8f","at":1790239993523,"model":"groq-qwen-3.8-27b","goal":"讀取 hello.txt 並用一句話總結內容","now":"已讀取檔案並完成回答","next":"等待你的下一個指令"}';
    expect(parseRecap(sample)).toEqual({
      at: 1790239993523,
      goal: "讀取 hello.txt 並用一句話總結內容",
      now: "已讀取檔案並完成回答",
      next: "等待你的下一個指令",
    });
    expect(parseRecap('{"at":1}')).toBeUndefined();
    expect(parseRecap("[]")).toBeUndefined();
  });
});

describe("reading cost", () => {
  test("under the floor nothing is stat'ed; past it, an unchanged log is not re-read", async () => {
    const c = clock();
    const j = fakeJournal("codex");
    j.state.entries = [prompt("hi", "2026-09-24T10:00:00.000Z")];
    const tracker = new DescriptionTracker({ codex: j.adapter }, c.now, { tail: j.tail });
    await tracker.refresh([pane("codex", "s1")]);
    expect(j.calls).toEqual({ stat: 1, tail: 1, load: 0 });
    c.advance(1000);
    await tracker.refresh([pane("codex", "s1")]);
    expect(j.calls).toEqual({ stat: 1, tail: 1, load: 0 });
    c.advance(5000);
    await tracker.refresh([pane("codex", "s1")]);
    expect(j.calls).toEqual({ stat: 2, tail: 1, load: 0 });
    j.state.stat = { size: 20, mtimeMs: 200 };
    c.advance(5000);
    await tracker.refresh([pane("codex", "s1")]);
    expect(j.calls).toEqual({ stat: 3, tail: 2, load: 0 });
  });

  test("a failed stat keeps the last reading", async () => {
    const c = clock();
    const j = fakeJournal("codex");
    j.state.entries = [prompt("hi", "2026-09-24T10:00:00.000Z")];
    const tracker = new DescriptionTracker({ codex: j.adapter }, c.now, { tail: j.tail });
    await tracker.refresh([pane("codex", "s1")]);
    j.state.stat = null;
    c.advance(6000);
    await tracker.refresh([pane("codex", "s1")]);
    expect(tracker.describe(pane("codex", "s1"))?.now).toBe("你：hi");
  });

  test("the status is read live: a blocked pane says so without waiting for the floor", async () => {
    const j = fakeJournal("codex");
    j.state.entries = [
      { uuid: "a", ts: "2026-09-24T10:00:01.000Z", role: "assistant", parts: [{ kind: "tool", name: "exec_command", summary: "rm -rf build" }] },
    ];
    const tracker = new DescriptionTracker({ codex: j.adapter }, () => NOW, { tail: j.tail });
    await tracker.refresh([pane("codex", "s1")]);
    expect(tracker.describe(pane("codex", "s1", { status: "blocked" }), 42)).toEqual({
      now: "在等你批准 exec_command · rm -rf build",
      source: "blocked",
      at: 42,
      parts: { tool: "exec_command", target: "rm -rf build" },
    });
  });

  test("an entry is reaped only when its pane leaves its own session's list", async () => {
    const j = fakeJournal("codex");
    j.state.entries = [prompt("hi", "2026-09-24T10:00:00.000Z")];
    const tracker = new DescriptionTracker({ codex: j.adapter }, () => NOW, { tail: j.tail });
    await tracker.refresh([pane("codex", "s1")], { session: "a" });
    await tracker.refresh([], { session: "b" });
    expect(tracker.describe(pane("codex", "s1"))).toBeDefined();
    await tracker.refresh([], { session: "a" });
    expect(tracker.describe(pane("codex", "s1"))).toBeUndefined();
  });

  test("a prompt older than the tail is found by one wider read, then kept without another", async () => {
    const c = clock();
    const j = fakeJournal("claude");
    const reads: number[] = [];
    const turn: TranscriptEntry = { uuid: "a", ts: "2026-09-24T10:00:01.000Z", role: "assistant", parts: [{ kind: "text", text: "working" }] };
    const adapter: JournalAdapter = {
      ...j.adapter,
      parse: (text) => (text === "wide" ? [prompt("hi", "2026-09-24T10:00:00.000Z"), turn] : [turn]),
    };
    const tail = async (_s: TranscriptSource, _r: AgentSessionRef, bytes?: number): Promise<ProbeTail | null> => {
      reads.push(bytes ?? 0);
      return { path: "/logs/one.jsonl", lines: [bytes === WIDE_TAIL_BYTES ? "wide" : "narrow"], mtimeMs: 100 };
    };
    const tracker = new DescriptionTracker({ claude: adapter }, c.now, { recapDir: dir, tail });
    await tracker.refresh([pane("claude", "s1")]);
    expect(tracker.describe(pane("claude", "s1"))?.now).toBe("你：hi");
    expect(reads).toEqual([0, WIDE_TAIL_BYTES]);
    j.state.stat = { size: 20, mtimeMs: 200 };
    c.advance(6000);
    await tracker.refresh([pane("claude", "s1")]);
    expect(tracker.describe(pane("claude", "s1"))?.now).toBe("你：hi");
    expect(reads).toEqual([0, WIDE_TAIL_BYTES, 0]);
  });

  test("a database-backed harness is read whole through its source, never tailed", async () => {
    const j = fakeJournal("opencode");
    j.state.entries = [prompt("hi", "2026-09-24T10:00:00.000Z")];
    const tracker = new DescriptionTracker({ opencode: j.adapter }, () => NOW, { tail: j.tail });
    await tracker.refresh([pane("opencode", "s1")]);
    expect(j.calls).toEqual({ stat: 1, tail: 0, load: 1 });
    expect(tracker.describe(pane("opencode", "s1"))?.now).toBe("你：hi");
  });
});

describe("the other file-backed harnesses", () => {
  test("omp, grok and muse panes are tailed the way a Claude pane is", async () => {
    for (const agent of ["omp", "grok", "muse"]) {
      const j = fakeJournal(agent);
      j.state.entries = [prompt("hi", "2026-09-24T10:00:00.000Z")];
      // The registry files omp's journal under pi, whose adapter reads both.
      const tracker = new DescriptionTracker({ [agent === "omp" ? "pi" : agent]: j.adapter }, () => NOW, { tail: j.tail });
      await tracker.refresh([pane(agent, "s1")]);
      expect(tracker.describe(pane(agent, "s1"))?.now, agent).toBe("你：hi");
    }
  });

  test("a prompt row with no time of its own takes the log's mtime", async () => {
    // Grok's chat_history.jsonl carries no timestamp on any row.
    const j = fakeJournal("grok");
    j.state.entries = [prompt("hi", "")];
    const tracker = new DescriptionTracker({ grok: j.adapter }, () => NOW, { tail: j.tail });
    await tracker.refresh([pane("grok", "s1")]);
    expect(tracker.describe(pane("grok", "s1"))).toMatchObject({ now: "你：hi", source: "prompt", at: 100 });
  });

  test("a pane that reports no session is found by its folder, once per floor", async () => {
    const c = clock();
    const j = fakeJournal("muse");
    j.state.entries = [prompt("hi", "2026-09-24T10:00:00.000Z")];
    const asked: string[] = [];
    const adapter: JournalAdapter = {
      ...j.adapter,
      discover: async (cwd) => {
        asked.push(cwd);
        return { kind: "id", value: "m1" };
      },
    };
    const tracker = new DescriptionTracker({ muse: adapter }, c.now, { tail: j.tail });
    await tracker.refresh([pane("muse", undefined)]);
    expect(tracker.describe(pane("muse", undefined))?.now).toBe("你：hi");
    c.advance(1000);
    await tracker.refresh([pane("muse", undefined)]);
    expect(asked).toEqual(["/p"]);
    c.advance(5000);
    await tracker.refresh([pane("muse", undefined)]);
    expect(asked).toEqual(["/p", "/p"]);
  });

  test("a discovered session is dropped with its pane", async () => {
    const j = fakeJournal("muse");
    j.state.entries = [prompt("hi", "2026-09-24T10:00:00.000Z")];
    const adapter: JournalAdapter = { ...j.adapter, discover: async () => ({ kind: "id", value: "m1" }) };
    const tracker = new DescriptionTracker({ muse: adapter }, () => NOW, { tail: j.tail });
    await tracker.refresh([pane("muse", undefined)], { session: "a" });
    await tracker.refresh([], { session: "a" });
    expect(tracker.describe(pane("muse", undefined))).toBeUndefined();
  });
});
