import { describe, expect, test } from "bun:test";

import { claudeConfigDir, discoverClaudeCommands, parseFrontmatter, type DiscoveryIo } from "./claude-commands.ts";

interface FakeTree {
  readonly [path: string]: string;
}

/** A disk made of file paths; every folder is implied by a file below it. */
function fakeIo(files: FakeTree): DiscoveryIo {
  return {
    async list(dir) {
      const prefix = `${dir}/`;
      const seen = new Map<string, boolean>();
      for (const path of Object.keys(files)) {
        if (!path.startsWith(prefix)) continue;
        const [head, ...rest] = path.slice(prefix.length).split("/");
        seen.set(head!, (seen.get(head!) ?? false) || rest.length > 0);
      }
      return seen.size === 0 ? null : [...seen].map(([name, isDir]) => ({ name, dir: isDir }));
    },
    async read(path) {
      return files[path] ?? null;
    },
  };
}

const skill = (description: string, extra = "") => `---\ndescription: ${description}\n${extra}---\nbody\n`;

async function run(files: FakeTree, cwd: string | null = "/h/code/app/src") {
  const warns: string[] = [];
  const rows = await discoverClaudeCommands({
    home: "/h",
    cwd,
    configDir: "/h/.claude",
    io: fakeIo(files),
    warn: (m) => warns.push(m),
  });
  return { rows, warns, names: rows.map((r) => r.command) };
}

describe("parseFrontmatter", () => {
  test("reads the fields Claude Code uses", () => {
    expect(
      parseFrontmatter('---\nname: deploy\ndescription: "Ship it"\nargument-hint: "[env]"\nuser-invocable: false\n---\n'),
    ).toEqual({ name: "deploy", description: "Ship it", argumentHint: "[env]", userInvocable: false });
  });

  test("a file without a block is an ordinary command", () => {
    expect(parseFrontmatter("just a prompt\n")).toEqual({});
  });

  test("an unclosed or non-mapping block is broken, not empty", () => {
    expect(parseFrontmatter("---\ndescription: x\n")).toBeNull();
    expect(parseFrontmatter("---\n- a\n- b\n---\n")).toBeNull();
  });
});

describe("claudeConfigDir", () => {
  test("follows a profile's journal root, else the home default", () => {
    expect(claudeConfigDir(["/h/.claude-work/projects", "/h/.claude/projects"], "/h")).toBe("/h/.claude-work");
    expect(claudeConfigDir(["/srv/logs"], "/h")).toBe("/h/.claude");
    expect(claudeConfigDir([], "/h")).toBe("/h/.claude");
  });
});

describe("discoverClaudeCommands", () => {
  test("nothing on disk is a quiet empty list", async () => {
    expect(await run({})).toEqual({ rows: [], warns: [], names: [] });
  });

  test("personal skills take the frontmatter name, commands take a namespaced file name", async () => {
    const { rows } = await run({
      "/h/.claude/skills/deploy-staging/SKILL.md": skill("Deploy", "name: deploy\nargument-hint: \"[env]\"\n"),
      "/h/.claude/skills/notes/README.md": "not a skill",
      "/h/.claude/commands/frontend/component.md": "---\ndescription: Make a component\n---\n",
      "/h/.claude/commands/plain.md": "no frontmatter\n",
    });
    expect(rows).toEqual([
      { command: "/deploy", description: "Deploy", argHint: "[env]" },
      { command: "/frontend:component", description: "Make a component", argHint: "" },
      { command: "/plain", description: "", argHint: "" },
    ]);
  });

  test("user-invocable: false and a skillOverrides off are left out", async () => {
    const { names } = await run({
      "/h/.claude/skills/hidden/SKILL.md": skill("x", "user-invocable: false\n"),
      "/h/.claude/skills/muted/SKILL.md": skill("x"),
      "/h/.claude/skills/kept/SKILL.md": skill("x"),
      "/h/.claude/settings.json": JSON.stringify({ skillOverrides: { muted: "off", kept: "name-only" } }),
    });
    expect(names).toEqual(["/kept"]);
  });

  test("project folders are read from the cwd up to the repository root, and personal wins a name", async () => {
    const { rows, names } = await run({
      "/h/.claude/skills/deploy/SKILL.md": skill("personal"),
      "/h/code/app/.git/HEAD": "ref",
      "/h/code/app/.claude/skills/deploy/SKILL.md": skill("project"),
      "/h/code/app/.claude/skills/build/SKILL.md": skill("root"),
      "/h/code/app/src/.claude/commands/lint.md": "---\ndescription: near\n---\n",
      "/h/code/.claude/skills/above-repo/SKILL.md": skill("outside"),
    });
    expect(names).toEqual(["/deploy", "/lint", "/build"]);
    expect(rows[0]!.description).toBe("personal");
  });

  test("with no repository above it, only the cwd itself counts", async () => {
    const { names } = await run({
      "/h/code/app/src/.claude/skills/here/SKILL.md": skill("x"),
      "/h/code/app/.claude/skills/parent/SKILL.md": skill("x"),
    });
    expect(names).toEqual(["/here"]);
  });

  test("enabled plugins are namespaced; a disabled or other-project install is not", async () => {
    const installed = {
      plugins: {
        "codex@openai": [{ scope: "user", installPath: "/p/codex" }],
        "off@m": [{ scope: "user", installPath: "/p/off" }],
        "elsewhere@m": [{ scope: "project", projectPath: "/h/other", installPath: "/p/elsewhere" }],
        "here@m": [{ scope: "project", projectPath: "/h/code/app", installPath: "/p/here" }],
      },
    };
    const { names } = await run({
      "/h/.claude/plugins/installed_plugins.json": JSON.stringify(installed),
      "/h/.claude/settings.json": JSON.stringify({
        enabledPlugins: { "codex@openai": true, "off@m": false, "elsewhere@m": true, "here@m": true },
      }),
      "/p/codex/skills/rescue/SKILL.md": skill("x"),
      "/p/codex/commands/review.md": "---\ndescription: r\n---\n",
      "/p/off/skills/nope/SKILL.md": skill("x"),
      "/p/elsewhere/skills/nope/SKILL.md": skill("x"),
      "/p/here/skills/yes/SKILL.md": skill("x"),
    });
    expect(names).toEqual(["/codex:rescue", "/codex:review", "/here:yes"]);
  });

  test("a synced skill keeps its short name until another command has it, and counts once", async () => {
    const { names } = await run({
      "/h/.claude/skills/pdf/SKILL.md": skill("local"),
      "/h/.claude/skills/synced/acct-a/pdf/SKILL.md": skill("synced"),
      "/h/.claude/skills/synced/acct-a/morning/SKILL.md": skill("synced"),
      "/h/.claude/skills/synced/acct-b/morning/SKILL.md": skill("synced"),
    });
    expect(names).toEqual(["/pdf", "/anthropic-skills:pdf", "/morning"]);
  });

  test("an organisation-synced plugin is read from its account folder", async () => {
    const { names } = await run({
      "/h/.claude/plugins/synced/acct-a/review-kit~g2/skills/second-opinion/SKILL.md": skill("x"),
      "/h/.claude/plugins/synced/acct-b/review-kit~g2/skills/second-opinion/SKILL.md": skill("x"),
    });
    expect(names).toEqual(["/review-kit:second-opinion"]);
  });

  test("a broken file is skipped with its path named, and the rest still load", async () => {
    const { names, warns } = await run({
      "/h/.claude/skills/broken/SKILL.md": "---\ndescription: [unclosed\n---\n",
      "/h/.claude/skills/fine/SKILL.md": skill("x"),
      "/h/.claude/settings.json": "{ not json",
    });
    expect(names).toEqual(["/fine"]);
    expect(warns).toHaveLength(2);
    expect(warns.join("\n")).toContain("/h/.claude/skills/broken/SKILL.md");
    expect(warns.join("\n")).toContain("/h/.claude/settings.json");
  });

  test("descriptions are flattened and cut, and odd names are dropped", async () => {
    const long = "word ".repeat(80);
    const { rows } = await run({
      "/h/.claude/skills/long/SKILL.md": `---\ndescription: >\n  ${long}\n---\n`,
      "/h/.claude/skills/has space/SKILL.md": skill("x"),
    });
    expect(rows.map((r) => r.command)).toEqual(["/long"]);
    expect(rows[0]!.description.length).toBe(200);
    expect(rows[0]!.description.endsWith("…")).toBe(true);
  });
});
