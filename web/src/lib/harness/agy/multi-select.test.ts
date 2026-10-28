import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAnsi } from "../../ansi";
import { lineText, splitLines } from "../../blocks";
import { multiSelectEquals, multiSelectIdentity } from "../multi-select-model";
import { detectMultiSelectRegion } from "./multi-select";

const PANES_DIR = join(import.meta.dirname, "../../../fixtures/panes");
const lines = (text: string) => splitLines(parseAnsi(text));
const askMultiRaw = readFileSync(join(PANES_DIR, "agy--ask-multi.txt"), "utf8");

describe("agy native multi-select, measured 1.3.5 digit choreography", () => {
  it("exposes real checkboxes and explicit global submit plan on agy--ask-multi.txt", () => {
    const detected = detectMultiSelectRegion(lines(askMultiRaw));
    expect(detected).not.toBeNull();
    expect(detected!.model).toMatchObject({
      phase: "checkbox",
      toggle: "digit",
      advanceLabel: "Submit",
      advanceKeys: ["Enter"],
      options: [
        { n: 1, label: "apple", checked: false },
        { n: 2, label: "banana", checked: false },
        { n: 3, label: "cherry", checked: false },
      ],
    });
  });

  it("tracks checked state but ignores pointer movement in identity", () => {
    const plain = lines(askMultiRaw).map(lineText).join("\n");
    const appleChecked = plain.replace("> 1. [ ] apple", "> 1. [x] apple");
    const pointerMoved = appleChecked.replace("> 1. [x] apple", "  1. [x] apple").replace("  2. [ ] banana", "> 2. [ ] banana");
    const bothChecked = pointerMoved.replace("> 2. [ ] banana", "> 2. [x] banana");

    const m1 = detectMultiSelectRegion(lines(appleChecked))!.model;
    const m2 = detectMultiSelectRegion(lines(pointerMoved))!.model;
    const m3 = detectMultiSelectRegion(lines(bothChecked))!.model;

    expect(multiSelectIdentity(m1, m2)).toBe(true);
    expect(multiSelectEquals(m1, m3)).toBe(false);
  });

  it("declines unknown, incomplete, stale and write-in screens instead of guessing", () => {
    const text = lines(askMultiRaw).map(lineText).join("\n");
    for (const mutated of [
      text.replace("> 1.", "  1."),
      text.replace("> 1.", "  1.").replace("  4. Write-in", "> 4. Write-in"),
      text.replace("2. [ ] banana", "5. [ ] banana"),
      text.replace("space Toggle", "space Something else"),
      text.replace("[ ] apple", "[?] apple"),
      text + "\nnew output\nnot a modal",
    ]) {
      expect(detectMultiSelectRegion(lines(mutated))).toBeNull();
    }
  });
});
