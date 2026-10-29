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
// `perLine + gained` beside a column's one; the text is `n` characters. Whatever the starting state,
// font line height, padding, viewport max-height cap, and draft length, re-reading after each toggle
// must settle within one change: a second change is a flicker.
function settle(
  start: boolean,
  n: number,
  perLine: number,
  gained: number,
  stackAt = STACK_AT_LINES,
  lineHeight = 24,
  padding = 12,
  maxHeight = 160,
): boolean[] {
  const states = [start];
  for (let step = 0; step < 6; step++) {
    const last = states[states.length - 1]!;
    const lines = Math.max(1, Math.ceil(n / (last ? perLine + gained : perLine)));
    const scrollHeight = lines * lineHeight + padding;
    const clientHeight = Math.min(scrollHeight, maxHeight);
    const next = nextStacked(last, lines, stackAt, clientHeight, scrollHeight);
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

  it("stays unstacked (and un-stacks on shrink) when clientHeight is below the 80px/124px column height", () => {
    // Exact 80px (2 buttons) and 124px (3 buttons) column heights with gap-2
    expect(nextStacked(false, STACK_AT_LINES, STACK_AT_LINES, 76)).toBe(false);
    expect(nextStacked(false, STACK_AT_LINES, STACK_AT_LINES, 79)).toBe(false);
    expect(nextStacked(false, STACK_AT_LINES, STACK_AT_LINES, 80)).toBe(true);
    expect(nextStacked(false, STACK_THREE_AT_LINES, STACK_THREE_AT_LINES, 116)).toBe(false);
    expect(nextStacked(false, STACK_THREE_AT_LINES, STACK_THREE_AT_LINES, 123)).toBe(false);
    expect(nextStacked(false, STACK_THREE_AT_LINES, STACK_THREE_AT_LINES, 124)).toBe(true);

    // Already-stacked composer un-stacks when viewport shrinks and caps clientHeight below the column
    expect(nextStacked(true, STACK_THREE_AT_LINES, STACK_THREE_AT_LINES, 72, 124)).toBe(false);
    expect(nextStacked(true, STACK_AT_LINES, STACK_AT_LINES, 72, 84)).toBe(false);
    // Hysteresis preserved when a 3-line draft re-wraps to 2 lines (60px, not overflowing) after stacking freed width,
    // and when a 14px-font 4-line draft (96px in row) re-wraps to 3 lines (75px in column, not overflowing)
    expect(nextStacked(true, 2, STACK_AT_LINES, 60, 60)).toBe(true);
    expect(nextStacked(false, 4, STACK_AT_LINES, 96, 96)).toBe(true);
    expect(nextStacked(true, 3, STACK_AT_LINES, 75, 75)).toBe(true);

    const textarea = document.createElement("textarea");
    textarea.style.lineHeight = "22px";
    textarea.style.paddingTop = "7px";
    textarea.style.paddingBottom = "7px";
    Object.defineProperty(textarea, "scrollHeight", { value: 124, configurable: true });
    Object.defineProperty(textarea, "clientHeight", { value: 124, configurable: true });
    expect(draftLines(textarea)).toBe(5);

    const field = { current: textarea };
    const { result, rerender } = renderHook(
      ({ draft }) => useStackedActions(field, draft, STACK_THREE_AT_LINES),
      { initialProps: { draft: "five lines of text" } },
    );
    expect(result.current).toBe(true);

    // Viewport shrinks so clientHeight is capped at 72px while scrollHeight stays 124px
    Object.defineProperty(textarea, "clientHeight", { value: 72, configurable: true });
    rerender({ draft: "five lines of text!" });
    expect(result.current).toBe(false);
  });

  it("settles in at most one change for every draft length, line width, font line-height, viewport cap and starting state", () => {
    // `gained` is the width a freed button returns, as a share of a line: from a sliver to well past
    // the 40px of a real phone (about 1/6 of a line at 390px), and 80px for two freed buttons.
    let checked = 0;
    for (const stackAt of [STACK_AT_LINES, STACK_THREE_AT_LINES]) {
      for (const lineHeight of [18, 21, 24, 27]) {
        for (const maxHeight of [72, 79, 80, 123, 124, 160]) {
          for (const perLine of [12, 20, 28, 40]) {
            for (const gained of [1, 3, 5, 8, perLine]) {
              for (let n = 0; n <= perLine * 12; n++) {
                for (const start of [false, true]) {
                  checked += 1;
                  if (settle(start, n, perLine, gained, stackAt, lineHeight, 12, maxHeight).length > 2) {
                    throw new Error(
                      `stackAt=${String(stackAt)} lh=${String(lineHeight)} maxH=${String(maxHeight)} n=${String(n)} perLine=${String(perLine)} gained=${String(gained)} start=${String(start)}`,
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100_000);
  });
});
