// What a pane is doing, in one description every surface reads — the herd row, the pane screen and
// the Web Push body. The bridge computes it ONCE per pane, here, and no surface composes its own text
// or its own priority order.
//
// PURE. No fs, no clock. The tracker beside this file (./tracker.ts) collects the two readings off
// disk on the state engine's poll; this module only decides, so every rule is table-testable.
//
// FIRST MATCH WINS:
//   1. the pane is blocked      → a fixed sentence naming the pending tool; goal/next from any recap
//   2. a fresh recap exists     → the recap, as the agent's plugin wrote it
//   3. the journal has a prompt → the operator's own newest prompt, on one line
//   4. otherwise                → nothing at all (absent, never a placeholder — the `cache` rule)
//
// The fixed strings in `now` are Chinese on purpose: this fork's recap text is Chinese, and a push
// body is exempt from i18n (CLAUDE.md § frontend data layer). A blocked or prompt description also
// carries the `parts` it was built from, so the phone and the island say the sentence in their own
// language; `now` stays whole for the push body and for a client that predates `parts`. Blocked
// costs no model call and no network.

import { HOST } from "../host.ts";
import type { AgentStatus } from "../types.ts";
import type { TranscriptEntry } from "../journal/types.ts";

/** The one description. Rides the wire on `AgentView.description`, attached at serialise time. */
export interface PaneDescription {
  now: string;
  goal?: string;
  next?: string;
  source: "recap" | "blocked" | "prompt";
  /** Epoch ms the words describe: the recap's own `at`, the prompt's timestamp, or the blocked read. */
  at: number;
  /**
   * What a blocked or prompt `now` was composed from, without its Chinese prefix. Blocked: the
   * pending tool and its target, each absent when `now` names none. Prompt: the operator's line.
   * Absent on a recap, whose words are the agent's own.
   */
  parts?: DescriptionParts;
}

export interface DescriptionParts {
  tool?: string;
  target?: string;
  prompt?: string;
}

/** A recap file, as the Claude Code plugin writes it to `~/.cache/cc-recap/<sessionId>.json`. */
export interface Recap {
  at: number;
  now: string;
  goal?: string;
  next?: string;
}

/** The two facts the resolver needs off a journal tail. */
export interface JournalFacts {
  /** The newest operator prompt, collapsed to one line, and when it was sent (epoch ms). */
  prompt?: { text: string; at: number };
  /** The newest assistant turn's tool call that has no result yet. */
  pendingTool?: { name: string; summary: string };
}

export interface DescribeInput {
  status: AgentStatus;
  recap?: Recap;
  facts?: JournalFacts;
  /** When the blocked sentence is stamped. The caller's clock; the resolver has none. */
  now: number;
}

export const BLOCKED_PREFIX = "在等你批准";
export const PROMPT_PREFIX = "你：";
const PROMPT_MAX = 80;
const TARGET_MAX = 40;

/** Collapse whitespace to one line and clip with an ellipsis. */
export function clipLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * The target half of the blocked sentence. The tool summary is already one line
 * (journal/text.ts § summarizeToolInput), with `file_path` outranking `command`, so a path reads as
 * its basename and a shell call as its first line; anything else is omitted rather than guessed.
 */
export function toolTarget(tool: { name: string; summary: string }): string | undefined {
  const s = tool.summary.trim();
  if (s === "") return undefined;
  // The summary is a path the agent wrote, in this host's spelling. `~/` is the one relative form
  // that still means "take the last segment": the journal keeps the tilde rather than expanding it.
  const home = s.startsWith("~/") || s.startsWith("~\\");
  if (home || HOST.path.isAbsolute(s)) {
    const base = HOST.path.basename(home ? s.slice(2) : s);
    return base === "" ? undefined : clipLine(base, TARGET_MAX);
  }
  if (/bash|shell|exec|command/i.test(tool.name)) return clipLine(s.split("\n")[0] ?? s, TARGET_MAX);
  return undefined;
}

function blockedParts(tool: JournalFacts["pendingTool"]): DescriptionParts {
  if (tool === undefined) return {};
  const target = toolTarget(tool);
  return target === undefined ? { tool: tool.name } : { tool: tool.name, target };
}

function blockedNow(parts: DescriptionParts): string {
  if (parts.tool === undefined) return BLOCKED_PREFIX;
  return parts.target === undefined ? `${BLOCKED_PREFIX} ${parts.tool}` : `${BLOCKED_PREFIX} ${parts.tool} · ${parts.target}`;
}

function withRecapExtras(d: PaneDescription, recap: Recap | undefined): PaneDescription {
  const out: PaneDescription = { ...d };
  if (recap?.goal !== undefined) out.goal = recap.goal;
  if (recap?.next !== undefined) out.next = recap.next;
  return out;
}

/** The four rules. Undefined means the pane carries no `description` key at all. */
export function describePane(input: DescribeInput): PaneDescription | undefined {
  const { status, recap, facts } = input;
  if (status === "blocked") {
    const parts = blockedParts(facts?.pendingTool);
    return withRecapExtras({ now: blockedNow(parts), source: "blocked", at: input.now, parts }, recap);
  }
  const prompt = facts?.prompt;
  if (recap !== undefined && (prompt === undefined || prompt.at <= recap.at)) {
    return withRecapExtras({ now: recap.now, source: "recap", at: recap.at }, recap);
  }
  if (prompt !== undefined) {
    const line = clipLine(prompt.text, PROMPT_MAX);
    return { now: `${PROMPT_PREFIX}${line}`, source: "prompt", at: prompt.at, parts: { prompt: line } };
  }
  return undefined;
}

/**
 * The facts off a parsed journal tail. The newest `user` entry with text is the prompt; the newest
 * `assistant` entry's last result-less tool call is the pending one.
 */
export function journalFacts(entries: readonly TranscriptEntry[], undatedAt?: number): JournalFacts {
  const facts: JournalFacts = {};
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e === undefined || e.role !== "user") continue;
    const text = e.parts
      .flatMap((p) => (p.kind === "text" ? [p.text] : []))
      .join(" ")
      .trim();
    const parsed = Date.parse(e.ts);
    const at = Number.isFinite(parsed) ? parsed : undatedAt;
    if (text === "" || at === undefined) continue;
    facts.prompt = { text: clipLine(text, PROMPT_MAX * 2), at };
    break;
  }
  const assistant = entries.findLast((e) => e.role === "assistant");
  const tool = assistant?.parts.findLast((p) => p.kind === "tool" && p.result === undefined);
  if (tool?.kind === "tool") facts.pendingTool = { name: tool.name, summary: tool.summary };
  return facts;
}
