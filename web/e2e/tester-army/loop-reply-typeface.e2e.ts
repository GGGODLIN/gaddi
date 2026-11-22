import type { Browser } from "@e2e-dev/web";
import { surfaceOf } from "@e2e-dev/web";
import type { Screen } from "e2e";
import { expect } from "e2e";

import { DESIGN_STORAGE_KEY } from "../../src/lib/design.ts";
import { t } from "../../src/lib/i18n/index.ts";
import { en } from "../../src/lib/i18n/messages/en.ts";
import { asJsonString, parseJsonObject } from "../../src/lib/json.ts";
import type { AgentView, SnapshotResponse } from "../../src/lib/types.ts";
import {
  fixtureAgents,
  fixtureSnapshot,
  paneTextWithDraft,
} from "../../src/test/handlers.ts";
import {
  fullReplyHasSession,
  fullReplyHistory,
  fullReplyPrompt,
  fullReplyReadableLines,
} from "../../src/test/fork-supplement-data.ts";
import {
  shippedTypefaceOptionLabels,
  typefaceDefaultValue,
  typefaceGroteskStore,
  typefaceGroteskValue,
  wrappedTableAfter,
  wrappedTablePainted,
  wrappedTableSource,
} from "../../src/test/sweep-loop-reply-data.ts";
import { engine } from "./engine.ts";
import { pinTerminalView, test } from "./fixtures.ts";

// Loop batch 04. The wrapped-table source and painted rows are the unit literals.
// The history prompt is the existing full-reply literal: the table case has no
// user turn, and the card only pairs a reply that has one. Type uses the named
// Controls action, not a long-press. Typeface expects the unit's selected value
// aldrich, not the old test title.

const DASHBOARD = "/";
const CLAUDE_PANE = "/pane/w1:p1";
const CODEX_PANE = /\/pane\/w2(?:%3A|:)p1$/u;
const ALDRICH_LABEL = shippedTypefaceOptionLabels[2];

function page() {
  const live = surfaceOf(engine);
  if (live === undefined) throw new Error("No active TesterArmy browser");
  return live.page();
}

function keyPosts(): string[] {
  const posts: string[] = [];
  page().context().on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (path.endsWith("/keys")) posts.push(`${request.method()} ${path}`);
  });
  return posts;
}

function withClaude(patch: Partial<AgentView>): SnapshotResponse {
  const next = structuredClone(fixtureSnapshot);
  const claude = next.agents[0];
  if (claude === undefined || claude.paneId !== "w1:p1" || claude.agent !== fixtureAgents[0]?.agent) {
    throw new Error("fixtureAgents[0] is no longer the claude pane w1:p1");
  }
  Object.assign(claude, patch);
  return next;
}

type FixtureBody = SnapshotResponse | ReturnType<typeof fullReplyHistory>;

async function serveJson(matcher: (url: URL) => boolean, body: FixtureBody): Promise<void> {
  await page().route(matcher, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(body),
  }));
}

async function serveSnapshot(snapshot: SnapshotResponse): Promise<void> {
  await serveJson((url) => url.pathname === "/api/snapshot", snapshot);
}

async function servePaneText(text: string): Promise<void> {
  await page().route((url) => /^\/api\/pane\/[^/]+$/.test(url.pathname), (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ paneId: "w1:p1", text, revision: 0, truncated: false }),
  }));
}

function sourceLines(): string[] {
  return wrappedTableSource.split("\n");
}

function suggestionCell(): string {
  const row = sourceLines()[4];
  if (row === undefined) throw new Error("wrapped table source has no first data row");
  const cells = row.split("|").map((cell) => cell.trim()).filter((cell) => cell !== "");
  const suggestion = cells[1];
  if (suggestion === undefined || !suggestion.startsWith("不重問")) {
    throw new Error("wrapped table suggestion cell is not the original literal");
  }
  return suggestion;
}

function typefaceFamily(screen: Screen) {
  if (ALDRICH_LABEL === undefined) throw new Error("shipped typeface labels have no Aldrich entry");
  return screen.getByLabel(en["settings.typeface.family"]).filter({
    has: screen.getByRole("option", ALDRICH_LABEL, { exact: true }),
  });
}

async function designStore(browser: Browser): Promise<{ font: string }> {
  const raw = await browser.evaluate((key: string) => localStorage.getItem(key), DESIGN_STORAGE_KEY);
  const font = asJsonString(parseJsonObject(raw ?? "")?.font);
  if (font === undefined) throw new Error("collie:design:v1 has no font string");
  return { font };
}

test("REPLY-PAINT/wrapped-table/v2 — a wrapped table whose cells are painted out of source order still shows that reply once", async ({ app, screen, prepared }) => {
  expect(prepared).toBe(true);
  await pinTerminalView();
  const head = sourceLines()[0];
  const closing = sourceLines().at(-1);
  if (head === undefined || head === "" || closing === undefined || closing === "") {
    throw new Error("wrapped table source is missing its head or closing line");
  }
  const posts = keyPosts();
  await serveSnapshot(withClaude({ hasSession: fullReplyHasSession, readableLines: fullReplyReadableLines }));
  await servePaneText(paneTextWithDraft([...wrappedTablePainted, ...wrappedTableAfter].join("\n")));
  await serveJson(
    (url) => /^\/api\/pane\/[^/]+\/history$/.test(url.pathname),
    fullReplyHistory(wrappedTableSource, fullReplyPrompt),
  );
  await app.open(CLAUDE_PANE);
  await expect(screen.getByRole("button", new RegExp(`${en["chat.fullReply.title"]} ${en["chat.fullReply.fromTranscript"]}`, "i"))).toBeVisible();
  await expect(screen.getByText(fullReplyPrompt, { exact: true })).toBeVisible();
  await expect(screen.getByText(head, { exact: true })).toBeVisible();
  await expect(screen.getByText(suggestionCell(), { exact: false })).toBeVisible();
  await expect(screen.getByText(closing, { exact: false })).toHaveCount(1);
  const tail = wrappedTableAfter[1];
  if (tail === undefined) throw new Error("wrapped table after-row is missing");
  await expect(screen.getByText(tail, { exact: false })).toBeVisible();
  expect(posts).toEqual([]);
});

test("SEND-NAME/arm — the named Type control starts off and arms without posting keys", async ({ app, screen, prepared }) => {
  expect(prepared).toBe(true);
  const posts = keyPosts();
  await app.open(CLAUDE_PANE);
  await expect(screen.getByRole("button", en["chat.paneMenu.aria"])).toBeVisible();
  const typeButton = screen.getByRole("group", en["composer.controls.label"]).getByRole("button", en["composer.controls.typeAria"]);
  await expect(typeButton).toHaveAttribute("aria-pressed", "false");
  await typeButton.tap();
  await expect(typeButton).toHaveAttribute("aria-pressed", "true");
  await expect(screen.getByText(en["directTyping.status.armed"], { exact: true })).toBeVisible();
  expect(posts).toEqual([]);
});

test("SEND-NAME/pane — Type armed on this pane is released after a real pane switch", async ({ app, screen, browser, prepared }) => {
  expect(prepared).toBe(true);
  const posts = keyPosts();
  await app.open(CLAUDE_PANE);
  const typeButton = screen.getByRole("group", en["composer.controls.label"]).getByRole("button", en["composer.controls.typeAria"]);
  await expect(typeButton).toHaveAttribute("aria-pressed", "false");
  await typeButton.tap();
  await expect(typeButton).toHaveAttribute("aria-pressed", "true");
  await screen.getByRole("button", en["chat.switcher.aria"]).tap();
  const sheet = screen.getByRole("dialog");
  await expect(sheet.getByRole("button", /^codex logo codex/u)).toBeVisible();
  await sheet.getByRole("button", /^codex logo codex/u).tap();
  await expect(browser).toHaveURL(CODEX_PANE);
  await expect(screen.getByRole("group", en["composer.controls.label"]).getByRole("button", en["composer.controls.typeAria"])).toHaveAttribute("aria-pressed", "false");
  expect(posts).toEqual([]);
});

test("SET-FACE/reload — Appearance offers the three shipped faces, Aldrich is selected, and Space Grotesk survives reload", async ({ app, screen, browser, prepared }) => {
  expect(prepared).toBe(true);
  await app.open(DASHBOARD);
  await screen.getByRole("button", en["nav.settings.aria"]).tap();
  await expect(screen.getByRole("heading", en["settings.title"])).toBeVisible();
  await screen.getByRole("button", /^Look and feel\b/u).tap();
  await expect(screen.getByRole("heading", en["settings.page.look.title"])).toBeVisible();
  await expect(screen.getByText(en["settings.typeface.title"], { exact: true })).toBeVisible();

  const family = typefaceFamily(screen);
  await expect(family.getByRole("option")).toHaveText([...shippedTypefaceOptionLabels]);
  await expect(family).toHaveValue(typefaceDefaultValue);
  await expect(screen.getByText(en["settings.typeface.note.aldrich"], { exact: true })).toBeVisible();

  await family.selectOption({ value: typefaceGroteskValue });
  await expect(family).toHaveValue(typefaceGroteskValue);
  await expect(screen.getByText(t("settings.typeface.note.grotesk"), { exact: true })).toBeVisible();
  expect(await designStore(browser)).toEqual({ ...typefaceGroteskStore });

  await page().reload();
  await expect(screen.getByRole("heading", en["settings.page.look.title"])).toBeVisible();
  const reloaded = typefaceFamily(screen);
  await expect(reloaded).toHaveValue(typefaceGroteskValue);
  await expect(reloaded.getByRole("option")).toHaveText([...shippedTypefaceOptionLabels]);
  await expect(screen.getByText(t("settings.typeface.note.grotesk"), { exact: true })).toBeVisible();
  expect(await designStore(browser)).toEqual({ ...typefaceGroteskStore });
});
