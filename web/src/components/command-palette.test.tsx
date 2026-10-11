import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { CommandPalette } from "./command-palette";
import type { OperatorCommand } from "@/lib/types";
import { server } from "@/test/setup";

function setup(overrides?: { agent?: string | null; mine?: OperatorCommand[] }) {
  // Widened at the binding, not asserted at the literal: the overrides below hand `null` and
  // `undefined` for the same prop, so the base value has to carry the whole domain.
  const agentProp: string | null | undefined = "claude";
  const props = {
    open: true,
    onClose: vi.fn(),
    agent: agentProp,
    onInsert: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  render(<CommandPalette {...props} />);
  return props;
}

describe("CommandPalette", () => {
  it("shows only common commands when the query is empty", () => {
    setup();
    // /status is common; /doctor is not.
    expect(screen.getByText("/status")).toBeInTheDocument();
    expect(screen.queryByText("/doctor")).toBeNull();
  });

  it("filters across the full catalog as you type", async () => {
    const user = userEvent.setup();
    setup();
    const search = screen.getByPlaceholderText(/Search \d+ commands/);
    await user.type(search, "doctor");
    expect(screen.getByText("/doctor")).toBeInTheDocument();
    // Non-matching common commands fall away.
    expect(screen.queryByText("/status")).toBeNull();
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByPlaceholderText(/Search \d+ commands/), "zzzznotacommand");
    expect(screen.getByText(/No commands match/)).toBeInTheDocument();
  });

  it("inserts a no-arg command into the composer without sending and closes", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByText("/status"));
    expect(props.onInsert).toHaveBeenCalledExactlyOnceWith("/status");
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("inserts an arg-taking command into the composer (with trailing space) and closes", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByText("/compact")); // takesArg: true
    expect(props.onInsert).toHaveBeenCalledExactlyOnceWith("/compact ");
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("inserts a dangerous command for review instead of asking or sending", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByText("/clear"));
    expect(props.onInsert).toHaveBeenCalledExactlyOnceWith("/clear");
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByText("Confirm?")).toBeNull();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("renders nothing for an unknown agent (empty catalog → sheet still opens but no commands)", () => {
    setup({ agent: "gemini" });
    expect(screen.queryByText("/status")).toBeNull();
    expect(screen.queryByText("/compact")).toBeNull();
  });

  it("shows an operator command on the first screen and inserts it", async () => {
    const user = userEvent.setup();
    const props = setup({
      agent: "omp",
      mine: [
        {
          agent: "omp",
          command: "/fork-in-herdr",
          description: "Fork into a new herdr tab",
          takesArg: false,
          argHint: "",
        },
      ],
    });
    // No search needed — an operator-declared row is common by construction.
    await user.click(screen.getByText("/fork-in-herdr"));
    expect(props.onInsert).toHaveBeenCalledExactlyOnceWith("/fork-in-herdr");
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("gives an agent with no catalog a palette when an unscoped row applies", () => {
    setup({
      agent: "gemini",
      mine: [{ command: "/deploy", description: "Ship it", takesArg: false, argHint: "" }],
    });
    expect(screen.getByText("/deploy")).toBeInTheDocument();
  });

  it("renders one button when a scoped and an unscoped row name the same command", () => {
    setup({
      agent: "omp",
      mine: [
        { command: "/deploy", description: "Everywhere", takesArg: false, argHint: "" },
        { agent: "omp", command: "/deploy", description: "On omp", takesArg: false, argHint: "" },
      ],
    });
    // getAllByText, not getByText: two rows would also mean two children under one React key.
    expect(screen.getAllByText("/deploy")).toHaveLength(1);
    expect(screen.getByText("On omp")).toBeInTheDocument();
  });

  it("shows the operator's rows INSTEAD of the shipped catalog", () => {
    setup({
      agent: "omp",
      mine: [
        { agent: "omp", command: "/fork-in-herdr", description: "Fork", takesArg: false, argHint: "" },
      ],
    });
    expect(screen.getByText("/fork-in-herdr")).toBeInTheDocument();
    // The sheet is the operator's shortcuts now — no searching past ten rows nobody picked.
    expect(screen.queryByText("/compact")).toBeNull();
  });

  it("inserts a renamed destructive command without sending it", async () => {
    const user = userEvent.setup();
    const props = setup({
      agent: "omp",
      mine: [
        { agent: "omp", command: "/new", description: "Fresh start", takesArg: false, argHint: "" },
      ],
    });
    await user.click(screen.getByText("Fresh start"));
    expect(props.onInsert).toHaveBeenCalledExactlyOnceWith("/new");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("inserts an operator-confirmed command without sending it", async () => {
    const user = userEvent.setup();
    const props = setup({
      agent: "omp",
      mine: [
        {
          agent: "omp",
          command: "/deploy",
          description: "Deploy staging",
          takesArg: false,
          argHint: "",
          confirm: true,
        },
      ],
    });
    await user.click(screen.getByText("Deploy staging"));
    expect(props.onInsert).toHaveBeenCalledExactlyOnceWith("/deploy");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("finds the skills Claude Code would load in the pane, through the same search", async () => {
    server.use(
      http.get("/api/pane/w1%3Ap1/claude-commands", () =>
        HttpResponse.json({ commands: [{ command: "/to-spec", description: "Write the spec", argHint: "" }] }),
      ),
    );
    const user = userEvent.setup();
    render(<CommandPalette open onClose={vi.fn()} agent="claude" paneId="w1:p1" onInsert={vi.fn()} />);
    expect(screen.queryByText("/to-spec")).toBeNull();
    await user.type(screen.getByPlaceholderText(/Search \d+ commands/), "to-spec");
    expect(await screen.findByText("/to-spec")).toBeInTheDocument();
  });

  it("keeps the palette it had when the machine cannot answer", async () => {
    server.use(http.get("/api/pane/w1%3Ap1/claude-commands", () => new HttpResponse(null, { status: 501 })));
    render(<CommandPalette open onClose={vi.fn()} agent="claude" paneId="w1:p1" onInsert={vi.fn()} />);
    expect(await screen.findByText("/status")).toBeInTheDocument();
  });
});
