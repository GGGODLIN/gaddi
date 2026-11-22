import { useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";

import { fixtureAgents, fixtureShellPanes, paneTextWithDraft } from "@/test/handlers";
import { withHeaderHost } from "@/test/header-host";
import { AgentChat } from "./agent-chat";

beforeAll(() => {
  // jsdom doesn't implement scrollTo; the terminal mirror's auto-scroll calls it.
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});

describe("AgentChat: pane switcher", () => {
  it("shows the dashboard's attention order and holds the opened list across polls", async () => {
    const user = userEvent.setup();
    let poll = () => {};
    function PolledPane() {
      const [agents, setAgents] = useState(fixtureAgents);
      const [shellPanes, setShellPanes] = useState(fixtureShellPanes);
      poll = () => {
        setAgents(agents.map((a) => ({ ...a, status: "working" as const })));
        setShellPanes([]);
      };
      return (
        <AgentChat
          paneId={agents[0]!.paneId}
          agent={agents[0]}
          agents={agents}
          shellPanes={shellPanes}
          tabs={[]}
          text={paneTextWithDraft("recent pane output")}
          onBack={vi.fn()}
          onSelect={vi.fn()}
        />
      );
    }
    const router = createMemoryRouter([{ path: "/", element: withHeaderHost(<PolledPane />) }]);
    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole("button", { name: "Switch pane" }));
    let sheet = screen.getByRole("dialog", { name: "Switch pane" });
    expect(within(sheet).getByRole("heading", { name: /Needs you/i })).toBeInTheDocument();
    expect(within(sheet).getByRole("heading", { name: /Working/i })).toBeInTheDocument();
    expect(within(sheet).getByRole("heading", { name: /Shells/i })).toBeInTheDocument();
    expect(within(sheet).queryByRole("heading", { name: /webapp/i })).toBeNull();

    act(() => poll());
    expect(within(sheet).getByRole("heading", { name: /Needs you/i })).toBeInTheDocument();
    expect(within(sheet).getByRole("heading", { name: /Shells/i })).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Switch pane" }));
    sheet = screen.getByRole("dialog", { name: "Switch pane" });
    expect(within(sheet).queryByRole("heading", { name: /Needs you/i })).toBeNull();
    expect(within(sheet).queryByRole("heading", { name: /Shells/i })).toBeNull();
    expect(within(sheet).getByRole("heading", { name: /Working/i })).toBeInTheDocument();
  });
});
