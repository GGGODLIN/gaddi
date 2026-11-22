import type { Screen } from "e2e";
import { expect } from "e2e";
import type { Browser } from "@e2e-dev/web";
import { surfaceOf } from "@e2e-dev/web";

import { t } from "../../src/lib/i18n/index.ts";
import { en } from "../../src/lib/i18n/messages/en.ts";
import type { LaunchersResponse } from "../../src/lib/types.ts";
import { engine } from "./engine.ts";
import { test } from "./fixtures.ts";

// Loop batch 02. Expectations are docs/configure.md: Theme is the Settings
// choice and survives reload (not a claim that every colour was measured);
// Zen is off until Device enables it, then the pane menu can hide chrome and
// the floating control or Escape brings it back; active zen is transient on
// reload while the setting remains. Pane-switch reset is not in this file:
// while zen is on, the switcher is not in the tree, and a sideways pane change
// replaces history, so browser back is not the other pane. Launch sections are
// the empty launchers fixture already served by web/e2e/fixtures/api.ts.

const DASHBOARD = "/";
const PANE_LINE = "hello from the pane";
const LAUNCH_HEADING = /^launch\b/iu;

interface Openable {
  open: (path?: string) => Promise<void>;
}

function page() {
  const live = surfaceOf(engine);
  if (live === undefined) throw new Error("No active TesterArmy browser");
  return live.page();
}

function watchLaunchPosts(): string[] {
  const posts: string[] = [];
  page().context().on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (path === "/api/launch") posts.push(`${request.method()} ${path}`);
  });
  return posts;
}

function footer(screen: Screen) {
  return screen.getByRole("navigation", en["home.tabs.aria"]);
}

async function openDashboard(app: Openable, screen: Screen, browser: Browser): Promise<void> {
  const launchers = browser.waitForResponse(/\/api\/launchers(?:\?|$)/u);
  await app.open(DASHBOARD);
  const response = await launchers;
  expect(response.status).toBe(200);
  expect(await response.json<LaunchersResponse>()).toEqual({ launchers: [], home: "" });
  await expect(footer(screen).getByRole("button", new RegExp(`^${en["home.tabs.dashboard"]}(?:\\s*,|$)`, "u"))).toBeVisible();
  await expect(screen.getByRole("button", /^claude logo claude/u)).toBeVisible();
}

async function openClaudePane(app: Openable, screen: Screen): Promise<void> {
  await app.open(DASHBOARD);
  await expect(footer(screen).getByRole("button", new RegExp(`^${en["home.tabs.dashboard"]}(?:\\s*,|$)`, "u"))).toBeVisible();
  await screen.getByRole("button", /^claude logo claude/u).tap();
  await expect(screen.getByRole("button", en["chat.paneMenu.aria"])).toBeVisible();
}

async function turnZenOn(app: Openable, screen: Screen): Promise<void> {
  await app.open(DASHBOARD);
  await expect(footer(screen).getByRole("button", new RegExp(`^${en["home.tabs.dashboard"]}(?:\\s*,|$)`, "u"))).toBeVisible();
  await screen.getByRole("button", en["nav.settings.aria"]).tap();
  await expect(screen.getByRole("heading", en["settings.title"])).toBeVisible();
  await screen.getByRole("button", /^Keys and touch\b/u).tap();
  await expect(screen.getByRole("heading", en["settings.page.keys.title"])).toBeVisible();
  const zen = screen.getByRole("switch", en["settings.zen.title"]);
  await expect(zen).toHaveAttribute("aria-checked", "false");
  await zen.tap();
  await expect(zen).toHaveAttribute("aria-checked", "true");
}

async function enterZen(app: Openable, screen: Screen): Promise<void> {
  await turnZenOn(app, screen);
  await openClaudePane(app, screen);
  await screen.getByRole("button", en["chat.paneMenu.aria"]).tap();
  const sheet = screen.getByRole("dialog");
  await expect(sheet.getByRole("button", en["chat.find.label"])).toBeVisible();
  await sheet.getByRole("button", en["chat.zen.label"]).tap();
  await expect(screen.getByRole("button", en["chat.zen.exitAria"])).toBeVisible();
  await expect(screen.getByRole("textbox")).toBeHidden();
  await expect(screen.getByText(PANE_LINE)).toBeVisible();
}

async function expectChromeRestored(screen: Screen): Promise<void> {
  await expect(screen.getByRole("textbox")).toBeVisible();
  await expect(screen.getByRole("button", t("nav.home.aria.default"))).toBeVisible();
  await expect(screen.getByRole("button", en["chat.zen.exitAria"])).toHaveCount(0);
}

test("SET-THEME/reload — Appearance offers System, Light and Dark, and the chosen option is still selected after reload", async ({ app, screen }) => {
  await app.open(DASHBOARD);
  await expect(footer(screen).getByRole("button", new RegExp(`^${en["home.tabs.dashboard"]}(?:\\s*,|$)`, "u"))).toBeVisible();
  await screen.getByRole("button", en["nav.settings.aria"]).tap();
  await expect(screen.getByRole("heading", en["settings.title"])).toBeVisible();
  await screen.getByRole("button", /^Look and feel\b/u).tap();
  await expect(screen.getByRole("heading", en["settings.page.look.title"])).toBeVisible();

  const theme = screen.getByRole("radiogroup", en["settings.lightDark.title"]);
  const system = theme.getByRole("radio", en["settings.theme.option.system"]);
  const light = theme.getByRole("radio", en["settings.theme.option.light"]);
  const dark = theme.getByRole("radio", en["settings.theme.option.dark"]);
  await expect(system).toHaveAttribute("aria-checked", "true");
  await expect(light).toHaveAttribute("aria-checked", "false");
  await expect(dark).toHaveAttribute("aria-checked", "false");

  await light.tap();
  await expect(light).toHaveAttribute("aria-checked", "true");
  await expect(system).toHaveAttribute("aria-checked", "false");

  // Same page and context: a restarted browser would drop the API routes.
  await page().reload();
  await expect(screen.getByRole("heading", en["settings.page.look.title"])).toBeVisible();
  await expect(light).toHaveAttribute("aria-checked", "true");
  await expect(system).toHaveAttribute("aria-checked", "false");
  await expect(dark).toHaveAttribute("aria-checked", "false");
});

test("SET-ZEN/absent — the pane menu is open and has Find, and Zen is not offered", async ({ app, screen }) => {
  await openClaudePane(app, screen);
  await screen.getByRole("button", en["chat.paneMenu.aria"]).tap();
  const sheet = screen.getByRole("dialog");
  await expect(sheet.getByRole("button", en["chat.find.label"])).toBeVisible();
  await expect(sheet.getByRole("button", en["chat.zen.label"])).toHaveCount(0);
});

test("SET-ZEN/exit — enabling Zen adds the menu row, and the floating control restores the chrome", async ({ app, screen }) => {
  await enterZen(app, screen);
  await screen.getByRole("button", en["chat.zen.exitAria"]).tap();
  await expectChromeRestored(screen);
});

test("SET-ZEN/escape — Escape restores the chrome the same way the floating control does", async ({ app, screen, browser }) => {
  await enterZen(app, screen);
  await browser.keyboard.press("Escape");
  await expectChromeRestored(screen);
});

test("SET-ZEN/reload — reload clears the active view and keeps the Device setting", async ({ app, screen }) => {
  await enterZen(app, screen);
  await page().reload();
  await expectChromeRestored(screen);
  await screen.getByRole("button", en["chat.paneMenu.aria"]).tap();
  const sheet = screen.getByRole("dialog");
  await expect(sheet.getByRole("button", en["chat.find.label"])).toBeVisible();
  await expect(sheet.getByRole("button", en["chat.zen.label"])).toBeVisible();
});

test("LAUNCH-OFF/dashboard — the herd is on screen, Launch is not, and nothing posts /api/launch", async ({ app, screen, browser }) => {
  const posts = watchLaunchPosts();
  await openDashboard(app, screen, browser);
  await expect(screen.getByRole("heading", LAUNCH_HEADING)).toHaveCount(0);
  expect(posts).toEqual([]);
});

test("LAUNCH-OFF/switcher — the pane sheet is open on another pane, Launch is not, and nothing posts /api/launch", async ({ app, screen, browser }) => {
  const posts = watchLaunchPosts();
  await openDashboard(app, screen, browser);
  await screen.getByRole("button", /^claude logo claude/u).tap();
  await screen.getByRole("button", /^Switch pane/u).tap();
  const sheet = screen.getByRole("dialog");
  await expect(sheet.getByRole("button", /^codex logo codex/u)).toBeVisible();
  await expect(sheet.getByRole("heading", LAUNCH_HEADING)).toHaveCount(0);
  expect(posts).toEqual([]);
});
