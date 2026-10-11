import { describe, expect, test } from "bun:test";

import type { TranscriptEntry } from "../journal/types.ts";
import { describePane, journalFacts, toolTarget, type Recap } from "./resolve.ts";

const T = 1_790_000_000_000;

const recap = (over: Partial<Recap> = {}): Recap => ({
  at: T,
  now: "已讀取檔案並完成回答",
  goal: "讀取 hello.txt",
  next: "等待你的下一個指令",
  ...over,
});

describe("describePane — first match wins", () => {
  test("rule 1: blocked names the pending tool and its file basename", () => {
    const d = describePane({
      status: "blocked",
      facts: { pendingTool: { name: "Edit", summary: "/Users/me/p/src/app.ts" } },
      now: T + 5,
    });
    expect(d).toEqual({ now: "在等你批准 Edit · app.ts", source: "blocked", at: T + 5, parts: { tool: "Edit", target: "app.ts" } });
  });

  test("rule 1: a shell call's target is its first line, clipped to 40", () => {
    const long = `bun run build && ${"x".repeat(60)}`;
    const d = describePane({ status: "blocked", facts: { pendingTool: { name: "Bash", summary: long } }, now: T });
    expect(d?.now.startsWith("在等你批准 Bash · bun run build")).toBe(true);
    expect(d?.now.endsWith("…")).toBe(true);
    expect(d?.now.length).toBe("在等你批准 Bash · ".length + 40);
  });

  test("rule 1: no readable tool call is the bare sentence", () => {
    expect(describePane({ status: "blocked", now: T })).toEqual({ now: "在等你批准", source: "blocked", at: T, parts: {} });
  });

  test("rule 1: blocked copies goal and next from a recap, even a stale one", () => {
    const d = describePane({
      status: "blocked",
      recap: recap(),
      facts: { prompt: { text: "newer", at: T + 1000 }, pendingTool: { name: "WebFetch", summary: "https://x" } },
      now: T + 2000,
    });
    expect(d).toEqual({
      now: "在等你批准 WebFetch",
      goal: "讀取 hello.txt",
      next: "等待你的下一個指令",
      source: "blocked",
      at: T + 2000,
      parts: { tool: "WebFetch" },
    });
  });

  test("rule 2: a fresh recap is used as written", () => {
    const d = describePane({ status: "idle", recap: recap(), facts: { prompt: { text: "hi", at: T - 1 } }, now: T + 9 });
    expect(d).toEqual({
      now: "已讀取檔案並完成回答",
      goal: "讀取 hello.txt",
      next: "等待你的下一個指令",
      source: "recap",
      at: T,
    });
  });

  test("rule 2: a recap with no journal prompt at all is fresh", () => {
    expect(describePane({ status: "done", recap: recap({ goal: undefined }), now: T })?.source).toBe("recap");
  });

  test("rule 3: a prompt newer than the recap makes it stale", () => {
    const d = describePane({
      status: "working",
      recap: recap(),
      facts: { prompt: { text: "改成\n兩行   的指令", at: T + 1 } },
      now: T + 2,
    });
    expect(d).toEqual({ now: "你：改成 兩行 的指令", source: "prompt", at: T + 1, parts: { prompt: "改成 兩行 的指令" } });
  });

  test("rule 3: a long prompt is clipped to 80 with an ellipsis", () => {
    const d = describePane({ status: "working", facts: { prompt: { text: "a".repeat(200), at: T } }, now: T });
    expect(d?.now).toBe(`你：${"a".repeat(79)}…`);
  });

  test("rule 4: nothing to say is no description", () => {
    expect(describePane({ status: "working", now: T })).toBeUndefined();
    expect(describePane({ status: "idle", facts: {}, now: T })).toBeUndefined();
  });
});

describe("toolTarget", () => {
  test("omits the target of a tool that is neither a path nor a shell call", () => {
    expect(toolTarget({ name: "Grep", summary: "TODO" })).toBeUndefined();
    expect(toolTarget({ name: "Read", summary: "" })).toBeUndefined();
  });
});

describe("journalFacts", () => {
  const entry = (over: Partial<TranscriptEntry>): TranscriptEntry => ({
    uuid: "u",
    ts: "2026-09-24T10:00:00.000Z",
    role: "user",
    parts: [],
    ...over,
  });

  test("the newest user text is the prompt, and a pending tool is found on the newest assistant turn", () => {
    const facts = journalFacts([
      entry({ parts: [{ kind: "text", text: "old" }], ts: "2026-09-24T09:00:00.000Z" }),
      entry({ parts: [{ kind: "text", text: "fix the build" }] }),
      entry({
        role: "assistant",
        parts: [
          { kind: "tool", name: "Read", summary: "/a/b.ts", result: { text: "ok" } },
          { kind: "tool", name: "Bash", summary: "bun test" },
        ],
      }),
    ]);
    expect(facts.prompt).toEqual({ text: "fix the build", at: Date.parse("2026-09-24T10:00:00.000Z") });
    expect(facts.pendingTool).toEqual({ name: "Bash", summary: "bun test" });
  });

  test("an answered tool is not pending, and a note is not a prompt", () => {
    const facts = journalFacts([
      entry({ role: "note", parts: [{ kind: "text", text: "background task done" }] }),
      entry({ role: "assistant", parts: [{ kind: "tool", name: "Read", summary: "/x", result: { text: "" } }] }),
    ]);
    expect(facts).toEqual({});
  });
});
