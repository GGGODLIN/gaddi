import { expect, test } from "@playwright/test";

import { fixtureWorkspaces } from "@/test/handlers";

import { installApiStub, pinLocale } from "./fixtures/api";

const SIZES = [
  { name: "phone portrait", width: 390, height: 844, column: 390 },
  { name: "below tablet breakpoint", width: 700, height: 390, column: 640 },
  { name: "phone landscape", width: 844, height: 390, column: 640 },
  { name: "tablet portrait", width: 820, height: 1180, column: 768 },
  { name: "tablet landscape", width: 1180, height: 820, column: 1024 },
] as const;

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const route of ["/", `/space/${fixtureWorkspaces[0]!.workspaceId}`]) {
      test(`${route} shares one centred column with its header`, async ({ page }, testInfo) => {
        await installApiStub(page);
        await pinLocale(page, "en");
        await page.addInitScript(() => window.localStorage.setItem("collie:wide-layout-mode:v1", "off"));
        await page.goto(route);
        const main = page.getByRole("main");
        const header = page.getByRole("banner");
        await expect(main).toBeVisible();
        await expect(header).toBeVisible();
        // Visible matches only: from 1.18.0 the dashboard's workspace filter is a select, and its
        // hidden <option> carrying the same label comes first in the document.
        await expect(
          page.getByText(fixtureWorkspaces[0]!.label, { exact: false }).filter({ visible: true }).first(),
        ).toBeVisible();

        const body = (await main.boundingBox())!;
        const top = (await header.boundingBox())!;
        const viewport = page.viewportSize()!;
        // 以 viewport 比例驗證欄寬，不把字型、裝置縮放或截圖像素當成版型契約。
        expect(body.width / viewport.width).toBeCloseTo(size.column / size.width, 2);
        expect(top.width / viewport.width).toBeCloseTo(body.width / viewport.width, 2);
        expect(body.x / viewport.width).toBeCloseTo((1 - body.width / viewport.width) / 2, 2);
        expect(top.x / viewport.width).toBeCloseTo(body.x / viewport.width, 2);
        expect(await main.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

        if (route === "/") {
          const tabs = (await page.getByRole("navigation", { name: "Dashboard views" }).boundingBox())!;
          expect(tabs.width / viewport.width).toBeCloseTo(body.width / viewport.width, 2);
          expect(tabs.x / viewport.width).toBeCloseTo(body.x / viewport.width, 2);
        }
        console.log(JSON.stringify({ engine: testInfo.project.name, route, viewport, body, header: top }));
        await page.screenshot({ path: testInfo.outputPath("layout.png") });
      });
    }
  });
}
