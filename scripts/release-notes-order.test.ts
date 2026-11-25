// Tests for the ORDER of the groups on the release page (`scripts/release-notes.ts`).
//
// The page lists the groups in the order a version's `###` headings stand in its CHANGELOG section,
// so a patch can open with its fixes. A section in the usual order (Added, Changed, Fixed, ...)
// gives the page it always gave.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { checkUnreleased, GROUPS, type GroupName, parseSection, renderBody } from "./release-notes.ts";

const REPO = "AltanS/collie";
const FORK_RELEASE_WITH_FIXED_ORDER = "2.16.1";

/** A section with the headings in the order given; each group holds one bullet named after it. */
function section(version: string, headings: readonly string[]): string {
	const blocks = headings.map((name, i) => `### ${name}\n\n- **${name} lead ${i}.** Detail. ([abc123${i}](https://github.com/AltanS/collie/commit/abc123${i}))\n`);
	return `# Changelog\n\n## [Unreleased]\n\n## [${version}] - 2026-10-01\n\n${blocks.join("\n")}\n## [0.0.1] - 2026-01-01\n\n### Added\n\n- **Old.** ([0000000](https://github.com/AltanS/collie/commit/0000000))\n`;
}

/** The group names of a page, in the order it prints them. */
function pageOrder(body: string): string[] {
	return [...body.matchAll(/^\*\*(Added|Changed|Fixed|Packaging|Docs)\*\*$/gm)].map((m) => m[1] ?? "");
}

describe("the order of the groups on the release page", () => {
	test("a section with Fixed before Changed renders Fixed first", () => {
		const changelog = section("2.1.1", ["Fixed", "Changed"]);
		expect(pageOrder(renderBody(changelog, "2.1.1", REPO, "v2.1.1"))).toEqual(["Fixed", "Changed"]);
	});

	test("five headings in a scrambled order come out as written", () => {
		const written: GroupName[] = ["Docs", "Fixed", "Packaging", "Added", "Changed"];
		const changelog = section("2.1.1", written);
		expect(pageOrder(renderBody(changelog, "2.1.1", REPO, "v2.1.1"))).toEqual(written);
		expect(parseSection(changelog, "2.1.1").groups.map((g) => g.name)).toEqual(written);
	});

	test("the usual order gives the page it always gave", () => {
		const changelog = section("2.1.1", [...GROUPS]);
		expect(pageOrder(renderBody(changelog, "2.1.1", REPO, "v2.1.1"))).toEqual([...GROUPS]);
	});

	test("a group named twice keeps one block per heading, side by side at its first place", () => {
		const changelog = section("2.1.1", ["Fixed", "Added", "Fixed"]);
		const body = renderBody(changelog, "2.1.1", REPO, "v2.1.1");
		expect(pageOrder(body)).toEqual(["Fixed", "Fixed", "Added"]);
		expect(body.indexOf("Fixed lead 0.")).toBeLessThan(body.indexOf("Fixed lead 2."));
	});

	test("an unknown heading still stops the release, in any position", () => {
		const changelog = section("2.1.1", ["Fixed", "Security", "Added"]);
		expect(() => renderBody(changelog, "2.1.1", REPO, "v2.1.1")).toThrow("unknown group heading '### Security'");
	});

	test("the handles of a section are named in the page's order", () => {
		const changelog = `## [Unreleased]\n\n## [2.1.1] - 2026-10-01\n\n### Fixed\n\n- **A fix.** Thanks @second (#2).\n\n### Added\n\n- **A feature.** Thanks @first (#1).\n`;
		const body = renderBody(changelog, "2.1.1", REPO, "v2.1.1");
		expect(body.indexOf("@second")).toBeLessThan(body.indexOf("@first"));
	});

	test("the Unreleased check keeps the section's order too", () => {
		const changelog = "## [Unreleased]\n\n### Fixed\n\n- **A fix.** ([abc1234](https://example.invalid/c))\n\n### Added\n\n- **A feature.** ([abc1235](https://example.invalid/d))\n";
		expect(checkUnreleased(changelog).map((g) => g.name)).toEqual(["Fixed", "Added"]);
	});

	test("the Edge build's opening line is untouched by a reordered section", () => {
		const changelog = section("2.1.1", ["Fixed", "Added"]);
		const body = renderBody(changelog, "2.1.1-edge.1", REPO, "v2.1.1-edge.1");
		expect(body.startsWith("**This is an Edge build**, a pre-release for volunteers. A Stable install does not take it,\nand the Stable release of the same version supersedes it.\n\n## What changed\n\n**Fixed**\n")).toBe(true);
		expect(pageOrder(body)).toEqual(["Fixed", "Added"]);
	});
});

describe("a fork release with the usual heading order in CHANGELOG.md", () => {
	const changelog = readFileSync(join(import.meta.dir, "..", "CHANGELOG.md"), "utf8");

	test("its headings stand in the usual order, so its page is the page the fixed order gave", () => {
		const headings = parseSection(changelog, FORK_RELEASE_WITH_FIXED_ORDER).groups.map((group) => group.name);
		expect(headings).toEqual(["Changed", "Fixed"]);
		const body = renderBody(changelog, FORK_RELEASE_WITH_FIXED_ORDER, REPO, `v${FORK_RELEASE_WITH_FIXED_ORDER}`, "v2.16.0");
		expect(pageOrder(body)).toEqual(headings);
	});
});
