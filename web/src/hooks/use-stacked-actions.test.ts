import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  draftLines,
  nextStacked,
  STACK_AT_LINES,
  STACK_THREE_AT_LINES,
  UNSTACK_AT_LINES,
  useStackedActions,
} from "./use-stacked-actions";

// The hysteresis, as a model. A line holds `perLine` characters beside the row's two buttons and
// `perLine + gained` beside a column's one; the text is `n` characters. Whatever the starting state
// and the draft, re-reading after each toggle must settle within one change: a second change is a
// flicker.
function settle(start: boolean, n: number, perLine: number, gained: number, stackAt = STACK_AT_LINES): boolean[] {
  const states = [start];
  for (let step = 0; step < 6; step++) {
    const last = states[states.length - 1]!;
    const lines = Math.max(1, Math.ceil(n / (last ? perLine + gained : perLine)));
    const next = nextStacked(last, lines, stackAt);
    if (next === last) break;
    states.push(next);
  }
  return states;
}

describe("nextStacked", () => {
  it("enters at three lines and leaves at one", () => {
    expect([1, 2].map((l) => nextStacked(false, l))).toEqual([false, false]);
    expect(nextStacked(false, STACK_AT_LINES)).toBe(true);
    expect([2, 3, 40].map((l) => nextStacked(true, l))).toEqual([true, true, true]);
    expect(nextStacked(true, UNSTACK_AT_LINES)).toBe(false);
  });

  it("enters at five lines when three buttons are present (attach, draft mic, send) and leaves at one", () => {
    expect([1, 2, 3, 4].map((l) => nextStacked(false, l, STACK_THREE_AT_LINES))).toEqual([false, false, false, false]);
    expect(nextStacked(false, STACK_THREE_AT_LINES, STACK_THREE_AT_LINES)).toBe(true);
    expect([2, 3, 4, 40].map((l) => nextStacked(true, l, STACK_THREE_AT_LINES))).toEqual([true, true, true, true]);
    expect(nextStacked(true, UNSTACK_AT_LINES, STACK_THREE_AT_LINES)).toBe(false);
  });

  it("stays unstacked when scrollHeight reaches 5 lines (124px) but clientHeight is capped at 72px by a short viewport", () => {
    expect(nextStacked(false, STACK_THREE_AT_LINES, STACK_THREE_AT_LINES, 72)).toBe(false);
    expect(nextStacked(false, STACK_AT_LINES, STACK_AT_LINES, 72)).toBe(false);
    expect(nextStacked(false, STACK_THREE_AT_LINES, STACK_THREE_AT_LINES, 124)).toBe(true);
    expect(nextStacked(false, STACK_AT_LINES, STACK_AT_LINES, 84)).toBe(true);

    const textarea = document.createElement("textarea");
    textarea.style.lineHeight = "22px";
    textarea.style.paddingTop = "7px";
    textarea.style.paddingBottom = "7px";
    Object.defineProperty(textarea, "scrollHeight", { value: 124, configurable: true });
    Object.defineProperty(textarea, "clientHeight", { value: 72, configurable: true });
    expect(draftLines(textarea)).toBe(5);

    const field = { current: textarea };
    const { result } = renderHook(() => useStackedActions(field, "five lines of text", STACK_THREE_AT_LINES));
    expect(result.current).toBe(false);
  });

  it("settles in at most one change for every draft length, line width and starting state", () => {
    // `gained` is the width a freed button returns, as a share of a line: from a sliver to well past
    // the 40px of a real phone (about 1/6 of a line at 390px), and 80px for two freed buttons.
    for (const stackAt of [STACK_AT_LINES, STACK_THREE_AT_LINES]) {
      for (const perLine of [12, 20, 28, 40]) {
        for (const gained of [1, 3, 5, 8, perLine]) {
          for (let n = 0; n <= perLine * 12; n++) {
            for (const start of [false, true]) {
              expect(
                settle(start, n, perLine, gained, stackAt).length,
                `stackAt=${String(stackAt)} n=${String(n)} perLine=${String(perLine)} gained=${String(gained)} start=${String(start)}`,
              ).toBeLessThanOrEqual(2);
            }
          }
        }
      }
    }
  });
});
