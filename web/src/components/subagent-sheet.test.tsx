import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";

import { ToolCard } from "@/components/chat-cards";
import { SubagentSheet } from "@/components/subagent-sheet";
import { server } from "@/test/setup";
import type { TranscriptEntry } from "@/lib/types";

afterEach(cleanup);

const SUBAGENT_ENTRIES: TranscriptEntry[] = [
  {
    uuid: "sub-u1",
    ts: "2026-10-18T01:00:00.000Z",
    role: "user",
    parts: [{ kind: "text", text: "Please inspect bridge/solo-baseline.test.ts and report missing routes." }],
  },
  {
    uuid: "sub-a1",
    ts: "2026-10-18T01:00:02.000Z",
    role: "assistant",
    parts: [
      {
        kind: "tool",
        id: "toolu_read1",
        name: "Read",
        summary: "bridge/solo-baseline.test.ts",
        call: { kind: "read", path: "bridge/solo-baseline.test.ts", range: [1, 90] },
        result: { text: "1\t// route list" },
      },
    ],
  },
  {
    uuid: "sub-a2",
    ts: "2026-10-18T01:00:05.000Z",
    role: "assistant",
    parts: [{ kind: "text", text: "The route `/api/pane/:id/claude-commands` is missing from **SOLO_ROUTES**." }],
  },
];

describe("SubagentSheet", () => {
  it("opens a bottom sheet on tapping a task card, fetches the subagent log, toggles the prompt, and renders steps and report", async () => {
    server.use(
      http.get("/api/pane/w1%3Ap1/subagent/af52a45b4a25847ac", () =>
        HttpResponse.json({
          paneId: "w1:p1",
          agentId: "af52a45b4a25847ac",
          available: true,
          entries: SUBAGENT_ENTRIES,
          fileTruncated: false,
        }),
      ),
    );

    render(
      <SubagentSheet paneId="w1:p1">
        <ToolCard
          tool={{
            kind: "task",
            agent: "deep-explore",
            summary: "Check CI route allowlist",
            agentId: "af52a45b4a25847ac",
            output: "The route `/api/pane/:id/claude-commands` is missing from **SOLO_ROUTES**.",
          }}
          status="done"
        />
      </SubagentSheet>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /deep-explore/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("solo-baseline.test.ts")).toBeTruthy();
    });
    expect(screen.getByText("SOLO_ROUTES")).toBeTruthy();

    // Prompt starts collapsed (preview only) and expands on tap
    const promptBtn = screen.getByRole("button", { name: /Prompt|派工指令/i });
    expect(promptBtn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(promptBtn);
    expect(promptBtn.getAttribute("aria-expanded")).toBe("true");
  });

  it("falls back to rendering the task output when no subagent log is available", async () => {
    server.use(
      http.get("/api/pane/w1%3Ap1/subagent/a0000000000000000", () =>
        HttpResponse.json({
          paneId: "w1:p1",
          agentId: "a0000000000000000",
          available: false,
        }),
      ),
    );

    render(
      <SubagentSheet paneId="w1:p1">
        <ToolCard
          tool={{
            kind: "task",
            agent: "upstream-pr-reviewer",
            summary: "Review bundle",
            agentId: "a0000000000000000",
            output: "VERDICT: CLEAR — all 48 lines verified.",
          }}
          status="done"
        />
      </SubagentSheet>,
    );

    fireEvent.click(screen.getByRole("button", { name: /upstream-pr-reviewer/i }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/VERDICT: CLEAR/)).toBeTruthy();
    });
  });
});
