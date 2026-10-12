import type { MuxAdapter } from "./mux/types.ts";

// Restart one Claude pane on another account, in the SAME pane, continuing the same session.
//
// This is the first Collie action that ends an agent and starts one, so every step is ordered to
// fail toward "nothing new started": the new process is typed only after the old one is PROVEN gone,
// because two Claude processes writing one transcript corrupt it. An unconfirmed exit returns an
// error and launches nothing; nothing here is ever retried.
//
// The sequence is the one measured on Claude Code 2.1.283 (2026-09-26):
//   • working → one ctrl+c interrupts the turn and puts the sent prompt back in the input box;
//   • blocked → Escape closes the permission or question dialog and leaves the input box empty
//     (ctrl+c leaves the dialog up: measured on 2.1.296, 2026-10-12);
//   • ctrl+c on a non-empty input box clears it;
//   • `/exit` then exits and prints `claude --resume <id>`, and Herdr drops the pane's agent;
//   • `<account command> --resume <id>` restores the last turn's model, effort and 1M context, but
//     not the permission mode, which the line carries itself (`lastPermissionMode`).
// `/exit` is typed only once the screen shows an EMPTY input row: otherwise the prompt an interrupt
// handed back would be submitted with `/exit` appended. An idle pane's draft is refused, not cleared.

export interface SwitchPlan {
  readonly paneId: string;
  readonly sessionId: string;
  readonly command: string;
  /** The session's last permission mode ({@link lastPermissionMode}); null leaves the account's default. */
  readonly permissionMode: string | null;
  /** The pane was working or blocked when the phone asked, so its turn is interrupted first; null when idle. */
  readonly interrupt: "working" | "blocked" | null;
}

export type SwitchOutcome =
  | { readonly ok: true }
  /** Keys or text did not reach the pane before the old process was confirmed gone. */
  | { readonly ok: false; readonly stage: "exit"; readonly reason: string }
  /** The old process was never confirmed gone, so nothing was started. */
  | { readonly ok: false; readonly stage: "unconfirmed" }
  /** An idle Claude's input row held text the operator never sent. Nothing was sent to the pane. */
  | { readonly ok: false; readonly stage: "draft" }
  /** The input row was not on screen, or did not clear, so `/exit` was never typed. */
  | { readonly ok: false; readonly stage: "input_row"; readonly row: "missing" | "stuck" }
  /** The old process is gone but the new line did not reach the pane. */
  | { readonly ok: false; readonly stage: "launch"; readonly reason: string };

export interface SwitchClock {
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

type SwitchMux = Pick<MuxAdapter, "sendKeys" | "typeText" | "readGrid" | "snapshot">;

/** Long enough for an interrupted turn to hand the input box back (measured under 2s). */
const INTERRUPT_SETTLE_MS = 1500;
/** Between the clearing ctrl+c and typing, so the keypress is not read as part of the text. */
const KEY_SETTLE_MS = 300;
/** Exit measured at under 4s; the bound leaves room for a slow Stop hook. */
const EXIT_CEILING_MS = 20_000;
const EXIT_POLL_MS = 500;
/** How far up the screen the printed resume line may sit and still belong to THIS exit. */
const EXIT_TAIL_LINES = 8;
/** Clearing ctrl+c presses tried before the switch gives up on an input row that stays full. */
const CLEAR_ATTEMPTS = 2;

const ESC = "\u001b";

/**
 * A styled row's characters with the faint (SGR 2) runs taken out. Claude draws its placeholder
 * (`Try "…"`) and its next-step suggestion faint inside an empty input box, while typed text and a
 * paste's `[Pasted text #N]` token are drawn at normal weight (measured on Claude Code 2.1.296,
 * 2026-10-12). Read without styling, the two cannot be told apart, and every idle Claude that had
 * answered once was refused as holding a draft.
 */
function unfaint(row: string): string {
  let out = "";
  let faint = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row.charAt(i);
    if (ch !== ESC) {
      if (!faint) out += ch;
      continue;
    }
    if (row.charAt(i + 1) !== "[") continue;
    let j = i + 2;
    while (j < row.length && !/[@-~]/.test(row.charAt(j))) j++;
    if (row[j] === "m") {
      const params = row.slice(i + 2, j).split(";");
      for (let k = 0; k < params.length; k++) {
        const p = params[k];
        if (p === "" || p === "0" || p === "22") faint = false;
        else if (p === "2") faint = true;
        // An extended colour's own fields (`38;2;r;g;b`, `38;5;n`) are not attributes: the `2` in
        // `38;2;…` is "truecolour", and reading it as faint would hide the text that follows.
        else if (p === "38" || p === "48" || p === "58") k += params[k + 1] === "5" ? 2 : 4;
      }
    }
    i = j;
  }
  return out;
}

/**
 * Whether Claude's input row is empty: the LOWEST `❯` row on screen, which is the input box's (the
 * transcript above echoes earlier prompts with the same mark), read from a STYLED grid so that faint
 * placeholder text counts as empty. Null when no such row is on screen, which the caller treats as
 * "cannot tell" and refuses on.
 */
export function inputRowEmpty(screen: string): boolean | null {
  const rows = screen
    .split(/\r?\n/)
    .map(unfaint)
    .filter((line) => line.trimStart().startsWith("❯"));
  const row = rows.at(-1);
  return row === undefined ? null : row.trim() === "❯";
}

/**
 * Whether the screen shows this session's own exit line at its foot.
 *
 * The tail bound is what stops an OLD exit of the same session from counting: the pane that ran
 * `cc --resume <id>` before holds that id higher up its scrollback, and a live Claude covers the
 * foot of the screen with its own frame.
 */
export function exitLineShown(screen: string, sessionId: string): boolean {
  const tail = screen
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(-EXIT_TAIL_LINES);
  return tail.some((line) => line.includes(`claude --resume ${sessionId}`));
}

/**
 * Whether the operator changed the model or effort after the session's last answer.
 *
 * `--resume` restores the settings of the last TURN, so such a change would be silently undone by a
 * switch; the route refuses instead and asks for one more message first. Pure over the log's text.
 */
export function settingsChangedSinceLastTurn(jsonl: string): boolean {
  let changed = false;
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let row: { type?: string; message?: { content?: string } };
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.type === "assistant") changed = false;
    else if (row.type === "user" && /<command-name>\/(?:model|effort)<\/command-name>/.test(row.message?.content ?? "")) {
      changed = true;
    }
  }
  return changed;
}

/** What `claude --permission-mode` takes (its `--help` on 2.1.x), plus `default`, which it still accepts. */
const PERMISSION_MODES: ReadonlySet<string> = new Set([
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "default",
  "dontAsk",
  "manual",
  "plan",
]);

/**
 * The permission mode the session was last seen in, or null when the log names none that may be typed.
 *
 * A new Claude starts in its account's default mode, so without this a session that asked before
 * each command could come back on an account that allows everything. Two rows carry the mode: the
 * `permission-mode` row a process writes as it starts, and each prompt the operator sends, which is
 * where a Shift+Tab change first shows (measured 2026-10-12). The last of either wins; a mode changed
 * with no prompt since is not in the log yet. The value is typed into a terminal, so one outside the
 * flag's own choices is dropped, never passed on and never swapped for an older one.
 */
export function lastPermissionMode(jsonl: string): string | null {
  let mode: string | null = null;
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let row: { type?: string; permissionMode?: string };
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    // The set lookup is the parse: a non-string or unknown value matches nothing and is not carried.
    if ((row.type === "permission-mode" || row.type === "user") && row.permissionMode !== undefined) {
      mode = row.permissionMode;
    }
  }
  return mode !== null && PERMISSION_MODES.has(mode) ? mode : null;
}

/** An account command that already sets a mode is the operator's choice; a second flag would contradict it. */
const OWN_MODE_FLAG = /(?:^|\s)--(?:permission-mode|dangerously-skip-permissions)(?=[\s=]|$)/;

/** The line typed into the pane once the old Claude is gone. */
export function resumeLine(command: string, sessionId: string, mode: string | null): string {
  const line = `${command} --resume ${sessionId}`;
  return mode === null || OWN_MODE_FLAG.test(command) ? line : `${line} --permission-mode ${mode}`;
}

async function exited(mux: SwitchMux, plan: SwitchPlan, clock: SwitchClock): Promise<boolean> {
  const started = clock.now();
  for (;;) {
    await clock.sleep(EXIT_POLL_MS);
    try {
      const snapshot = await mux.snapshot();
      const pane = snapshot.panes.find((p) => p.paneId === plan.paneId);
      const read = await mux.readGrid(plan.paneId, { scope: "viewport", lines: 60, styling: "strip" });
      // Both, never either: the agent field can lag an exit, and the printed line can survive from an
      // exit whose process a second Claude replaced.
      if (pane !== undefined && pane.agent !== "claude" && read.ok && exitLineShown(read.value.text, plan.sessionId)) {
        return true;
      }
    } catch {
      // An unreadable pane mid-exit is "not yet", never proof of anything.
    }
    if (clock.now() - started >= EXIT_CEILING_MS) return false;
  }
}

export async function switchAccount(mux: SwitchMux, plan: SwitchPlan, clock: SwitchClock): Promise<SwitchOutcome> {
  const keys = async (k: readonly string[]) => {
    const sent = await mux.sendKeys(plan.paneId, k);
    return sent.ok ? null : sent.detail;
  };
  if (plan.interrupt !== null) {
    const failed = await keys([plan.interrupt === "blocked" ? "Escape" : "ctrl+c"]);
    if (failed !== null) return { ok: false, stage: "exit", reason: failed };
    await clock.sleep(INTERRUPT_SETTLE_MS);
  }
  for (let attempt = 0; ; attempt++) {
    const read = await mux.readGrid(plan.paneId, { scope: "viewport", lines: 60, styling: "preserve" });
    const empty = read.ok ? inputRowEmpty(read.value.text) : null;
    if (empty === true) break;
    if (empty === null) return { ok: false, stage: "input_row", row: "missing" };
    // Idle, the text in the row is a draft the operator typed and never sent, and a ctrl+c would lose
    // it for good. After an interrupt it is the prompt just handed back, already in the transcript.
    if (plan.interrupt === null) return { ok: false, stage: "draft" };
    if (attempt >= CLEAR_ATTEMPTS) return { ok: false, stage: "input_row", row: "stuck" };
    const cleared = await keys(["ctrl+c"]);
    if (cleared !== null) return { ok: false, stage: "exit", reason: cleared };
    await clock.sleep(KEY_SETTLE_MS);
  }
  const typed = await mux.typeText(plan.paneId, "/exit");
  if (!typed.ok) return { ok: false, stage: "exit", reason: typed.detail };
  await clock.sleep(KEY_SETTLE_MS);
  const submitted = await keys(["Enter"]);
  if (submitted !== null) return { ok: false, stage: "exit", reason: submitted };

  if (!(await exited(mux, plan, clock))) return { ok: false, stage: "unconfirmed" };

  const launched = await mux.typeText(plan.paneId, resumeLine(plan.command, plan.sessionId, plan.permissionMode));
  if (!launched.ok) return { ok: false, stage: "launch", reason: launched.detail };
  await clock.sleep(KEY_SETTLE_MS);
  const run = await keys(["Enter"]);
  if (run !== null) return { ok: false, stage: "launch", reason: run };
  return { ok: true };
}
