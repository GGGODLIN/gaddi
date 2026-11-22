import { describe, expect, test } from "bun:test";

import { isTopologyWrite, marksPaneSeen, paneActivityFields, paneGateLevel, SEEN_HEADER, seenPane } from "./server.ts";
import type { AuditEntry, AuditLog } from "./audit.ts";
import type { StateEngine } from "./state-engine.ts";

describe("seenPane — manual read / unread mark", () => {
  test("marksPaneSeen leaves `seen` to its own handler, paneGateLevel gates it as write, and isTopologyWrite warms peer sweeps", () => {
    expect(marksPaneSeen(new Request("http://x/api/pane/w1:p1/seen", { method: "POST" }), "seen")).toBe(false);
    expect(
      marksPaneSeen(
        new Request("http://x/api/pane/w1:p1/seen", { method: "POST", headers: { [SEEN_HEADER]: "1" } }),
        "seen",
      ),
    ).toBe(false);
    expect(paneGateLevel("seen", "POST")).toBe("write");
    expect(paneGateLevel("seen")).toBe("write");
    expect(isTopologyWrite("/api/pane/w1%3Ap1/seen", "POST")).toBe(true);
  });

  test("toggles seen/unread on a live top-level agent pane, audits pane.seen, pokes the engine, and rejects invalid targets or bodies", async () => {
    const recordedSeen: Array<{ session: string; paneId: string; seen: boolean }> = [];
    const audits: AuditEntry[] = [];
    let pokes = 0;

    const activity = {
      setSeen(session: string, paneId: string, seen: boolean) {
        recordedSeen.push({ session, paneId, seen });
      },
    };
    const stubEngine: Partial<StateEngine> = {
      pokeNow: () => {
        pokes++;
      },
      current: () => ({
        bridge: "connected",
        agents: [
          {
            paneId: "w1:p1",
            workspaceId: "w1",
            workspaceLabel: "webapp",
            workspaceNumber: 1,
            tabId: "w1:t1",
            agent: "claude",
            status: "idle",
            cwd: "/work/webapp",
            focused: false,
          },
          {
            paneId: "w1:child",
            workspaceId: "w1",
            workspaceLabel: "webapp",
            workspaceNumber: 1,
            tabId: "w1:t1",
            agent: "claude",
            status: "idle",
            cwd: "/work/webapp",
            focused: false,
            parentPaneId: "w1:p1",
          },
          {
            paneId: "w1:unpaned",
            workspaceId: "w1",
            workspaceLabel: "webapp",
            workspaceNumber: 1,
            tabId: "w1:t1",
            agent: "claude",
            status: "done",
            cwd: "/work/webapp",
            focused: false,
            unpaned: true,
          },
          {
            paneId: "w1:working",
            workspaceId: "w1",
            workspaceLabel: "webapp",
            workspaceNumber: 1,
            tabId: "w1:t1",
            agent: "claude",
            status: "working",
            cwd: "/work/webapp",
            focused: false,
          },
          {
            paneId: "w1:blocked",
            workspaceId: "w1",
            workspaceLabel: "webapp",
            workspaceNumber: 1,
            tabId: "w1:t1",
            agent: "claude",
            status: "blocked",
            cwd: "/work/webapp",
            focused: false,
          },
        ],
        shellPanes: [
          {
            paneId: "w1:sh",
            workspaceId: "w1",
            workspaceLabel: "webapp",
            workspaceNumber: 1,
            tabId: "w1:t1",
            agent: "shell",
            status: "unknown",
            cwd: "/work/webapp",
            focused: false,
            kind: "shell",
          },
        ],
        workspaces: [],
        tabs: [],
        ts: 1000,
      }),
    };
    // SAFETY: seenPane reads only `current().agents` and `pokeNow()`.
    const engine = stubEngine as Pick<StateEngine, "current" | "pokeNow">;
    const audit: Pick<AuditLog, "record"> = {
      record(entry) {
        audits.push(entry);
      },
    };

    const unreadRes = await seenPane(
      activity,
      engine,
      "w1:p1",
      new Request("http://x/api/pane/w1%3Ap1/seen", { method: "POST", body: JSON.stringify({ seen: false }) }),
      audit,
      "iphone",
      "default",
    );
    expect(unreadRes.status).toBe(200);
    expect(await unreadRes.json()).toEqual({ ok: true });
    expect(recordedSeen).toEqual([{ session: "default", paneId: "w1:p1", seen: false }]);
    expect(pokes).toBe(1);
    expect(audits).toEqual([
      { action: "pane.seen", paneId: "w1:p1", session: "default", device: "iphone", detail: { seen: false } },
    ]);

    // Rejects malformed JSON, non-boolean `seen`, missing pane, shell pane, and unsettled/child/unpaned panes.
    const badJson = await seenPane(
      activity,
      engine,
      "w1:p1",
      new Request("http://x/api/pane/w1%3Ap1/seen", { method: "POST", body: "{" }),
      audit,
      "iphone",
      "default",
    );
    expect(badJson.status).toBe(400);

    const badSeen = await seenPane(
      activity,
      engine,
      "w1:p1",
      new Request("http://x/api/pane/w1%3Ap1/seen", { method: "POST", body: JSON.stringify({ seen: "yes" }) }),
      audit,
      "iphone",
      "default",
    );
    expect(badSeen.status).toBe(400);

    for (const missingId of ["w1:missing", "w1:sh"]) {
      const res = await seenPane(
        activity,
        engine,
        missingId,
        new Request("http://x/api/pane/x/seen", { method: "POST", body: JSON.stringify({ seen: true }) }),
        audit,
        "iphone",
        "default",
      );
      expect(res.status).toBe(404);
    }

    for (const unsettledId of ["w1:child", "w1:unpaned", "w1:working", "w1:blocked"]) {
      const res = await seenPane(
        activity,
        engine,
        unsettledId,
        new Request("http://x/api/pane/x/seen", { method: "POST", body: JSON.stringify({ seen: false }) }),
        audit,
        "iphone",
        "default",
      );
      expect(res.status).toBe(409);
      expect(await res.text()).toBe("pane is not settled");
    }
  });

  test("paneActivityFields emits manualUnseen: true only when unreadAt is present and activeAt > seenAt", () => {
    expect(paneActivityFields(undefined)).toEqual({});
    expect(paneActivityFields({ activeAt: 200, seenAt: 100 })).toEqual({ lastActiveAt: 200, lastSeenAt: 100 });
    expect(paneActivityFields({ activeAt: 200, seenAt: 200 })).toEqual({ lastActiveAt: 200, lastSeenAt: 200 });
    expect(paneActivityFields({ activeAt: 200, seenAt: 199, unreadAt: 500 })).toEqual({
      lastActiveAt: 200,
      lastSeenAt: 199,
      manualUnseen: true,
    });
  });
});
