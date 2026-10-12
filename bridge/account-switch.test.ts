import { describe, expect, test } from "bun:test";

import {
  exitLineShown,
  inputRowEmpty,
  lastPermissionMode,
  resumeLine,
  settingsChangedSinceLastTurn,
  switchAccount,
  type SwitchClock,
  type SwitchPlan,
} from "./account-switch.ts";
import { validateOperatorAccounts } from "./operator-accounts.ts";
import type { MuxAck, MuxGrid, MuxOutcome, MuxSnapshot } from "./mux/types.ts";

const SID = "1519794a-e8f5-4a29-a687-f3154a08c1b2";
const ok: MuxAck = { ok: true, value: undefined };

function fakeClock(): SwitchClock {
  let t = 0;
  return { sleep: async (ms) => void (t += ms), now: () => t };
}

/** A pane whose Claude exits `exitAfterPolls` snapshot reads after `/exit` is submitted. */
function fakeMux(opts: {
  exitAfterPolls: number | null;
  screenAfterExit?: string;
  launchFails?: boolean;
  /** A draft sits in the input row until this many ctrl+c presses; null = it never clears. */
  draftClearsAfter?: number | null;
  /** What an empty input row looks like on this screen, styled as the multiplexer returns it. */
  emptyRow?: string;
  /** A permission dialog is up until Escape is pressed; ctrl+c leaves it, as Claude does. */
  dialog?: boolean;
}) {
  const calls: string[] = [];
  let submittedExit = false;
  let clears = 0;
  let dialog = opts.dialog === true;
  const draft = () =>
    opts.draftClearsAfter !== undefined && (opts.draftClearsAfter === null || clears < opts.draftClearsAfter);
  let polls = 0;
  const gone = () => submittedExit && opts.exitAfterPolls !== null && polls > opts.exitAfterPolls;
  const mux = {
    async sendKeys(_pane: string, keys: readonly string[]): Promise<MuxAck> {
      calls.push(`keys:${keys.join(",")}`);
      if (keys[0] === "ctrl+c" && !dialog) clears += 1;
      if (keys[0] === "Escape") dialog = false;
      if (keys[0] === "Enter" && calls.at(-2) === "text:/exit") submittedExit = true;
      return ok;
    },
    async typeText(_pane: string, text: string): Promise<MuxAck> {
      calls.push(`text:${text}`);
      if (opts.launchFails && text.includes("--resume")) return { ok: false, reason: "refused", detail: "pane gone" };
      return ok;
    },
    async snapshot(): Promise<MuxSnapshot> {
      polls += submittedExit ? 1 : 0;
      // SAFETY: the switch reads only paneId and agent off a pane.
      const pane = { paneId: "w1:p1", agent: gone() ? "shell" : "claude" } as MuxSnapshot["panes"][number];
      return { panes: [pane], spaces: [], tabs: [] };
    },
    async readGrid(): Promise<MuxOutcome<MuxGrid>> {
      const text = gone()
        ? (opts.screenAfterExit ?? `Resume this session with:\nclaude --resume ${SID}\n\n❯`)
        : `❯ earlier prompt\n╭ claude frame ╮\n${dialog ? " ❯ 1. Yes\n   2. No" : draft() ? "❯ a draft" : (opts.emptyRow ?? "❯ ")}\n`;
      // SAFETY: the switch reads only `text` off a grid.
      return { ok: true, value: { text } as MuxGrid };
    },
  };
  return { mux, calls };
}

const plan = (interrupt: SwitchPlan["interrupt"]): SwitchPlan => ({
  paneId: "w1:p1",
  sessionId: SID,
  command: "cc -personal",
  permissionMode: null,
  interrupt,
});
/** Claude's faint next-step suggestion in an empty input box, as Herdr's styled read returns it. */
const SUGGESTION = "❯ \u001b[0m\u001b[2mls 看一下這兩個檔案在不在\u001b[0m";

describe("switchAccount", () => {
  test("an idle pane with an empty input row: /exit, wait for the exit, then resume", async () => {
    const { mux, calls } = fakeMux({ exitAfterPolls: 2 });
    expect(await switchAccount(mux, plan(null), fakeClock())).toEqual({ ok: true });
    expect(calls).toEqual(["text:/exit", "keys:Enter", `text:cc -personal --resume ${SID}`, "keys:Enter"]);
  });

  test("the session's own permission mode rides the resume line", async () => {
    const { mux, calls } = fakeMux({ exitAfterPolls: 0 });
    expect(await switchAccount(mux, { ...plan(null), permissionMode: "default" }, fakeClock())).toEqual({ ok: true });
    expect(calls).toContain(`text:cc -personal --resume ${SID} --permission-mode default`);
  });

  test("a working pane is interrupted once, then /exit goes into the empty row", async () => {
    const { mux, calls } = fakeMux({ exitAfterPolls: 0 });
    expect(await switchAccount(mux, plan("working"), fakeClock())).toEqual({ ok: true });
    expect(calls.slice(0, 2)).toEqual(["keys:ctrl+c", "text:/exit"]);
  });

  test("the prompt an interrupt hands back is cleared before /exit is typed", async () => {
    const { mux, calls } = fakeMux({ exitAfterPolls: 0, draftClearsAfter: 2 });
    expect(await switchAccount(mux, plan("working"), fakeClock())).toEqual({ ok: true });
    expect(calls.slice(0, 3)).toEqual(["keys:ctrl+c", "keys:ctrl+c", "text:/exit"]);
  });

  test("an idle pane holding an unsent draft is refused, and nothing is sent to it", async () => {
    const { mux, calls } = fakeMux({ exitAfterPolls: 0, draftClearsAfter: 1 });
    expect(await switchAccount(mux, plan(null), fakeClock())).toEqual({ ok: false, stage: "draft" });
    expect(calls).toEqual([]);
  });

  test("an input row that never clears stops the switch before /exit", async () => {
    const { mux, calls } = fakeMux({ exitAfterPolls: 0, draftClearsAfter: null });
    expect(await switchAccount(mux, plan("working"), fakeClock())).toEqual({
      ok: false,
      stage: "input_row",
      row: "stuck",
    });
    expect(calls).toEqual(["keys:ctrl+c", "keys:ctrl+c", "keys:ctrl+c"]);
  });

  test("an idle pane showing only Claude's faint suggestion switches, typing /exit over it", async () => {
    const { mux, calls } = fakeMux({ exitAfterPolls: 0, emptyRow: SUGGESTION });
    expect(await switchAccount(mux, plan(null), fakeClock())).toEqual({ ok: true });
    expect(calls[0]).toBe("text:/exit");
  });

  test("a pane waiting on a dialog is closed with Escape, never ctrl+c, then exits", async () => {
    const { mux, calls } = fakeMux({ exitAfterPolls: 0, dialog: true });
    expect(await switchAccount(mux, plan("blocked"), fakeClock())).toEqual({ ok: true });
    expect(calls.slice(0, 2)).toEqual(["keys:Escape", "text:/exit"]);
  });

  test("a dialog that ctrl+c cannot close stops the switch as a stuck row", async () => {
    const { mux, calls } = fakeMux({ exitAfterPolls: 0, dialog: true });
    expect(await switchAccount(mux, plan("working"), fakeClock())).toEqual({ ok: false, stage: "input_row", row: "stuck" });
    expect(calls.some((c) => c === "text:/exit")).toBe(false);
  });

  test("an exit never confirmed starts nothing", async () => {
    const { mux, calls } = fakeMux({ exitAfterPolls: null });
    expect(await switchAccount(mux, plan(null), fakeClock())).toEqual({ ok: false, stage: "unconfirmed" });
    expect(calls.some((c) => c.includes("--resume"))).toBe(false);
  });

  test("a shell with no exit line for THIS session is not an exit", async () => {
    const { mux, calls } = fakeMux({ exitAfterPolls: 0, screenAfterExit: "claude --resume 00000000-0000-0000-0000-000000000000\n❯" });
    expect(await switchAccount(mux, plan(null), fakeClock())).toEqual({ ok: false, stage: "unconfirmed" });
    expect(calls.some((c) => c.includes("--resume"))).toBe(false);
  });

  test("a resume line the pane refused is reported as a launch failure, not retried", async () => {
    const { mux, calls } = fakeMux({ exitAfterPolls: 0, launchFails: true });
    expect(await switchAccount(mux, plan(null), fakeClock())).toEqual({ ok: false, stage: "launch", reason: "pane gone" });
    expect(calls.filter((c) => c.includes("--resume"))).toHaveLength(1);
  });
});

describe("inputRowEmpty", () => {
  test("faint placeholder and suggestion text is empty; typed text and a paste token are not", () => {
    expect(inputRowEmpty(SUGGESTION)).toBe(true);
    expect(inputRowEmpty('❯ \u001b[0m\u001b[2mTry "refactor <filepath>"\u001b[0m')).toBe(true);
    expect(inputRowEmpty("❯ hello draft")).toBe(false);
    expect(inputRowEmpty("❯ [Pasted text #1]rd269 word270")).toBe(false);
  });

  test("typed text followed by a faint completion is still a draft", () => {
    expect(inputRowEmpty("❯ /ex\u001b[2mit\u001b[0m")).toBe(false);
  });

  test("a truecolour field is not read as faint, so coloured text stays visible", () => {
    expect(inputRowEmpty("\u001b[38;2;177;185;249m❯ \u001b[38;2;2;2;2mdraft\u001b[0m")).toBe(false);
    expect(inputRowEmpty("\u001b[38;5;2m❯\u001b[0m ")).toBe(true);
  });

  test("the dialog's own pointer is the lowest mark, and it is not an empty row", () => {
    expect(inputRowEmpty("❯ \n ❯ 1. Yes")).toBe(false);
    expect(inputRowEmpty("no input box here")).toBeNull();
  });
});

describe("exitLineShown", () => {
  test("an old exit line scrolled above the foot does not count", () => {
    const old = `claude --resume ${SID}\n` + Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
    expect(exitLineShown(old, SID)).toBe(false);
    expect(exitLineShown(`x\nclaude --resume ${SID}\n\n❯ `, SID)).toBe(true);
  });
});

describe("settingsChangedSinceLastTurn", () => {
  interface LogRow { type: string; message: { content: string | unknown[] } }
  const row = (o: LogRow) => JSON.stringify(o);
  const model = row({ type: "user", message: { content: "<command-name>/model</command-name>\n<command-args>sonnet</command-args>" } });
  const answer = row({ type: "assistant", message: { content: [] } });
  test("a /model after the last answer is pending; one before it is not", () => {
    expect(settingsChangedSinceLastTurn([answer, model].join("\n"))).toBe(true);
    expect(settingsChangedSinceLastTurn([model, answer].join("\n"))).toBe(false);
    expect(settingsChangedSinceLastTurn(["{torn", answer].join("\n"))).toBe(false);
  });
});

describe("lastPermissionMode", () => {
  interface LogRow {
    type: string;
    permissionMode?: string;
    sessionId?: string;
    message?: { content: string | { type: string }[] };
  }
  const row = (o: LogRow) => JSON.stringify(o);
  const started = (mode: string) => row({ type: "permission-mode", permissionMode: mode, sessionId: SID });
  const prompt = (mode: string) => row({ type: "user", permissionMode: mode, message: { content: "go on" } });
  const toolResult = row({ type: "user", message: { content: [{ type: "tool_result" }] } });

  test("the last mode the log shows wins, whether a start row or a prompt carried it", () => {
    // A Shift+Tab shows first on the next prompt; the start rows keep the mode the process began in.
    expect(lastPermissionMode([started("default"), prompt("default"), started("default"), prompt("acceptEdits")].join("\n"))).toBe(
      "acceptEdits",
    );
    expect(lastPermissionMode([prompt("acceptEdits"), started("plan"), toolResult].join("\n"))).toBe("plan");
  });

  test("no mode in the log, a torn line, or a value the flag does not take: nothing to carry", () => {
    expect(lastPermissionMode(toolResult)).toBeNull();
    expect(lastPermissionMode(["{torn", started("default")].join("\n"))).toBe("default");
    // Never typed into the terminal, and never replaced by an older mode that may be stale.
    expect(lastPermissionMode([started("default"), prompt("default; rm -rf ~")].join("\n"))).toBeNull();
  });
});

describe("resumeLine", () => {
  test("adds the session's mode, or nothing when there is none", () => {
    expect(resumeLine("cc -work", SID, "default")).toBe(`cc -work --resume ${SID} --permission-mode default`);
    expect(resumeLine("cc -work", SID, null)).toBe(`cc -work --resume ${SID}`);
  });

  test("an account command that sets its own mode keeps it", () => {
    expect(resumeLine("claude --permission-mode plan", SID, "default")).toBe(`claude --permission-mode plan --resume ${SID}`);
    expect(resumeLine("claude --permission-mode=plan", SID, "default")).toBe(`claude --permission-mode=plan --resume ${SID}`);
    expect(resumeLine("claude --dangerously-skip-permissions", SID, "default")).toBe(
      `claude --dangerously-skip-permissions --resume ${SID}`,
    );
  });
});

describe("validateOperatorAccounts", () => {
  test("keeps well-formed rows and drops the rest", () => {
    const warnings: string[] = [];
    const rows = validateOperatorAccounts(
      {
        accounts: [
          { label: "Work", command: "cc -work" },
          { label: "Personal", command: "cc -personal\nrm -rf ~" },
          { label: "", command: "cc" },
          { label: "Work", command: "cc -work --x" },
        ],
      },
      (m) => warnings.push(m),
    );
    expect(rows).toEqual([{ label: "Work", command: "cc -work --x" }]);
    expect(warnings).toHaveLength(3);
  });
});
