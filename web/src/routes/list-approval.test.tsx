import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { vi } from "vitest";

import permission from "@/fixtures/panes/claude--permission-bash.txt?raw";
import question from "@/fixtures/panes/claude--select-menu.txt?raw";
import plan from "@/fixtures/panes/claude--plan-approval.txt?raw";
import trust from "@/fixtures/panes/claude--trust-prompt-unnumbered.txt?raw";
import { CrewProvider } from "@/components/crew-provider";
import { paneLoader, ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { resetIdleLock, setLocked } from "@/lib/idle";
import { markNotPaired } from "@/lib/pairing";
import { resetPanePrefetch } from "@/lib/pane-prefetch";
import { fixtureAgents, fixtureServers, fixtureTabs, fixtureWorkspaces } from "@/test/handlers";
import { withHeaderHost } from "@/test/header-host";
import { server } from "@/test/setup";
import { changedPermissionScreen, unknownModalScreen } from "@/test/fork-supplement-data";
import { HomeRoute } from "./home";
import { SpaceRoute } from "./space";

function setup(path = "/") {
  let text = permission;
  let readFailure = false;
  const reads: string[] = [];
  const writes: { url: string; body: unknown }[] = [];
  const data: HomeData = {
    bridge: "connected", device: undefined, agents: structuredClone(fixtureAgents),
    shellPanes: [], workspaces: fixtureWorkspaces, tabs: fixtureTabs,
    sessions: [], servers: [], ts: 0, scope: {}, viewAll: false,
    snoozedUntil: null, update: undefined, error: false, authError: false,
  };
  server.use(
    http.get("/api/pane/:id", ({ request, params }) => {
      reads.push(request.url);
      return readFailure ? new HttpResponse(null, { status: 503 }) : HttpResponse.json({
        paneId: params.id, text, revision: 0, truncated: false,
      });
    }),
    http.post("/api/pane/:id/keys", async ({ request }) => {
      writes.push({ url: request.url, body: await request.json() });
      return HttpResponse.json({ ok: true });
    }),
  );
  const router = createMemoryRouter([{
    path: "/", id: ROOT_ROUTE_ID, loader: () => ({ ...data }),
    element: withHeaderHost(<CrewProvider servers={data.servers} sessions={[]} ts={0} pollMs={1500}><Outlet /></CrewProvider>),
    children: [
      { index: true, element: <HomeRoute /> },
      { path: "space/:spaceId", element: <SpaceRoute /> },
      { path: "pane/:paneId", loader: paneLoader, element: <div>Pane destination</div> },
    ],
  }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return { data, router, reads, writes, setText: (next: string) => { text = next; }, failRead: () => { readFailure = true; } };
}

type TestApp = ReturnType<typeof setup>;

async function tapBlocked() {
  const heading = await screen.findByRole("heading", { name: "webapp" });
  // Skip the heading's own "+" (new tab, #290): it is a button in the same section.
  const row = within(heading.closest("section")!)
    .getAllByRole("button")
    .find((b) => !(b.getAttribute("aria-label") ?? "").startsWith("New tab"))!;
  await userEvent.click(row);
}

const sheet = () => screen.findByRole("dialog", { name: "Permission required" });
const approve = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: "Yes" });
const refresh = async (app: TestApp) => { await act(() => app.router.revalidate()); };

beforeEach(() => { resetIdleLock(); resetPanePrefetch(); });
afterEach(() => {
  resetIdleLock();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});

it("opens a permission sheet without navigation, shows the command and exactly the printed choices", async () => {
  const app = setup();
  await tapBlocked();
  const dialog = await sheet();
  expect(app.router.state.location.pathname).toBe("/");
  expect(dialog).toHaveTextContent("mkfifo fixture-fifo");
  expect(approve(dialog)).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: /Yes, and don’t ask again for: mkfifo fixture-fifo/ })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: "No" })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: "Open pane" })).toBeEnabled();
  expect(app.reads.every((url) => new URL(url).pathname === "/api/pane/w1%3Ap1")).toBe(true);
  expect(app.writes).toEqual([]);
});

it("keeps every line of a long command visible", async () => {
  const app = setup();
  const command = Array.from({ length: 60 }, (_, i) => `  printf 'line-${i}'`).join("\n");
  app.setText(permission.replace("   mkfifo fixture-fifo", command));
  await tapBlocked();
  const dialog = await sheet();
  expect(dialog).toHaveTextContent("printf 'line-0'");
  expect(dialog).toHaveTextContent("printf 'line-59'");
});

it("sends the printed don't-ask-again choice once, with a prompt binding", async () => {
  const app = setup();
  await tapBlocked();
  await userEvent.click(within(await sheet()).getByRole("button", { name: /Yes, and don’t ask again/ }));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  expect(app.writes[0]?.body).toMatchObject({ keys: ["2"], expected_prompt: expect.stringContaining("mkfifo fixture-fifo") });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(app.router.state.location.pathname).toBe("/");
});

it.each([["question", question], ["plan", plan], ["trust", trust], ["unknown", unknownModalScreen]])(
  "opens the pane rather than treating %s as a tool permission", async (_label, text) => {
    const app = setup();
    app.setText(text);
    await tapBlocked();
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/pane/w1%3Ap1"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(app.writes).toEqual([]);
  },
);

it("preserves ordinary row navigation even when its mirror resembles a permission", async () => {
  const app = setup();
  app.data.agents[0]!.status = "working";
  await tapBlocked();
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/pane/w1%3Ap1"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("can open the pane explicitly from the sheet", async () => {
  const app = setup();
  await tapBlocked();
  await userEvent.click(within(await sheet()).getByRole("button", { name: "Open pane" }));
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/pane/w1%3Ap1"));
  expect(app.writes).toEqual([]);
});

it.each(["answered", "different prompt", "gone", "read failure"])("closes the old sheet after %s on revalidation", async (change) => {
  const app = setup();
  await tapBlocked();
  await sheet();
  if (change === "answered") app.setText("The tool has finished.");
  if (change === "different prompt") app.setText(changedPermissionScreen(permission));
  if (change === "gone") app.data.agents = [];
  if (change === "read failure") app.failRead();
  await refresh(app);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(app.writes).toEqual([]);
});

it("closes on an empty raw read at the same revision while the snapshot is still blocked", async () => {
  const app = setup();
  await tapBlocked();
  const oldButton = approve(await sheet());
  app.setText("");
  await refresh(app);
  expect(app.data.agents[0]?.status).toBe("blocked");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await userEvent.click(oldButton);
  expect(app.writes).toEqual([]);
});

it("rejects a stale tap even when the pane revision stays zero", async () => {
  const app = setup();
  await tapBlocked();
  const button = approve(await sheet());
  app.setText(changedPermissionScreen(permission));
  await userEvent.click(button);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(app.writes).toEqual([]);
});

it("rejects a changed command prefix outside the old forty-line guard window", async () => {
  const app = setup();
  const command = Array.from({ length: 60 }, (_, i) => `  printf 'line-${i}'`).join("\n");
  const longPrompt = permission.replace("   mkfifo fixture-fifo", command);
  app.setText(longPrompt);
  await tapBlocked();
  const button = approve(await sheet());
  app.setText(longPrompt.replace("printf 'line-0'", "rm important-file"));
  await userEvent.click(button);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(app.writes).toEqual([]);
});

it.each(["read-only", "pairing", "idle", "hidden"])("does not write while %s", async (gate) => {
  const app = setup();
  await tapBlocked();
  const button = approve(await sheet());
  if (gate === "read-only") {
    app.data.device = { enforced: true, device: null, authorized: false };
    await refresh(app);
  }
  if (gate === "pairing") act(() => markNotPaired());
  if (gate === "idle") act(() => setLocked(true));
  if (gate === "hidden") act(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await userEvent.click(button);
  expect(app.writes).toEqual([]);
});

it("binds both read and approval to the row's host and session", async () => {
  const app = setup();
  app.data.servers = fixtureServers;
  app.data.agents[0] = { ...app.data.agents[0]!, host: "workshop", session: "other-session" };
  await tapBlocked();
  await userEvent.click(approve(await sheet()));
  await waitFor(() => expect(app.writes).toHaveLength(1));
  for (const url of [...app.reads, app.writes[0]!.url]) {
    expect(new URL(url).searchParams.get("host")).toBe("workshop");
    expect(new URL(url).searchParams.get("session")).toBe("other-session");
  }
});

it.each(["close", "idle", "hidden", "pairing"])("rechecks %s after the send guard's read is in flight", async (gate) => {
  const app = setup();
  await tapBlocked();
  const dialog = await sheet();
  const started = vi.fn();
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  server.use(http.get("/api/pane/:id", async ({ params }) => {
    started();
    await pending;
    return HttpResponse.json({ paneId: params.id, text: permission, revision: 0, truncated: false });
  }));
  await userEvent.click(approve(dialog));
  await waitFor(() => expect(started).toHaveBeenCalled());
  if (gate === "close") await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  if (gate === "idle") act(() => setLocked(true));
  if (gate === "hidden") act(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  if (gate === "pairing") act(() => markNotPaired());
  await act(async () => { release(); await pending; });
  await screen.findByText("Menu changed, refreshing");
  expect(app.writes).toEqual([]);
});

it("does not scan unopened panes or keep polling after dismissal", async () => {
  const app = setup();
  await screen.findByRole("heading", { name: "webapp" });
  expect(app.reads).toEqual([]);
  await tapBlocked();
  await userEvent.click(within(await sheet()).getByRole("button", { name: "Close" }));
  const before = app.reads.length;
  await refresh(app);
  expect(app.reads).toHaveLength(before);
});

it("falls back to the pane rather than truncating a screen beyond the binding limit", async () => {
  const app = setup();
  app.setText(permission.replace("   mkfifo fixture-fifo", "x".repeat(8200)));
  await tapBlocked();
  await waitFor(() => expect(app.router.state.location.pathname).toBe("/pane/w1%3Ap1"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(app.writes).toEqual([]);
});

it("closes after an unknown write result without retrying", async () => {
  const app = setup();
  const sent = vi.fn();
  server.use(http.post("/api/pane/:id/keys", () => {
    sent();
    return new HttpResponse(null, { status: 503 });
  }));
  await tapBlocked();
  await userEvent.dblClick(approve(await sheet()));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await refresh(app);
  expect(sent).toHaveBeenCalledTimes(1);
});

it("also opens approvals from a workspace list", async () => {
  const app = setup("/space/w1");
  const main = await screen.findByRole("main");
  const row = within(main).getByRole("button", { name: /claude/i });
  await userEvent.click(row);
  await waitFor(() => expect(app.reads.length).toBeGreaterThan(0));
  expect(screen.queryByText("Pane destination"), JSON.stringify({ reads: app.reads, row: row.textContent, url: app.router.state.location })).not.toBeInTheDocument();
  await sheet();
  expect(app.router.state.location.pathname).toBe("/space/w1");
});
