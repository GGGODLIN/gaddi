import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AgentList } from "./agent-list";
import { __resetFoldedParents } from "@/lib/pane-tree";
import type { AgentStatus, AgentView } from "@/lib/types";

function agent(paneId: string, status: AgentStatus, over: Partial<AgentView> = {}): AgentView {
  return {
    paneId,
    workspaceId: "w0",
    workspaceLabel: paneId,
    workspaceNumber: 1,
    tabId: "w0:t1",
    agent: "claude",
    status,
    cwd: "/home/k/proj",
    focused: false,
    ...over,
  };
}

const rowButtons = () => screen.getAllByRole("button").filter((b) => b.closest("section") !== null);

describe("AgentList — parent-child tree", () => {
  const ws = (n: number) => ({ workspaceId: `w${n}`, workspaceLabel: `space-${n}`, workspaceNumber: n, tabId: `w${n}:t1` });
  const props = { onOpen: vi.fn() };

  it("nests workers expanded by default, folds and unfolds without opening the parent", async () => {
    __resetFoldedParents();
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const parent = agent("t1", "idle", { ...ws(1), paneLabel: "X貼文分析" });
    const workerA = agent("t2", "done", { ...ws(1), paneLabel: "fix-qnx", parentPaneId: "t1", lastActiveAt: 200, lastSeenAt: 100 });
    const workerB = agent("t3", "blocked", { ...ws(1), paneLabel: "mf2-cli", parentPaneId: "t1" });

    render(<AgentList agents={[parent, workerA, workerB]} {...props} onOpen={onOpen} />);
    expect(screen.getByText("fix-qnx")).toBeInTheDocument();
    expect(screen.getByText("mf2-cli")).toBeInTheDocument();

    const collapseBtn = screen.getByRole("button", { name: "Collapse sub-agents (2)" });
    await user.click(collapseBtn);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByText("fix-qnx")).toBeNull();
    expect(screen.queryByText("mf2-cli")).toBeNull();

    const expandBtn = screen.getByRole("button", { name: "Expand sub-agents (2)" });
    expect(within(expandBtn).getByRole("img", { name: "needs you" })).toBeInTheDocument();
    await user.click(expandBtn);
    expect(screen.getByText("fix-qnx")).toBeInTheDocument();
    __resetFoldedParents();
  });

  it("keeps ranked Activity and Cache lists flat without nesting or folding sub-agents", () => {
    __resetFoldedParents();
    const parent = agent("t1", "idle", { ...ws(1), paneLabel: "parent-pane", lastActiveAt: 100 });
    const child = agent("t2", "done", { ...ws(1), paneLabel: "child-worker", parentPaneId: "t1", lastActiveAt: 500 });
    const mid = agent("t3", "working", { ...ws(1), paneLabel: "mid-pane", lastActiveAt: 300 });

    render(<AgentList agents={[parent, child, mid]} {...props} order="activity" />);
    const rendered = rowButtons().map((r) =>
      within(r).queryByText("child-worker")
        ? "child"
        : within(r).queryByText("mid-pane")
          ? "mid"
          : within(r).queryByText("parent-pane")
            ? "parent"
            : "other",
    );
    expect(rendered).toEqual(["child", "mid", "parent"]);
    expect(screen.queryByRole("button", { name: /sub-agents/i })).toBeNull();
  });
});
