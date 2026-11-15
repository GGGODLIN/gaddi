import { renderHook } from "@testing-library/react";

import { paneRowKey } from "./hosts";
import {
  currentLastViewed,
  dropLastViewed,
  forgetLastViewed,
  MAX_LAST_VIEWED,
  notePaneViewed,
  resolveLastViewed,
  useLastViewedMemory,
} from "./last-viewed";
import type { AgentView } from "./types";

function pane(id: string, space: string, over: Partial<AgentView> = {}): AgentView {
  return {
    paneId: id,
    workspaceId: space,
    workspaceLabel: space,
    workspaceNumber: 1,
    tabId: `${space}:t1`,
    agent: "claude",
    status: "idle",
    cwd: `/work/${space}`,
    focused: false,
    ...over,
  };
}

describe("last-viewed store", () => {
  it("records newest first, deduplicates revisits, caps at MAX_LAST_VIEWED, and survives reload", async () => {
    const p1 = pane("p1", "alpha");
    const p2 = pane("p2", "beta");
    const p3 = pane("p3", "gamma");
    const p4 = pane("p4", "delta");
    const p5 = pane("p5", "epsilon");

    notePaneViewed(p1);
    notePaneViewed(p2);
    notePaneViewed(p1);
    expect(currentLastViewed().map((r) => r.row)).toEqual([paneRowKey(p1), paneRowKey(p2)]);

    notePaneViewed(p3);
    notePaneViewed(p4);
    notePaneViewed(p5);
    expect(currentLastViewed()).toHaveLength(MAX_LAST_VIEWED);
    expect(currentLastViewed().map((r) => r.row)).toEqual([
      paneRowKey(p5),
      paneRowKey(p4),
      paneRowKey(p3),
      paneRowKey(p1),
    ]);

    vi.resetModules();
    const reloaded = await import("./last-viewed");
    expect(reloaded.currentLastViewed().map((r) => r.row)).toEqual([
      paneRowKey(p5),
      paneRowKey(p4),
      paneRowKey(p3),
      paneRowKey(p1),
    ]);
  });

  it("resolves the 1 most recent live pane on home and skips currentPaneKey inside a pane", () => {
    const pA = pane("pA", "tidepool");
    const pB = pane("pB", "lumen");
    notePaneViewed(pA);
    notePaneViewed(pB);

    // From Home (`currentPaneKey === ""`), returns the single most recently viewed pane (`pB`).
    expect(resolveLastViewed(currentLastViewed(), [pA, pB], "")?.paneId).toBe("pB");

    // From inside `pB`, skips `pB` and returns the previous viewed pane (`pA`).
    expect(resolveLastViewed(currentLastViewed(), [pA, pB], paneRowKey(pB))?.paneId).toBe("pA");
  });

  it("drops a closed pane's record via dropLastViewed so a reused id in the same workspace is not misattributed", () => {
    const pA = pane("pA", "tidepool");
    const pB = pane("pB", "lumen");
    notePaneViewed(pA);
    notePaneViewed(pB);
    expect(currentLastViewed().map((r) => r.row)).toEqual([paneRowKey(pB), paneRowKey(pA)]);

    dropLastViewed(pB);
    expect(currentLastViewed()).toEqual([{ row: paneRowKey(pA), space: "tidepool" }]);

    const pBReopened = pane("pB", "lumen", { paneLabel: "brand-new" });
    expect(resolveLastViewed(currentLastViewed(), [pA, pBReopened], "")?.paneId).toBe("pA");

    dropLastViewed(pane("never-opened", "lumen"));
    expect(currentLastViewed()).toEqual([{ row: paneRowKey(pA), space: "tidepool" }]);
  });

  it("keeps no stale in-memory fallback when localStorage.setItem throws", () => {
    const p1 = pane("p1", "alpha");
    const p2 = pane("p2", "beta");
    notePaneViewed(p1);
    expect(currentLastViewed()).toEqual([{ row: paneRowKey(p1), space: "alpha" }]);

    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    try {
      expect(() => notePaneViewed(p2)).not.toThrow();
      expect(currentLastViewed()).toEqual([{ row: paneRowKey(p1), space: "alpha" }]);

      const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });
      try {
        expect(currentLastViewed()).toEqual([]);
      } finally {
        getSpy.mockRestore();
      }
    } finally {
      setSpy.mockRestore();
    }
  });

  it("ignores closed panes and pane ids reused in a different workspace", () => {
    const pA = pane("pA", "tidepool");
    const pB = pane("pB", "lumen");
    notePaneViewed(pA);
    notePaneViewed(pB);

    // `pB` closed, so `pA` surfaces.
    expect(resolveLastViewed(currentLastViewed(), [pA], "")?.paneId).toBe("pA");

    // `pB` id reused by another workspace (`other-repo`): skipped rather than misattributed.
    const pBReused = pane("pB", "other-repo");
    expect(resolveLastViewed(currentLastViewed(), [pA, pBReused], "")?.paneId).toBe("pA");

    forgetLastViewed();
    expect(currentLastViewed()).toEqual([]);
    expect(resolveLastViewed(currentLastViewed(), [pA], "")).toBeUndefined();
  });

  it("does not resurrect wiped entries from another tab's unpair when recording a new visit", () => {
    const oldPane = pane("w1:p1", "old-space");
    const newPane = pane("w2:p2", "new-space");
    notePaneViewed(oldPane);
    expect(currentLastViewed().map((r) => r.space)).toEqual(["old-space"]);

    // Simulate another open tab running wipeDevice("unpair"), which deletes the key in localStorage.
    localStorage.removeItem("collie:last-viewed:v1");
    expect(currentLastViewed()).toEqual([]);

    notePaneViewed(newPane);
    expect(currentLastViewed()).toEqual([{ row: paneRowKey(newPane), space: "new-space" }]);
  });

  it("records live panes through useLastViewedMemory and skips undefined", () => {
    interface MemoryProps {
      viewed: AgentView | undefined;
    }
    const live = pane("w1:p1", "collie");
    const { rerender } = renderHook<void, MemoryProps>(({ viewed }) => useLastViewedMemory(viewed), {
      initialProps: { viewed: undefined },
    });
    expect(currentLastViewed()).toEqual([]);

    rerender({ viewed: live });
    expect(currentLastViewed()).toEqual([{ row: paneRowKey(live), space: "collie" }]);
  });
});
