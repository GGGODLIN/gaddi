// The one classification the whole app agrees on: what needs you, then what's newly ready, then
// what's running, then everything else. Every mark reads it (the row wash, the chip dots, the
// summary line), kept in one place so no two surfaces can disagree about what needs you.
//
// It classifies every pane; the dashboard keeps place order (ADR 0063), while the two operator-opened
// switchers arrange a frozen snapshot by bucket (ADR 9004).
//
// It puts each pane in a BUCKET and orders by its latest state change (see {@link triage}).
// The two timestamps the bridge keeps per pane (bridge/activity.ts) still decide one bucket:
//   lastActiveAt — when the agent last changed status
//   lastSeenAt   — when you last opened or drove it through Collie
// "settled since you last looked" is `lastActiveAt > lastSeenAt`, which is the Ready·unseen bucket.
import type { AgentStatus, AgentView } from "./types";
import { t } from "./i18n";

/** Which way the Recent section runs. Attention sections never invert. */
export type RecentDir = "newest" | "oldest";

export type TriageKey = "needs" | "ready" | "working" | "recent";

export interface TriageSection {
  key: TriageKey;
  label: string;
  /** Render the heading in the alert colour (the "needs you" group). */
  accent?: boolean;
  /** Section bullet class — the same status palette the badges use, so a section's colour can't
   *  drift from the status it collects. */
  dot: string;
  /** Whether the user may fold this section away. Attention sections may not: collapsing an alert
   *  defeats the alert. */
  collapsible?: boolean;
  agents: AgentView[];
}

/**
 * An agent that finished while you weren't looking. NOT a stored flag — it's this comparison, which
 * is why opening the pane clears it with no bookkeeping: the read bumps `lastSeenAt` past
 * `lastActiveAt` and the agent falls into Recent on the next poll.
 *
 * Herdr 0.9 reports a completion as `idle`; its TUI derives `done` from its own read receipts.
 * Collie owns separate receipts, so both settled statuses must use OUR timestamps. First sightings
 * are seeded with equal timestamps by the ledger; an idle pane is not unread just because it exists.
 * Both timestamps absent (an older bridge) yields `false`, so the section is simply empty there.
 */
export function isUnseen(a: AgentView): boolean {
  return a.kind !== "shell" &&
    (a.status === "done" || a.status === "idle") &&
    (a.lastActiveAt ?? 0) > (a.lastSeenAt ?? 0);
}

/** Which section an agent belongs to. The single classifier — {@link triage} and
 *  {@link worstTriage} both route through it, so a list and a chip can't disagree. */
export function bucketOf(a: AgentView): TriageKey {
  if (a.status === "blocked") return "needs";
  if (isUnseen(a)) return "ready";
  if (a.status === "working") return "working";
  return "recent";
}

/**
 * The buckets that mean "a human is required here": what the dashboard's summary line counts, what
 * lights a heading, and the one predicate the "Focus" tab filters by (ADR 0066, renamed by ADR 0068).
 */
export const ATTENTION: ReadonlySet<TriageKey> = new Set<TriageKey>(["needs", "ready"]);

/** Whether a pane is in an {@link ATTENTION} bucket. */
export function needsYou(a: AgentView): boolean {
  return ATTENTION.has(bucketOf(a));
}

/**
 * How many panes are blocked on you (the "needs" bucket alone): the "Focus" tab's red count.
 * A finished pane you have not opened is not counted here; the tab marks it with the quiet dot
 * instead, because a count should mean something is waiting on you (ADR 0066).
 */
export function countBlocked(agents: readonly AgentView[]): number {
  let n = 0;
  for (const a of agents) if (bucketOf(a) === "needs") n++;
  return n;
}

/**
 * How many panes have an alert out on the bridge (bridge/notifications.ts), for the installed app's
 * icon (lib/app-badge.ts): the blocked ones, and the finished ones you have not opened, each only
 * while that kind notifies.
 */
export function countAlerting(agents: readonly AgentView[], kinds: { blocked: boolean; done: boolean }): number {
  let n = 0;
  for (const a of agents) {
    const bucket = bucketOf(a);
    if ((bucket === "needs" && kinds.blocked) || (bucket === "ready" && kinds.done)) n++;
  }
  return n;
}

/** Whether any pane is in the "ready" bucket: finished and unseen. The "Focus" tab's dot. */
export function hasReady(agents: readonly AgentView[]): boolean {
  return agents.some((a) => bucketOf(a) === "ready");
}

/** Display order, most urgent first. */
export const TRIAGE_ORDER: readonly TriageKey[] = ["needs", "ready", "working", "recent"];

/**
 * The status one representative {@link StatusDot} should show for a bucket, so a tab chip, a space
 * chip and a list row all draw the same colour for the same meaning.
 */
export const TRIAGE_STATUS = {
  needs: "blocked",
  ready: "done",
  working: "working",
  recent: "idle",
} satisfies Record<TriageKey, AgentStatus>;

/**
 * The most urgent bucket among a set of panes — what a tab or space chip should advertise. Null when
 * the set holds no agent at all, which is deliberately NOT the same as "idle": an empty tab has
 * nothing to report, and showing it a resting dot would claim otherwise.
 */
export function worstTriage(agents: readonly AgentView[]): TriageKey | null {
  let best: number | null = null;
  for (const a of agents) {
    const rank = TRIAGE_ORDER.indexOf(bucketOf(a));
    if (best === null || rank < best) best = rank;
  }
  return best === null ? null : TRIAGE_ORDER[best]!;
}

/** Fresh every call so a caller re-rendering after a `setLocale()` picks up the new language —
 *  see the `useLocale()` note on every component that calls {@link triage} / {@link sectionHeaderProps}. */
function sectionMeta() {
  return {
    needs: { key: "needs", label: t("status.section.needsYou"), accent: true, dot: "bg-status-blocked" },
    ready: { key: "ready", label: t("status.section.readyUnseen"), dot: "bg-status-done" },
    working: { key: "working", label: t("status.section.working"), dot: "bg-status-working" },
    recent: { key: "recent", label: t("status.section.recent"), dot: "bg-status-idle", collapsible: true },
  } satisfies Record<TriageKey, Omit<TriageSection, "agents">>;
}

/**
 * Bucket and order a herd. Returns every section (including empty ones) in fixed display order —
 * callers drop the empties, which keeps "which sections exist" a property of this module rather
 * than something each view re-derives.
 *
 * The first three sections are pinned: they never move and never invert. `dir` reaches Recent only.
 *
 * ── INSIDE A BUCKET, THE LATEST STATE CHANGE FIRST ───────────────────────────
 * Herdr's own `agent_panel_sort = "priority"` orders its panel this way (status, then the newest
 * state change), and the operator reads both lists side by side, so the phone matches it (ADR 9003).
 * A pane with no `lastActiveAt` (an older bridge) sinks below the timed ones and otherwise keeps the
 * order it was sent. The switcher freezes its rows when it opens, so this does not move a row under
 * a thumb; place-ordered surfaces never call this for position (ADR 0063).
 *
 * `dir` reverses Recent only, because that one is the operator asking, not the clock deciding.
 */
export function triage(agents: readonly AgentView[], dir: RecentDir = "newest"): TriageSection[] {
  const needsIn: AgentView[] = [];
  const readyIn: AgentView[] = [];
  const workingIn: AgentView[] = [];
  const recentIn: AgentView[] = [];

  const into = { needs: needsIn, ready: readyIn, working: workingIn, recent: recentIn };
  for (const a of agents) into[bucketOf(a)].push(a);

  const needs = newestFirst(needsIn);
  const ready = newestFirst(readyIn);
  const working = newestFirst(workingIn);
  const recentNewest = newestFirst(recentIn);
  const recent = dir === "oldest" ? recentNewest.toReversed() : recentNewest;

  const meta = sectionMeta();
  return [
    { ...meta.needs, agents: needs },
    { ...meta.ready, agents: ready },
    { ...meta.working, agents: working },
    { ...meta.recent, agents: recent },
  ];
}

function newestFirst(agents: readonly AgentView[]): AgentView[] {
  return agents.toSorted((a, b) => {
    if (a.lastActiveAt === undefined) return b.lastActiveAt === undefined ? 0 : 1;
    if (b.lastActiveAt === undefined) return -1;
    return b.lastActiveAt - a.lastActiveAt;
  });
}

/** The other direction — for the toggle. */
export function flipDir(dir: RecentDir): RecentDir {
  return dir === "newest" ? "oldest" : "newest";
}

/** Statuses that put an agent in an attention section (so a caller can tint a row without
 *  re-deriving the rule). */
export function isAttention(status: AgentStatus): boolean {
  return status === "blocked";
}
