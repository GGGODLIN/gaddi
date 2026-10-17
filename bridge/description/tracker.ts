// Who reads the two inputs of a pane's description, and how often. The same shape as
// bridge/cache/tracker.ts, whose header argues every choice below; only the differences are stated.
//
//   • OUT OF BAND. `localSnapshot` is synchronous, so the disk reads run on the state engine's poll
//     and the snapshot reads this memo, through {@link DescriptionTracker.describe}.
//   • A FLOOR PER SESSION (5 s), then a `stat` before any read. A journal tail (128 KB, the cache
//     probe's window, through `probeTail`) is read only when the log's size or mtime moved; a recap
//     file only when its own did.
//   • A FAILED READ KEEPS THE LAST READING. A missing recap file is not a failure: it means no recap.
//   • KEYED BY THE HARNESS SESSION ID, reaped only when the pane leaves ITS session's list.
//
// The status is NOT memoised. `describe` is handed the pane as it is now, so a pane that blocks shows
// the blocked sentence on the very next snapshot, without waiting for the floor.
//
// File-backed journals are tailed (claude, codex, pi, omp, grok, muse): `probeTail` reads a path.
// opencode resolves to a database key, not one log file, so its session is read whole through its
// source's own `load`, which composes the rows and caps them. A pane whose multiplexer reports no
// session (Muse under Herdr) is found by its folder, the way the chat route finds it. Only a Claude
// pane has a recap file. NOTHING IS PERSISTED.

import { probeTail, type ProbeTail } from "../journal/cache-probe.ts";
import { DEFAULT_RECAP_DIR, readRecap, statRecap } from "../journal/recap.ts";
import { adapterFor } from "../journal/registry.ts";
import type { AgentSessionRef, JournalAdapter, TranscriptSource } from "../journal/types.ts";
import { journalAgentOf, type AgentView } from "../types.ts";
import { describePane, journalFacts, type JournalFacts, type PaneDescription, type Recap } from "./resolve.ts";
import { DEFAULT_TASKS_DIR, parseJournalTodos, readClaudeTasks, type PaneTodo } from "./todos.ts";

export const DEFAULT_DESCRIPTION_FLOOR_MS = 5000;

/**
 * The one wider read, taken only when the 128 KB tail holds no prompt AND no earlier read found one.
 * A busy Claude turn writes far more than 128 KB of tool output after the prompt that started it
 * (measured 2026-09-24: 540 KB on a live session), so a fresh bridge would otherwise show nothing for
 * every working pane until the operator typed again.
 */
export const WIDE_TAIL_BYTES = 4 * 1024 * 1024;

/** The harnesses whose journal is one log file a tail read can open. */
export const TAILED_AGENTS: ReadonlySet<string> = new Set(["claude", "codex", "pi", "omp", "grok", "muse"]);

/** The database-backed harness whose session is read whole through `source.load`. */
export const LOADED_AGENTS: ReadonlySet<string> = new Set(["opencode"]);

export interface DescriptionTrackerOptions {
  floorMs?: number;
  /** Where the recap plugin writes. A containment root, never a request input. */
  recapDir?: string;
  /** Where Claude Code writes per-session task JSON files. A containment root, never a request input. */
  tasksDir?: string;
  /** The tail read, injectable so a test counts reads instead of opening files. */
  tail?: (source: TranscriptSource, ref: AgentSessionRef, bytes?: number) => Promise<ProbeTail | null>;
}

interface Seen {
  size: number;
  mtimeMs: number;
}

interface Entry {
  session: string | undefined;
  paneId: string;
  lastProbedAt: number;
  journalSeen?: Seen;
  facts?: JournalFacts;
  todos?: PaneTodo[];
  recapSeen?: Seen;
  recap?: Recap;
}

interface Found {
  session: string | undefined;
  at: number;
  ref: AgentSessionRef | undefined;
}

export class DescriptionTracker {
  private readonly bySession = new Map<string, Entry>();

  /** The session a ref-less pane was found to run, per pane id, held for one floor. */
  private readonly found = new Map<string, Found>();

  private readonly floorMs: number;

  private readonly recapDir: string;

  private readonly tasksDir: string;

  private readonly tail: NonNullable<DescriptionTrackerOptions["tail"]>;

  constructor(
    private readonly registry: Record<string, JournalAdapter>,
    private readonly now: () => number,
    options: DescriptionTrackerOptions = {},
  ) {
    this.floorMs = options.floorMs ?? DEFAULT_DESCRIPTION_FLOOR_MS;
    this.recapDir = options.recapDir ?? DEFAULT_RECAP_DIR;
    this.tasksDir = options.tasksDir ?? DEFAULT_TASKS_DIR;
    this.tail = options.tail ?? ((source, ref, bytes) => probeTail(source, ref, bytes));
  }

  /**
   * The description for this pane as it is now, or undefined. A synchronous map read.
   * `blockedAt` stamps the blocked sentence; the activity ledger's transition time is the right one.
   */
  describe(pane: AgentView, blockedAt?: number): PaneDescription | undefined {
    const key = pane.agentSession?.value ?? this.found.get(pane.paneId)?.ref?.value;
    const entry = key === undefined ? undefined : this.bySession.get(key);
    return describePane({
      status: pane.status,
      recap: entry?.recap,
      facts: entry?.facts,
      now: blockedAt ?? entry?.lastProbedAt ?? this.now(),
    });
  }

  /** The active todo list for this pane as it is now, or undefined when there are none. */
  todos(pane: AgentView): PaneTodo[] | undefined {
    const key = pane.agentSession?.value ?? this.found.get(pane.paneId)?.ref?.value;
    const list = key === undefined ? undefined : this.bySession.get(key)?.todos;
    return list !== undefined && list.length > 0 ? list : undefined;
  }

  /** Walk the panes and bring their readings up to date. NEVER THROWS. */
  async refresh(panes: readonly AgentView[], scope: { session?: string } = {}): Promise<void> {
    const at = this.now();
    const session = scope.session;
    const named = new Map<string, string | undefined>();
    for (const pane of panes) {
      const harness = journalAgentOf(pane);
      const loaded = LOADED_AGENTS.has(harness);
      const adapter = TAILED_AGENTS.has(harness) || loaded ? adapterFor(this.registry, harness) : undefined;
      const ref = pane.agentSession ?? (await this.discover(adapter, pane, at, session));
      named.set(pane.paneId, ref?.value);
      if (ref === undefined) continue;
      const wantsRecap = harness === "claude" && ref.kind === "id";
      if (adapter === undefined && !wantsRecap) continue;
      const previous = this.bySession.get(ref.value);
      const owner = { session, paneId: pane.paneId };
      if (previous !== undefined && at - previous.lastProbedAt < this.floorMs) {
        this.bySession.set(ref.value, { ...previous, ...owner });
        continue;
      }
      const next: Entry = { ...previous, ...owner, lastProbedAt: at };
      if (adapter !== undefined) await this.lookJournal(adapter, ref, next, loaded);
      if (wantsRecap) {
        await this.lookRecap(ref.value, next);
        await this.lookTasks(ref.value, next);
      }
      this.bySession.set(ref.value, next);
    }
    for (const [key, entry] of this.bySession) {
      if (entry.session === session && departed(named, key, entry.paneId)) this.bySession.delete(key);
    }
    for (const [paneId, found] of this.found) {
      if (found.session === session && !named.has(paneId)) this.found.delete(paneId);
    }
  }

  /**
   * The session of a pane whose multiplexer reports none, through the adapter's own `discover`, the
   * call the chat route makes. Held per pane for one floor: a discovery walks the harness's session
   * folders, and the poll runs every few seconds. A failed walk keeps the last answer.
   */
  private async discover(
    adapter: JournalAdapter | undefined,
    pane: AgentView,
    at: number,
    session: string | undefined,
  ): Promise<AgentSessionRef | undefined> {
    if (adapter?.discover === undefined) return undefined;
    const seen = this.found.get(pane.paneId);
    if (seen !== undefined && at - seen.at < this.floorMs) return seen.ref;
    let ref = seen?.ref;
    try {
      ref = (await adapter.discover(pane.cwd)) ?? undefined;
    } catch {
      // A walk that threw: the last answer stands until the next floor.
    }
    this.found.set(pane.paneId, { session, at, ref });
    return ref;
  }

  private async lookJournal(adapter: JournalAdapter, ref: AgentSessionRef, entry: Entry, loaded: boolean): Promise<void> {
    let seen: Seen | null;
    try {
      const path = await adapter.source.resolve(ref);
      seen = path === null ? null : await adapter.source.stat(path);
    } catch {
      seen = null;
    }
    if (seen === null) return;
    if (entry.journalSeen?.size === seen.size && entry.journalSeen.mtimeMs === seen.mtimeMs) return;
    const tail = loaded ? await loadWhole(adapter.source, ref) : await this.tail(adapter.source, ref);
    if (tail === null) return;
    try {
      // A row with no time of its own (Grok writes none) is dated by the log's mtime.
      let facts = journalFacts(adapter.parse(tail.lines.join("\n")), tail.mtimeMs);
      // A tail with no prompt means the newest prompt is older than the window, so it is the one an
      // earlier read already found. Only when none was ever found is the wider window worth paying.
      const kept = entry.facts?.prompt;
      if (facts.prompt === undefined && kept !== undefined) facts = { ...facts, prompt: kept };
      // A loaded session is already its whole capped window; there is nothing wider to read.
      if (facts.prompt === undefined && !loaded) {
        const wide = await this.tail(adapter.source, ref, WIDE_TAIL_BYTES);
        const prompt = wide === null ? undefined : journalFacts(adapter.parse(wide.lines.join("\n")), wide.mtimeMs).prompt;
        if (prompt !== undefined) facts = { ...facts, prompt };
      }
      const todos = parseJournalTodos(tail.lines, entry.todos);
      if (todos === undefined) delete entry.todos;
      else entry.todos = todos;
      entry.facts = facts;
      entry.journalSeen = seen;
    } catch {
      // A grammar that threw on a foreign line: keep the last facts, retry at the next floor.
    }
  }

  private async lookTasks(sessionId: string, entry: Entry): Promise<void> {
    try {
      const disk = await readClaudeTasks(this.tasksDir, sessionId);
      if (disk !== undefined) entry.todos = disk;
    } catch {
      // An I/O failure mid-read: the journal or last reading stands until the next floor.
    }
  }

  private async lookRecap(sessionId: string, entry: Entry): Promise<void> {
    let st;
    try {
      st = await statRecap(this.recapDir, sessionId);
    } catch {
      st = null;
    }
    if (st === null) {
      delete entry.recap;
      delete entry.recapSeen;
      return;
    }
    if (entry.recapSeen?.size === st.size && entry.recapSeen.mtimeMs === st.mtimeMs) return;
    try {
      const recap = await readRecap(st.path);
      if (recap === undefined) delete entry.recap;
      else entry.recap = recap;
      entry.recapSeen = { size: st.size, mtimeMs: st.mtimeMs };
    } catch {
      // An I/O failure mid-read: the last reading stands and the next floor retries.
    }
  }
}

/** A database-backed session read whole through `source.load`, shaped like a tail read. */
async function loadWhole(source: TranscriptSource, ref: AgentSessionRef): Promise<ProbeTail | null> {
  try {
    const path = await source.resolve(ref);
    if (path === null) return null;
    const read = await source.load(path);
    return { path, lines: read.text.split("\n"), mtimeMs: read.mtimeMs };
  } catch {
    return null;
  }
}

/** Has the pane this entry was read for left the session's list? Same rule as the cache tracker. */
function departed(named: Map<string, string | undefined>, key: string, paneId: string): boolean {
  if (!named.has(paneId)) return true;
  const now = named.get(paneId);
  return now !== undefined && now !== key;
}
