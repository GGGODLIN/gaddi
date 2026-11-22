import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { muxAck, muxRefused } from "../mux/types.ts";
import { FakePane, PROBE, neverEscape, rig, useScratchDir } from "./protocol.rig.ts";

const RULE = "─".repeat(40);
useScratchDir();

describe("manual send into a question's nested answer editor", () => {
  // The ask_user screen from the field report: an outer labelled rule contains the
  // question, options and a separate indented editor. The outer panel matches the
  // profile's frame shape, but the Surface rejects it as a composer.
  function answerPane(hint = "Enter submit • Esc back to options"): FakePane {
    const pane = new FakePane();
    const paint = (s: string) => `\u001b[38;2;167;152;215m${s}\u001b[0m`;
    pane.render = () => [
      paint(`─ Question ${"─".repeat(29)}`),
      " Choose how to handle the cache.",
      "",
      "   1. Move cache",
      "   2. Keep cache",
      paint(" ❯ ✎ Write my own answer…"),
      "",
      paint(" Your answer:"),
      paint(` ${"─".repeat(38)}`),
      ` ${pane.box}`,
      paint(` ${"─".repeat(38)}`),
      "",
      paint(` ${hint}`),
      paint(RULE),
      paint("~/project (dev)"),
      paint("↑91k ↓2.0k 33.4%/272k (auto)"),
    ].join("\n");
    return pane;
  }

  test.each(["Enter submit • Esc back to options", "Enter to submit • Esc to go back"])("Type here submits the answer using the printed hint: %s", async (hint) => {
    const pane = answerPane(hint);
    pane.afterInput = (p, what) => {
      if (what === "keys:Enter") p.render = () => readFileSync(join(import.meta.dir, "../../web/src/fixtures/panes/pi--v0871-idle.txt"), "utf8");
    };
    const { send } = rig({ pane, harness: "pi", version: "1.3.0" });
    const first = await send("my custom answer");
    expect(first.receipt).toMatchObject({ outcome: "refused", reason: "unconfirmed", keys: [] });
    expect(first.surface).toMatchObject({ modal: "unreadable", composer: "unknown" });
    expect(pane.calls).toEqual([]);
    const second = await send("my custom answer", { rowsHash: first.rowsHash!, override: true });
    expect(second.receipt).toMatchObject({ outcome: "sent", keys: ["probe", "Backspace", "Enter"] });
    expect(pane.calls).toEqual([`type:${PROBE}`, "paste:my custom answer"]);
    expect(pane.transcript.at(-1)).toBe("> my custom answer");
    neverEscape(pane);
  });

  test("Type here without override flag still submits the answer", async () => {
    const pane = answerPane();
    pane.afterInput = (p, what) => {
      if (what === "keys:Enter") p.render = () => readFileSync(join(import.meta.dir, "../../web/src/fixtures/panes/pi--v0871-idle.txt"), "utf8");
    };
    const { send } = rig({ pane, harness: "pi", version: "1.3.0" });
    const first = await send("my custom answer");
    const second = await send("my custom answer", { rowsHash: first.rowsHash! });
    expect(second.receipt).toMatchObject({ outcome: "sent", keys: ["probe", "Backspace", "Enter"] });
  });

  test.each(["Press Enter to select the second option", "I will press Escape to cancel afterwards", "Enter submit • Esc back to options"])("answer text cannot replace the real footer: %s", async (text) => {
    const pane = answerPane();
    pane.afterInput = (p, what) => {
      if (what === "keys:Enter") p.render = () => readFileSync(join(import.meta.dir, "../../web/src/fixtures/panes/pi--v0871-idle.txt"), "utf8");
    };
    const { send } = rig({ pane, harness: "pi", version: "1.3.0" });
    const first = await send(text);
    const second = await send(text, { rowsHash: first.rowsHash! });
    expect(second.receipt).toMatchObject({ outcome: "sent", keys: ["probe", "Backspace", "Enter"] });
  });

  test("Submit retries a failed Enter and confirms the returned empty composer", async () => {
    const pane = answerPane();
    const writeKeys = pane.writeKeys;
    let failEnter = true;
    pane.writeKeys = (id, keys) => {
      if (keys.includes("Enter") && failEnter) {
        failEnter = false;
        return Promise.resolve(muxRefused("temporary key write failure"));
      }
      return writeKeys(id, keys);
    };
    pane.afterInput = (p, what) => {
      if (what === "keys:Enter") p.render = () => readFileSync(join(import.meta.dir, "../../web/src/fixtures/panes/pi--v0871-idle.txt"), "utf8");
    };
    const { send } = rig({ pane, harness: "pi", version: "1.3.0" });
    const text = "Press Enter to select the second option";
    const first = await send(text);
    const second = await send(text, { rowsHash: first.rowsHash! });
    expect(second.receipt).toMatchObject({ outcome: "typed_not_submitted", reason: "submit_failed" });
    const retry = await send(text, { mode: "submit", rowsHash: second.rowsHash! });
    expect(retry.receipt).toMatchObject({ outcome: "sent", keys: ["Enter"] });
    expect(pane.calls).toEqual([`type:${PROBE}`, `paste:${text}`]);
    expect(pane.transcript.filter((row) => row === `> ${text}`)).toHaveLength(1);
  });

  /** A confirmed answer typed into the field whose Enter write failed: the text stands, unsubmitted. */
  async function strandedAnswer(text: string) {
    const pane = answerPane();
    const writeKeys = pane.writeKeys;
    pane.writeKeys = (id, keys) => (keys.includes("Enter") ? Promise.resolve(muxRefused("temporary key write failure")) : writeKeys(id, keys));
    const r = rig({ pane, harness: "pi", version: "1.3.0" });
    const first = await r.send(text);
    const second = await r.send(text, { rowsHash: first.rowsHash! });
    expect(second.receipt).toMatchObject({ outcome: "typed_not_submitted", reason: "submit_failed" });
    expect(pane.box).toBe(text);
    return { ...r, pane, rowsHash: second.rowsHash! };
  }

  // An answer worded like the footer is found on the footer row (the scan runs up from the bottom),
  // and Discard confirms only the row it found: the field still empties, the receipt says unknown.
  test("Discard of an answer worded like the footer empties the field but does not claim discarded", async () => {
    const text = "Enter submit • Esc back to options";
    const { pane, send, rowsHash } = await strandedAnswer(text);
    const discard = await send(text, { mode: "discard", rowsHash });
    expect(discard.receipt).toMatchObject({ outcome: "unknown", reason: "no_evidence" });
    expect(pane.box).toBe("");
  });

  test("Discard that blanks a duplicate row while the answer stays is never reported discarded", async () => {
    const { pane, send, rowsHash } = await strandedAnswer("my custom answer");
    const render = pane.render.bind(pane);
    let quoteCleared = false;
    pane.render = () => render().replace(" Choose how to handle the cache.", quoteCleared ? " " : " my custom answer");
    const writeKeys = pane.writeKeys;
    pane.writeKeys = (id, keys) => {
      if (keys.every((key) => key === "Backspace")) {
        quoteCleared = true;
        pane.revision++;
        return Promise.resolve(muxAck());
      }
      return writeKeys(id, keys);
    };
    // The person's rows hash is of the screen with the quoted copy on it.
    const look = await send("my custom answer", { mode: "discard", rowsHash });
    const discard = look.receipt?.reason === "stale_surface" ? await send("my custom answer", { mode: "discard", rowsHash: look.rowsHash! }) : look;
    expect(discard.receipt?.outcome).not.toBe("discarded");
    expect(pane.box).toBe("my custom answer");
  });

  test.each(["my custom answer"])("Discard empties a stranded answer and says so: %s", async (text) => {
    const { pane, send, rowsHash } = await strandedAnswer(text);
    const discard = await send(text, { mode: "discard", rowsHash });
    expect(discard.receipt).toMatchObject({ outcome: "discarded" });
    expect(pane.box).toBe("");
    expect(pane.keysSeen.every((key) => key === "Backspace")).toBe(true);
    neverEscape(pane);
  });

  test("Discard that leaves text in the field is never reported discarded", async () => {
    const { pane, send, rowsHash } = await strandedAnswer("my custom answer");
    pane.backspaceRestores = false;
    const discard = await send("my custom answer", { mode: "discard", rowsHash });
    expect(discard.receipt).toMatchObject({ outcome: "unknown", reason: "no_evidence" });
    expect(pane.box).toBe("my custom answer");
  });

  test("Discard whose screen changed elsewhere is never reported discarded", async () => {
    const { pane, send, rowsHash } = await strandedAnswer("my custom answer");
    pane.afterInput = (p, what) => {
      if (what.startsWith("keys:Backspace")) {
        const render = p.render.bind(p);
        p.render = () => render().replace("2. Keep cache", "2. Keep cache and more");
      }
    };
    const discard = await send("my custom answer", { mode: "discard", rowsHash });
    expect(discard.receipt).toMatchObject({ outcome: "unknown", reason: "no_evidence" });
  });

  test("a swallowed Enter is not reported as a sent answer", async () => {
    const pane = answerPane();
    pane.enterSubmits = false;
    const { send } = rig({ pane, harness: "pi", version: "1.3.0" });
    const first = await send("my custom answer");
    const second = await send("my custom answer", { rowsHash: first.rowsHash! });
    expect(second.receipt).toMatchObject({ outcome: "unknown", reason: "no_evidence", keys: ["probe", "Backspace", "Enter"] });
    expect(pane.box).toBe("my custom answer");
  });

  test.each(["Enter select • Esc cancel", "Alt+Enter submit • Esc cancel"])("does not invent an Enter submit hint from %s", async (hint) => {
    const pane = answerPane(hint);
    const { send } = rig({ pane, harness: "pi", version: "1.3.0" });
    const first = await send("my custom answer");
    const second = await send("my custom answer", { rowsHash: first.rowsHash! });
    expect(second.receipt?.keys).toEqual(["probe", "Backspace", "alt+Enter"]);
    expect(pane.keysSeen).not.toContain("Enter");
  });

  test("a changed footer after the text lands keeps every submit key home", async () => {
    const pane = answerPane();
    const render = pane.render.bind(pane);
    pane.render = () => pane.box.length > 1 ? render().replace("Enter submit", "Enter select") : render();
    const { send } = rig({ pane, harness: "pi", version: "1.3.0" });
    const first = await send("my custom answer");
    const second = await send("my custom answer", { rowsHash: first.rowsHash! });
    expect(second.receipt).toMatchObject({ outcome: "typed_not_submitted", reason: "mismatch", keys: ["probe", "Backspace"] });
  });

  test("a question that swallows the probe still receives no answer or submit key", async () => {
    const pane = answerPane();
    pane.swallow = true;
    const { send } = rig({ pane, harness: "pi", version: "1.3.0" });
    const first = await send("my custom answer");
    const second = await send("my custom answer", { rowsHash: first.rowsHash! });
    expect(second.receipt).toMatchObject({ outcome: "refused", reason: "probe_failed", keys: ["probe"] });
    expect(pane.calls).toEqual([`type:${PROBE}`]);
    expect(pane.keysSeen).toEqual([]);
  });
});
