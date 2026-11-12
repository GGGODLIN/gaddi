import { expect } from "e2e";
import { surfaceOf } from "@e2e-dev/web";

import { en } from "../../src/lib/i18n/messages/en.ts";
import type { AgentView, SnapshotResponse } from "../../src/lib/types.ts";
import { parentChildAgents } from "../../src/test/fork-regression-data.ts";
import { fixtureSnapshot } from "../../src/test/handlers.ts";
import { engine } from "./engine.ts";
import { test } from "./fixtures.ts";

function page() {
  const live = surfaceOf(engine);
  if (live === undefined) throw new Error("No active TesterArmy browser");
  return live.page();
}

function buildParentChildSnapshot(agents: AgentView[] = structuredClone(parentChildAgents)): SnapshotResponse {
  const base = structuredClone(fixtureSnapshot);
  base.agents = agents;
  base.shellPanes = [];
  base.workspaces = [
    {
      workspaceId: "spProj",
      number: 1,
      label: "projects",
      focused: false,
      activeTabId: "tbMain",
      tabCount: 2,
      paneCount: agents.length,
    },
  ];
  base.tabs = [
    { tabId: "tbMain", workspaceId: "spProj", number: 1, label: "main-task", focused: false, paneCount: 3 },
    { tabId: "tbMail", workspaceId: "spProj", number: 2, label: "inbox-watch", focused: false, paneCount: 1 },
  ];
  return base;
}

async function installParentChildWorld(agents?: AgentView[]): Promise<void> {
  const snap = buildParentChildSnapshot(agents);
  await page().route("**/api/snapshot*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(snap),
    }),
  );
  await page().route((url) => /^\/api\/pane\/[^/]+$/.test(url.pathname), (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "t1");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        paneId: id,
        text: `Claude Code (${id})\n\n❯ `,
        truncated: false,
        revision: 1,
      }),
    });
  });
}

test("parent-child-dashboard/v1 — expands sub-agents by default without unread noise or horizontal overflow", async ({ app, screen }) => {
  await installParentChildWorld();
  await app.open("/");

  await expect(screen.getByText("main-task").first()).toBeVisible();
  await expect(screen.getByText("fix-qnx")).toBeVisible();
  await expect(screen.getByText("mf2-cli")).toBeVisible();
  await expect(screen.getByRole("button", "Collapse sub-agents (2)", { exact: true })).toBeVisible();

  const summary = await page().locator("#dash-summary-line").innerText();
  expect(summary.toLowerCase()).toContain("1 needs you");
  expect(summary.toLowerCase()).not.toContain("unseen");

  const fitsWidth = await page().getByRole("main").evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fitsWidth).toBe(true);
});

test("parent-child-fold-persist/v1 — folding hides children without navigating and survives reload", async ({ app, screen, browser }) => {
  await installParentChildWorld();
  await app.open("/");

  await screen.getByRole("button", "Collapse sub-agents (2)", { exact: true }).tap();
  await expect(browser).toHaveURL("/");
  await expect(screen.getByText("fix-qnx")).toHaveCount(0);
  await expect(screen.getByText("mf2-cli")).toHaveCount(0);

  const expandBtn = screen.getByRole("button", "Expand sub-agents (2)", { exact: true });
  await expect(expandBtn).toBeVisible();
  await expect(expandBtn.getByRole("img", en["status.label.blocked"])).toBeVisible();

  await page().reload({ waitUntil: "networkidle" });
  await expect(screen.getByRole("button", "Expand sub-agents (2)", { exact: true })).toBeVisible();
  await expect(screen.getByText("fix-qnx")).toHaveCount(0);

  await screen.getByRole("button", "Expand sub-agents (2)", { exact: true }).tap();
  await expect(screen.getByText("fix-qnx")).toBeVisible();
  await page().evaluate(() => window.localStorage.removeItem("collie:folded-parents:v1"));
});

test("parent-child-switcher-attention/v1 — blocked child lifts its parent family into Needs you", async ({ app, screen }) => {
  await installParentChildWorld();
  await app.open("/");

  await page().locator("#dash-summary-line").click();
  const dialog = screen.getByRole("dialog", en["chat.switcher.title"]);
  await expect(dialog).toBeVisible();

  const needsText = await page().locator("#switch-needs").innerText();
  expect(needsText).toContain("main-task");
  expect(needsText).toContain("fix-qnx");
  expect(needsText).toContain("mf2-cli");
  expect(await page().locator("#switch-ready").count()).toBe(0);
});

test("parent-child-pane-strip/v1 — parent hides unpaned pills while child offers one-tap parent return", async ({ app, screen, browser }) => {
  await installParentChildWorld();
  await app.open("/pane/t1");
  await expect(screen.getByText("Claude Code (t1)", { exact: false })).toBeVisible();
  expect(await page().getByRole("navigation", { name: en["space.paneStrip.title"] }).count()).toBe(0);

  await app.open("/pane/t2");
  await expect(screen.getByText("Claude Code (t2)", { exact: false })).toBeVisible();
  const strip = screen.getByRole("navigation", en["space.paneStrip.title"]);
  await expect(strip).toBeVisible();
  await strip.getByRole("button", /main-task/).tap();
  await expect(browser).toHaveURL("/pane/t1");
});

test("parent-child-orphan-fallback/v1 — an orphan child surfaces at top level with its own unread mark", async ({ app, screen }) => {
  const orphan = structuredClone(parentChildAgents[1]!);
  delete orphan.parentPaneId;
  delete orphan.unpaned;
  await installParentChildWorld([orphan]);
  await app.open("/");

  await expect(screen.getByText("fix-qnx")).toBeVisible();
  const summary = await page().locator("#dash-summary-line").innerText();
  expect(summary.toLowerCase()).toContain("1 unseen");
});
