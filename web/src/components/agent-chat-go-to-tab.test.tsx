import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";

import { fixtureAgents, paneTextWithDraft } from "@/test/handlers";
import { withHeaderHost } from "@/test/header-host";
import { server } from "@/test/setup";
import { __forgetTabPaneMemory } from "@/lib/tab-pane-memory";
import { AgentChat } from "./agent-chat";
import type { AgentView, TabView } from "@/lib/types";

vi.mock("@/lib/liveness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/liveness")>()),
  isLive: () => true,
  useLive: () => true,
}));

beforeAll(() => {
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});

describe("AgentChat: goToTab and closeCurrentTab with unpaned child", () => {
  const current = fixtureAgents[0]!; // w1:p1 in tab w1:t1
  const unpanedChild: AgentView = {
    paneId: "w1:c1",
    workspaceId: "w1",
    workspaceLabel: "webapp",
    workspaceNumber: 1,
    tabId: "w1:t2",
    agent: "claude",
    status: "working",
    cwd: "/home/you/webapp",
    focused: false,
    parentPaneId: "w1:s1",
    unpaned: true,
    sessionName: "background-worker",
    terminalTitle: "background-worker",
  };
  const shellParent: AgentView = {
    paneId: "w1:s1",
    workspaceId: "w1",
    workspaceLabel: "webapp",
    workspaceNumber: 1,
    tabId: "w1:t2",
    agent: "shell",
    status: "unknown",
    cwd: "/home/you/webapp",
    focused: false,
    kind: "shell",
    terminalTitle: "shell-parent",
  };
  const tabs: TabView[] = [
    { tabId: "w1:t1", workspaceId: "w1", number: 1, label: "main", focused: true, paneCount: 1 },
    { tabId: "w1:t2", workspaceId: "w1", number: 2, label: "tools", focused: false, paneCount: 1 },
  ];

  function renderWithToolsTab(onSelect = vi.fn(), onBack = vi.fn()) {
    const router = createMemoryRouter([
      {
        path: "/",
        element: withHeaderHost(
          <AgentChat
            paneId={current.paneId}
            agent={current}
            agents={[current, unpanedChild]}
            shellPanes={[shellParent]}
            tabs={tabs}
            text={paneTextWithDraft("recent output")}
            onBack={onBack}
            onSelect={onSelect}
          />,
        ),
      },
    ]);
    render(<RouterProvider router={router} />);
    return { onSelect, onBack };
  }

  it("keeps the tab title on its label and opens the visible shell parent rather than jumping into its background unpaned agent child", async () => {
    __forgetTabPaneMemory();
    const user = userEvent.setup();
    const { onSelect } = renderWithToolsTab();

    expect(screen.queryByRole("button", { name: /background-worker/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /tools/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("w1:s1");
  });

  it("lands on the visible shell parent in the neighbouring tab when closing the current tab", async () => {
    __forgetTabPaneMemory();
    const user = userEvent.setup();
    server.use(
      http.post(/\/api\/tab\/[^/]+\/close$/, () => HttpResponse.json({ ok: true })),
    );
    const { onSelect, onBack } = renderWithToolsTab();

    fireEvent.contextMenu(screen.getByRole("button", { name: /main$/ }));
    await user.click(screen.getByRole("button", { name: "Close tab" }));
    await user.click(screen.getByRole("button", { name: "Tap again to close 1 pane" }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledExactlyOnceWith("w1:s1"));
    expect(onBack).not.toHaveBeenCalled();
  });
});
