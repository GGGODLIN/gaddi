import type { Screen } from "e2e";
import { expect } from "e2e";
import { surfaceOf } from "@e2e-dev/web";

import { en } from "../../src/lib/i18n/messages/en.ts";
import { zhTW } from "../../src/lib/i18n/messages/zh-TW.ts";
import { engine } from "./engine.ts";
import { test } from "./fixtures.ts";

// Loop batch 05. docs/configure.md: Language is Settings → Appearance and is saved per device;
// Changes depth is Settings → Device, default on / 2, and turning the folder search off disables
// the depth without dropping the stored choice. ADR 0082 makes Chat the default without an opt-in;
// the pane menu owns the persistent device view choice. These cases claim no git search or live
// Chat transcript. Names come from the dictionaries and written decisions, not a failing run.

const DASHBOARD = "/";

// changes-control.test.tsx selects these four names; "4 levels" is the non-default it stores.
const DEPTH = ["1 level", "2 levels", "3 levels", "4 levels"] as const;
const DEPTH_DEFAULT = DEPTH[1];
const DEPTH_CHOSEN = DEPTH[3];

interface Openable {
  open: (path?: string) => Promise<void>;
}

function page() {
  const live = surfaceOf(engine);
  if (live === undefined) throw new Error("No active TesterArmy browser");
  return live.page();
}

function footer(screen: Screen) {
  return screen.getByRole("navigation", en["home.tabs.aria"]);
}

async function openSettingsIndex(app: Openable, screen: Screen): Promise<void> {
  await app.open(DASHBOARD);
  await expect(footer(screen).getByRole("button", new RegExp(`^${en["home.tabs.dashboard"]}(?:\\s*,|$)`, "u"))).toBeVisible();
  await screen.getByRole("button", en["nav.settings.aria"]).tap();
  await expect(screen.getByRole("heading", en["settings.title"])).toBeVisible();
}

async function openSection(app: Openable, screen: Screen, section: RegExp, heading: string): Promise<void> {
  await openSettingsIndex(app, screen);
  await screen.getByRole("button", section).tap();
  await expect(screen.getByRole("heading", heading)).toBeVisible();
}

function depthRadio(screen: Screen, name: (typeof DEPTH)[number]) {
  return screen.getByRole("radio", name);
}

async function chooseDepth(screen: Screen, name: (typeof DEPTH)[number]): Promise<void> {
  const chosen = depthRadio(screen, name);
  await chosen.tap();
  await expect(chosen).toHaveAttribute("aria-checked", "true");
}

async function openClaudeMenu(app: Openable, screen: Screen) {
  await app.open(DASHBOARD);
  await expect(footer(screen).getByRole("button", new RegExp(`^${en["home.tabs.dashboard"]}(?:\\s*,|$)`, "u"))).toBeVisible();
  await screen.getByRole("button", /^claude logo claude/u).tap();
  await expect(screen.getByRole("button", en["chat.paneMenu.aria"])).toBeVisible();
  await screen.getByRole("button", en["chat.paneMenu.aria"]).tap();
  const sheet = screen.getByRole("dialog");
  await expect(sheet.getByRole("button", en["chat.find.label"])).toBeVisible();
  return sheet;
}

test("SET-LANG/reload — Look and feel starts in English, Traditional Chinese is selected, and reload keeps that language", async ({ app, screen }) => {
  await openSection(app, screen, /^Look and feel\b/u, en["settings.page.look.title"]);
  const english = screen.getByRole("combobox", en["settings.language.title"]);
  await expect(english).toBeVisible();
  await expect(english).toHaveValue("en");
  await expect(screen.getByText(en["settings.language.description"])).toBeVisible();

  // language-control.test.tsx selects zh-TW and then sees the bundle's own title, 語言.
  await english.selectOption({ value: "zh-TW" });
  const chinese = screen.getByRole("combobox", zhTW["settings.language.title"]);
  await expect(chinese).toHaveValue("zh-TW");
  await expect(screen.getByRole("heading", zhTW["settings.page.look.title"])).toBeVisible();
  await expect(screen.getByText(zhTW["settings.language.description"])).toBeVisible();

  // Same page and context: a restarted browser would drop the API routes.
  await page().reload();
  await expect(screen.getByRole("heading", zhTW["settings.page.look.title"])).toBeVisible();
  await expect(screen.getByRole("combobox", zhTW["settings.language.title"])).toHaveValue("zh-TW");
  await expect(screen.getByText(zhTW["settings.language.description"])).toBeVisible();
});

test("SET-CHG-RANGE/reload — Dashboard and projects starts at 2 levels and keeps 4 levels after reload", async ({ app, screen }) => {
  await openSection(app, screen, /^Dashboard and projects\b/u, en["settings.page.dashboard.title"]);
  const nested = screen.getByRole("switch", en["settings.changes.nested.label"]);
  await expect(nested).toHaveAttribute("aria-checked", "true");
  await expect(depthRadio(screen, DEPTH_DEFAULT)).toHaveAttribute("aria-checked", "true");
  await expect(screen.getByText(en["settings.changes.depth.label"])).toBeVisible();

  await chooseDepth(screen, DEPTH_CHOSEN);
  await expect(depthRadio(screen, DEPTH_DEFAULT)).toHaveAttribute("aria-checked", "false");

  await page().reload();
  await expect(screen.getByRole("heading", en["settings.page.dashboard.title"])).toBeVisible();
  await expect(nested).toHaveAttribute("aria-checked", "true");
  await expect(depthRadio(screen, DEPTH_CHOSEN)).toHaveAttribute("aria-checked", "true");
  await expect(depthRadio(screen, DEPTH_DEFAULT)).toHaveAttribute("aria-checked", "false");
});

test("SET-CHG-RANGE/off — turning folder search off disables the depth radios and keeps 4 levels", async ({ app, screen }) => {
  await openSection(app, screen, /^Dashboard and projects\b/u, en["settings.page.dashboard.title"]);
  await chooseDepth(screen, DEPTH_CHOSEN);
  const nested = screen.getByRole("switch", en["settings.changes.nested.label"]);
  await nested.tap();
  await expect(nested).toHaveAttribute("aria-checked", "false");
  for (const name of DEPTH) {
    await expect(depthRadio(screen, name)).toBeDisabled();
  }
  await expect(depthRadio(screen, DEPTH_CHOSEN)).toHaveAttribute("aria-checked", "true");

  await page().reload();
  await expect(screen.getByRole("heading", en["settings.page.dashboard.title"])).toBeVisible();
  await expect(nested).toHaveAttribute("aria-checked", "false");
  for (const name of DEPTH) {
    await expect(depthRadio(screen, name)).toBeDisabled();
  }
  await expect(depthRadio(screen, DEPTH_CHOSEN)).toHaveAttribute("aria-checked", "true");

  await nested.tap();
  await expect(nested).toHaveAttribute("aria-checked", "true");
  await expect(depthRadio(screen, DEPTH_CHOSEN)).toBeEnabled();
  await expect(depthRadio(screen, DEPTH_CHOSEN)).toHaveAttribute("aria-checked", "true");
});

test("SET-CHAT/default/v2 — Chat needs no opt-in, and the pane menu offers Terminal view", async ({ app, screen }) => {
  await openSettingsIndex(app, screen);
  await expect(screen.getByRole("button", /^Experiments\b/u)).toHaveCount(0);

  const sheet = await openClaudeMenu(app, screen);
  await expect(sheet.getByRole("button", /^Terminal view\b/u)).toBeVisible();
  await expect(sheet.getByRole("button", /^Chat view\b/u)).toHaveCount(0);
});

test("SET-CHAT/reload/v2 — Terminal and Chat choices both survive reload without an experiment switch", async ({ app, screen }) => {
  const sheet = await openClaudeMenu(app, screen);
  await sheet.getByRole("button", /^Terminal view\b/u).tap();
  await expect(sheet).toBeHidden();

  await page().reload();
  await screen.getByRole("button", en["chat.paneMenu.aria"]).tap();
  await expect(sheet.getByRole("button", /^Chat view\b/u)).toBeVisible();
  await expect(sheet.getByRole("button", /^Terminal view\b/u)).toHaveCount(0);
  await sheet.getByRole("button", /^Chat view\b/u).tap();
  await expect(sheet).toBeHidden();

  await page().reload();
  await screen.getByRole("button", en["chat.paneMenu.aria"]).tap();
  await expect(sheet.getByRole("button", /^Terminal view\b/u)).toBeVisible();
  await expect(sheet.getByRole("button", /^Chat view\b/u)).toHaveCount(0);
});
