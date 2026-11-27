import { render, screen, waitFor, within } from "@testing-library/react";
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

  it("does not show the PinHint when folding drops visible rows below 3", async () => {
    __resetFoldedParents();
    const user = userEvent.setup();
    const parent = agent("t1", "idle", { ...ws(1), paneLabel: "parent-pane" });
    const childA = agent("t2", "working", { ...ws(1), paneLabel: "child-a", parentPaneId: "t1" });
    const childB = agent("t3", "working", { ...ws(1), paneLabel: "child-b", parentPaneId: "t1" });

    render(<AgentList agents={[parent, childA, childB]} {...props} onHold={vi.fn()} />);
    expect(screen.getByText("Hold a pane to pin it here.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse sub-agents (2)" }));
    await waitFor(() => expect(screen.queryByText("Hold a pane to pin it here.")).toBeNull());
    __resetFoldedParents();
  });

  it("focuses the first visible tree-ordered parent row when dismissing PinHint with >= 3 visible rows after folding", async () => {
    __resetFoldedParents();
    const user = userEvent.setup();
    // Children sort before their parent in raw paneId order; nestPanes places parent first.
    // 2 independent rows + 1 parent (with 2 folded children) = 3 visible rows after folding.
    const orphanChild = agent("t2", "working", { ...ws(1), paneLabel: "child-a", parentPaneId: "t9" });
    const childB = agent("t3", "working", { ...ws(1), paneLabel: "child-b", parentPaneId: "t9" });
    const parent = agent("t9", "idle", { ...ws(1), paneLabel: "parent-first" });
    const row2 = agent("t4", "idle", { ...ws(1), paneLabel: "row-two" });
    const row3 = agent("t5", "idle", { ...ws(1), paneLabel: "row-three" });

    render(<AgentList agents={[orphanChild, childB, parent, row2, row3]} {...props} onHold={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Collapse sub-agents (2)" }));
    const dismissBtn = screen.getByRole("button", { name: "Dismiss hint" });
    expect(dismissBtn).toBeInTheDocument();

    dismissBtn.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: /parent-first/ })).toHaveFocus();
    __resetFoldedParents();
  });
});
