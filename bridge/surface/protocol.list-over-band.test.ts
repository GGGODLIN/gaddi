// A slash command whose typeahead list Claude Code draws OVER the box, with a plugin's band of rows
// between the list and the box (Claude Code 2.1.325 over Herdr, 120 x 39, 2026-11-17: every `/effort`
// from the harness bar ended `typed_not_submitted / changed`, on upstream 1.28.5 and 1.29.0-edge.4
// alike). A command needs the transcript above the box to stand still; the list's own rows are left out
// of that compare only when they are read as the box's own list, and the list was read only right over
// the top edge. The band (two rows and a blank one, inside the profile's volatile rows over the box)
// stood between them, and one row of the list reached past the band into the transcript. One entry, a
// user skill with a CJK description, was drawn `* /name – description` (a star, no description column);
// what draws the star was not found. Claude's entry pattern takes the star so the run is not cut there.
// That reason lives here, not as a profile note: the profile ships in the main bundle, which stands at
// the 2 MiB precache limit.
//
// The three captures are one live send, read the way the bridge reads a pane (`herdr pane read --source
// visible --format ansi`, Herdr, 120 columns, CRLF line ends, no trailing newline): the empty box, the
// probe character in it, and the command typed. The band's text and two of the list's entries were
// replaced by neutral text of the same shape (a plugin's notice and buttons, a starred entry with a CJK
// description); nothing on a screen is drawn by the test.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { muxAck, muxOk, type MuxAck, type MuxGrid, type MuxGridRequest, type MuxOutcome } from "../mux/types.ts";
import { loadProfiles, profileFor } from "../../web/src/lib/surface/profile.ts";
import type { SendAnswer } from "../../web/src/lib/surface/send.ts";
import { KeyGate } from "./key-gate.ts";
import { RowRing, SendProtocol, SessionLocks } from "./protocol.ts";
import { RequestStore } from "./requests.ts";

const FIXTURES = join(import.meta.dir, "fixtures");
const capture = (state: "empty" | "probe" | "typed"): string => readFileSync(join(FIXTURES, `claude--v2325-slash-list-over-band-${state}--w120.txt`), "utf8");
const CLAUDE = loadProfiles().get("claude")!;
const PROBE = CLAUDE.probe.char;
const ESC = String.fromCodePoint(0x1b);
const plain = (screen: string): string[] => screen.replace(new RegExp(`${ESC}\\[[0-9;:]*m`, "gu"), "").split(/\r?\n/u);
const COMMAND = "/effort";

/** A pane whose every read is a capture: the empty box, the probe in it, or the command typed. `typed` may be edited. */
class OverBandPane {
  box = "";
  keysSeen: string[] = [];
  private revision = 1;
  private entered = false;

  constructor(private readonly typed: string) {}

  readGrid = (paneId: string, request: MuxGridRequest): Promise<MuxOutcome<MuxGrid>> => {
    void request;
    let text: string;
    if (this.entered || this.box === "") text = capture("empty");
    else if (this.box === PROBE) text = capture("probe");
    else if (this.box === COMMAND) text = this.typed;
    else throw new Error(`the capture never showed the box holding ${JSON.stringify(this.box)}`);
    return Promise.resolve(muxOk({ paneId, text, truncated: false, revision: this.revision }));
  };

  typeText = (paneId: string, text: string): Promise<MuxAck> => {
    void paneId;
    this.box += text;
    this.revision++;
    return Promise.resolve(muxAck());
  };

  pasteText = (paneId: string, text: string): Promise<MuxAck> => this.typeText(paneId, text);

  writeKeys = (paneId: string, keys: readonly string[]): Promise<MuxAck> => {
    void paneId;
    for (const key of keys) {
      this.keysSeen.push(key);
      if (key === "Backspace") this.box = [...this.box].slice(0, -1).join("");
      if (key === "Enter") {
        this.entered = true;
        this.box = "";
      }
    }
    this.revision++;
    return Promise.resolve(muxAck());
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "collie-list-over-band-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The send as the harness bar's Effort button ran it: the shipped Claude profile, version 2.1.325. */
function send(pane: OverBandPane): Promise<SendAnswer> {
  const clock = { now: 1_000_000 };
  const now = (): number => clock.now;
  const protocol = new SendProtocol({
    mux: { readGrid: pane.readGrid, typeText: pane.typeText, pasteText: pane.pasteText },
    gate: new KeyGate(pane, now),
    store: new RequestStore(join(dir, "sends"), now),
    locks: new SessionLocks(),
    ring: new RowRing(),
    profile: (harness: string) => Promise.resolve(profileFor(harness, "2.1.325", { log: () => undefined, profiles: new Map([["claude", CLAUDE]]) })),
    generation: () => "gen-1",
    now,
    sleep: (ms: number) => {
      clock.now += ms;
      return Promise.resolve();
    },
  });
  return protocol.handle({ id: "list-over-band-0001", text: COMMAND, mode: "command" }, { session: "main", paneId: "%1", harness: "claude" });
}

describe("a slash command whose list stands over a plugin's band over the box, on Claude Code 2.1.325 (2026-11-17)", () => {
  test("the captures are the live ones: only the list's four rows and the box row changed, the band stayed", () => {
    const empty = plain(capture("empty"));
    const typed = plain(capture("typed"));
    expect(typed.length).toBe(empty.length);
    const top = typed.findIndex((row) => row.startsWith("─────"));
    expect(top).toBe(empty.findIndex((row) => row.startsWith("─────")));
    const changed = typed.flatMap((row, i) => (row === empty[i] ? [] : [i]));
    expect(changed).toEqual([top - 7, top - 6, top - 5, top - 4, top + 1]);
    expect(typed[top - 7]).toMatch(/^ {2}❯ \/effort {2,}Set effort level/u);
    expect(typed[top - 5]).toMatch(/^ {4}\* \/sample-skill – /u);
    expect(typed[top - 3]).toMatch(/^plugin band/u);
    expect(typed[top - 1]).toBe("");
  });

  test("the command goes out once: probed, typed, one Enter, sent", async () => {
    const pane = new OverBandPane(capture("typed"));
    const answer = await send(pane);
    expect(answer.receipt).toMatchObject({ outcome: "sent", keys: ["probe", "Backspace", "Enter"] });
    expect(pane.keysSeen.filter((key) => key === "Enter")).toHaveLength(1);
  });

  test("a list over the band whose pointer rests on another command is not the box's own: nothing is pressed", async () => {
    const typed = capture("typed").replace("❯ /effort ", "  /effort").replace("  /effort-notes", "❯ /effort-notes");
    expect(plain(typed).some((row) => /^ {2}❯ \/effort-notes/u.test(row))).toBe(true);
    const pane = new OverBandPane(typed);
    const answer = await send(pane);
    expect(answer.receipt).toMatchObject({ outcome: "typed_not_submitted" });
    expect(pane.keysSeen).not.toContain("Enter");
  });

  test("a row that is NEW over the list still stops it: the transcript above moved", async () => {
    const rows = capture("typed").split("\r\n");
    const top = plain(capture("typed")).findIndex((row) => row.startsWith("─────"));
    rows[top - 8] = "A line of output that was not there before";
    const pane = new OverBandPane(rows.join("\r\n"));
    const answer = await send(pane);
    expect(answer.receipt).toMatchObject({ outcome: "typed_not_submitted", reason: "changed" });
    expect(pane.keysSeen).not.toContain("Enter");
  });
});
