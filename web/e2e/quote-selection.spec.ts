import { expect, test, type Page } from "@playwright/test";

import { fixtureSnapshot } from "@/test/handlers";
import { fixtureQuoteChat } from "@/test/quote-fixture";

import { installApiStub } from "./fixtures/api";

// A script sets the selection: Playwright has no touch long-press that selects text, and the case
// is about what the page does with a selection, not how iOS makes one.
async function select(page: Page, from: string, fromOffset: number, to: string) {
  await page.evaluate(
    ([start, offset, end]) => {
      const nodes: Node[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
      const first = nodes.find((n) => n.textContent?.includes(start));
      const last = nodes.find((n) => n.textContent?.includes(end));
      if (first === undefined || last === undefined) throw new Error(`no text node for ${start} / ${end}`);
      const range = document.createRange();
      range.setStart(first, offset);
      range.setEnd(last, last.textContent?.length ?? 0);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    [from, fromOffset, to] as const,
  );
}

test.beforeEach(async ({ page }) => {
  await installApiStub(page);
  // A pane that reported its session gets the Chat body, the one surface the button lives on.
  const snapshot = { ...fixtureSnapshot, agents: fixtureSnapshot.agents.map((a) => Object.assign({}, a, { hasSession: true })) };
  await page.route((url) => url.pathname === "/api/snapshot", (route) => route.fulfill({ json: snapshot }));
  await page.route((url) => /^\/api\/pane\/[^/]+\/chat$/.test(url.pathname), (route) =>
    route.fulfill({ json: fixtureQuoteChat }),
  );
  await page.goto("/pane/w1:p1");
  await page.getByText("The first paragraph explains the plan.").waitFor();
});

test("a selection across a reply's paragraphs and list lands in the draft as one quote", async ({ page }) => {
  const quote = page.getByRole("button", { name: "Quote" });
  await expect(quote).toHaveCount(0);
  await select(page, "The first paragraph", 4, "one bullet");
  await quote.click();
  const box = page.getByRole("textbox").last();
  await expect(box).toHaveValue(
    "> first paragraph explains the plan.\n>\n> The second paragraph names a file.ts chip.\n>\n> one bullet\n\n",
  );
  await expect(box).toBeFocused();
  await expect(quote).toHaveCount(0);
});

test("the operator's own turn and a drag across two replies offer nothing", async ({ page }) => {
  const quote = page.getByRole("button", { name: "Quote" });
  await select(page, "A later reply.", 0, "A later reply.");
  await expect(quote).toBeVisible();
  await select(page, "what is the plan?", 0, "what is the plan?");
  await expect(quote).toHaveCount(0);
  await select(page, "A later reply.", 0, "A later reply.");
  await expect(quote).toBeVisible();
  await select(page, "another bullet", 0, "A later reply.");
  await expect(quote).toHaveCount(0);
});
