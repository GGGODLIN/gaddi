import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import { discoverAgentSkills, isSkillAgent, type SkillAgent } from "./agent-skills.ts";
import type { DiscoveryIo } from "./claude-commands.ts";

interface FakeTree {
  readonly [path: string]: string;
}

const native = (path: string) => path.replaceAll("/", sep);
const agents: SkillAgent[] = ["codex", "opencode", "pi", "omp", "grok", "agy", "muse"];
const skill = (description = "test", extra = "") => `---\ndescription: ${description}\n${extra}---\nbody\n`;
const repo = { "/h/code/app/.git/HEAD": "ref" };

function fakeIo(spelled: FakeTree): DiscoveryIo {
  const files = new Map(Object.entries(spelled).map(([path, text]) => [native(path), text] as const));
  return {
    async list(dir) {
      const prefix = dir.endsWith(sep) ? dir : `${dir}${sep}`;
      const seen = new Map<string, boolean>();
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        const [head, ...rest] = path.slice(prefix.length).split(sep);
        seen.set(head!, (seen.get(head!) ?? false) || rest.length > 0);
      }
      return seen.size === 0 ? null : [...seen].map(([name, isDir]) => ({ name, dir: isDir }));
    },
    async read(path) {
      return files.get(path) ?? null;
    },
  };
}

async function run(
  agent: SkillAgent,
  files: FakeTree,
  cwd: string | null = "/h/code/app/src",
  env: Readonly<Record<string, string | undefined>> = {},
) {
  return discoverAgentSkills(agent, { home: native("/h"), cwd: cwd === null ? null : native(cwd), env }, fakeIo(files));
}

async function names(agent: SkillAgent, files: FakeTree, cwd: string | null = "/h/code/app/src") {
  return (await run(agent, files, cwd)).map((row) => row.command);
}

describe("agent skill discovery", () => {
  test("recognises only the seven skill agents", () => {
    expect(agents.every(isSkillAgent)).toBe(true);
    for (const other of ["claude", "Codex", "", "toString"]) expect(isSkillAgent(other)).toBe(false);
  });

  test("a missing home folder yields an empty list for every agent", async () => {
    for (const agent of agents) {
      expect(await run(agent, {}, null)).toEqual([]);
      expect(await run(agent, repo)).toEqual([]);
    }
  });

  test("codex uses dollar mentions and nearest project definitions before user roots", async () => {
    const rows = await run("codex", {
      ...repo,
      "/h/code/app/src/.agents/skills/local/SKILL.md": skill("nearest", "name: ship\nargument-hint: '[env]'\n"),
      "/h/code/app/.agents/skills/ship/SKILL.md": skill("repo"),
      "/h/.codex/skills/ship/SKILL.md": skill("codex"),
      "/h/.agents/skills/ship/SKILL.md": skill("agents"),
      "/h/.codex/skills/zebra/SKILL.md": skill("z"),
    });
    expect(rows).toEqual([
      { command: "$ship", description: "nearest", argHint: "[env]" },
      { command: "$zebra", description: "z", argHint: "" },
    ]);
    expect((await run("codex", {
      "/h/.codex/skills/ship/SKILL.md": skill("codex"),
      "/h/.agents/skills/ship/SKILL.md": skill("agents"),
    }, null))[0]?.description).toBe("codex");
  });

  test("codex recursively finds depth six, skips deeper and hidden folders, and validates mentions", async () => {
    expect(await names("codex", {
      "/h/.codex/skills/a/b/c/d/e/six/SKILL.md": skill("deep", "name: six_1:ok-yes\n"),
      "/h/.codex/skills/a/b/c/d/e/f/seven/SKILL.md": skill("too deep"),
      "/h/.codex/skills/.system/internal/SKILL.md": skill("hidden"),
      "/h/.codex/skills/visible/.hidden/SKILL.md": skill("hidden"),
      "/h/.codex/skills/empty/SKILL.md": "---\nname: empty\n---\n",
      "/h/.codex/skills/bad.name/SKILL.md": skill("bad"),
    })).toEqual(["$six_1:ok-yes"]);
  });

  test("codex disables by name, file or folder in the configured CODEX_HOME", async () => {
    const files = {
      "/custom/config.toml": `[[skills.config]]\nname = "by-name"\nenabled = false\n[[skills.config]]\npath = ${JSON.stringify(native("/custom/skills/by-file/SKILL.md"))}\nenabled = false\n[[skills.config]]\npath = ${JSON.stringify(native("/custom/skills/by-folder"))}\nenabled = false\n`,
      "/custom/skills/by-name/SKILL.md": skill(),
      "/custom/skills/by-file/SKILL.md": skill(),
      "/custom/skills/by-folder/SKILL.md": skill(),
      "/custom/skills/kept/SKILL.md": skill(),
      "/h/.codex/skills/wrong-home/SKILL.md": skill(),
    };
    expect((await run("codex", files, null, { CODEX_HOME: native("/custom") })).map((row) => row.command)).toEqual(["$kept"]);
    expect(await names("codex", {
      "/h/.codex/config.toml": "[[invalid",
      "/h/.codex/skills/kept/SKILL.md": skill(),
    })).toEqual(["$kept"]);
  });

  test("opencode requires a frontmatter name, recurses, and preserves slash command paths", async () => {
    expect(await run("opencode", {
      "/h/.config/opencode/skills/group/folder/SKILL.md": skill("named", "name: actual\n"),
      "/h/.config/opencode/skills/unnamed/SKILL.md": skill(),
      "/h/.config/opencode/commands/sub/name.md": skill("command", "name: ignored\n"),
      "/h/.config/opencode/command/plain.md": "plain body",
    })).toEqual([
      { command: "/actual", description: "named", argHint: "" },
      { command: "/plain", description: "", argHint: "" },
      { command: "/sub/name", description: "command", argHint: "" },
    ]);
  });

  test("opencode prefers shared project roots, then native roots, then user roots", async () => {
    const rows = await run("opencode", {
      ...repo,
      "/h/code/app/.claude/skills/a/SKILL.md": skill("shared", "name: ship\n"),
      "/h/code/app/src/.opencode/skills/a/SKILL.md": skill("native", "name: ship\n"),
      "/h/.config/opencode/skills/a/SKILL.md": skill("user", "name: ship\n"),
      "/h/code/app/src/.opencode/commands/check.md": skill("project command"),
      "/h/.config/opencode/commands/check.md": skill("user command"),
    });
    expect(rows.map((row) => [row.command, row.description])).toEqual([["/check", "user command"], ["/ship", "shared"]]);
  });

  test("opencode honours XDG_CONFIG_HOME and skips malformed skills without inventing a hiding flag", async () => {
    const rows = await run("opencode", {
      "/xdg/opencode/skill/yes/SKILL.md": skill("yes", "name: yes\nuser-invocable: false\n"),
      "/xdg/opencode/skills/broken/SKILL.md": "---\nname: [broken\n---\n",
      "/h/.config/opencode/skills/no/SKILL.md": skill("no", "name: no\n"),
    }, null, { XDG_CONFIG_HOME: native("/xdg") });
    expect(rows.map((row) => row.command)).toEqual(["/yes"]);
  });

  test("pi spells skills separately from prompts, stops at skill roots, and prefers trusted projects", async () => {
    const rows = await run("pi", {
      ...repo,
      "/h/.pi/agent/trust.json": JSON.stringify({ [native("/h/code")]: true }),
      "/h/code/app/src/.pi/skills/ship/SKILL.md": skill("project"),
      "/h/code/app/src/.pi/skills/ship/nested/SKILL.md": skill("nested"),
      "/h/code/app/.agents/skills/ship/SKILL.md": skill("repo"),
      "/h/code/app/.pi/skills/above/SKILL.md": skill("above the cwd"),
      "/h/.pi/agent/skills/ship/SKILL.md": skill("user"),
      "/h/.agents/skills/ship/SKILL.md": skill("shared"),
      "/h/.pi/agent/prompts/ship.md": "\nFirst body line\nsecond",
      "/h/.pi/agent/prompts/explicit.md": skill("explicit", "argument-hint: '[file]'\n"),
    });
    expect(rows).toEqual([
      { command: "/explicit", description: "explicit", argHint: "[file]" },
      { command: "/ship", description: "First body line", argHint: "" },
      { command: "/skill:ship", description: "project", argHint: "" },
    ]);
  });

  test("pi trusts the nearest ancestor entry and denies absent, malformed or false trust", async () => {
    const files = {
      ...repo,
      "/h/code/app/src/.pi/skills/local/SKILL.md": skill(),
      "/h/code/app/.agents/skills/shared/SKILL.md": skill(),
      "/h/.pi/agent/skills/user/SKILL.md": skill(),
    };
    for (const trust of ["{}", "{broken", JSON.stringify({ [native("/h/code")]: true, [native("/h/code/app")]: false })]) {
      expect(await names("pi", { ...files, "/h/.pi/agent/trust.json": trust })).toEqual(["/skill:user"]);
    }
    expect(await names("pi", {
      ...files,
      "/h/.pi/agent/trust.json": JSON.stringify({ [native("/h/code")]: false, [native("/h/code/app/src")]: true }),
    })).toEqual(["/skill:local", "/skill:shared", "/skill:user"]);
  });

  test("pi excludes minus paths and only loads described loose files in its own roots", async () => {
    const files = {
      "/custom/trust.json": JSON.stringify({ [native("/h/code/app/src")]: true }),
      "/custom/settings.json": JSON.stringify({ skills: [`-${native("/custom/skills/file/SKILL.md")}`, "relative", "-relative", 7] }),
      "/custom/skills/file/SKILL.md": skill(),
      "/custom/skills/loose.md": skill("loose", "name: renamed\n"),
      "/custom/skills/no-description.md": "body",
      "/custom/skills/group/SKILL.md": "body",
      "/custom/skills/group/nested/SKILL.md": skill(),
      "/custom/skills/.hidden/SKILL.md": skill(),
      "/custom/skills/node_modules/no/SKILL.md": skill(),
      "/h/.agents/skills/no.md": skill(),
      "/h/blocked/nested/SKILL.md": skill(),
      "/h/code/app/src/.pi/skills/project.md": skill(),
    };
    const rows = await run("pi", files, "/h/code/app/src", { PI_CODING_AGENT_DIR: native("/custom") });
    expect(rows.map((row) => row.command)).toEqual(["/skill:project", "/skill:renamed"]);
    expect(await names("pi", {
      "/h/.pi/agent/settings.json": JSON.stringify({ skills: ["-~/.pi/agent/skills/blocked"] }),
      "/h/.pi/agent/skills/blocked/nested/SKILL.md": skill(),
      "/h/.pi/agent/skills/blocked-other/SKILL.md": skill(),
    })).toEqual(["/skill:blocked-other"]);
  });

  test("pi prompt fallback uses the first body line capped at sixty characters", async () => {
    const rows = await run("pi", { "/h/.pi/agent/prompts/long.md": `---\nname: ignored\n---\n\n${"x".repeat(80)}\n` });
    expect(rows).toEqual([{ command: "/long", description: "x".repeat(60), argHint: "" }]);
  });

  test("omp keeps user precedence and one-level layout, ignores foreign users and disabled or slashed names", async () => {
    const rows = await run("omp", {
      ...repo,
      "/h/.omp/agent/skills/ship/SKILL.md": skill("user"),
      "/h/code/app/src/.omp/skills/ship/SKILL.md": skill("project"),
      "/h/.agents/skills/ship/SKILL.md": skill("shared"),
      "/h/.omp/agent/skills/group/nested/SKILL.md": skill(),
      "/h/.omp/agent/skills/off/SKILL.md": skill("off", "enabled: false\n"),
      "/h/.omp/agent/skills/slash/SKILL.md": skill("bad", "name: a/b\n"),
      "/h/.omp/agent/skills/backslash/SKILL.md": skill("bad", "name: a\\b\n"),
      "/h/.claude/skills/foreign/SKILL.md": skill(),
      "/h/.codex/skills/foreign/SKILL.md": skill(),
      "/h/.config/opencode/skills/foreign/SKILL.md": skill(),
      "/h/.omp/skills/home-project/SKILL.md": skill(),
      "/h/code/app/src/.github/skills/no-desc/SKILL.md": "body",
      "/h/code/app/src/.github/skills/github/SKILL.md": skill(),
      "/h/code/app/src/.codex/skills/codex/SKILL.md": "body",
    });
    expect(rows.map((row) => [row.command, row.description])).toEqual([
      ["/skill:codex", ""], ["/skill:github", "test"], ["/skill:ship", "user"],
    ]);
  });

  test("grok normalises names, prefers trusted local then repo then user skills, and hides configured skills", async () => {
    const rows = await run("grok", {
      ...repo,
      "/h/.grok/trusted_folders.toml": `[folders.${JSON.stringify(native("/h/code"))}]\ntrusted = true\n`,
      "/h/code/app/src/.grok/skills/ship/SKILL.md": skill("local", "name: Ship_Now\n"),
      "/h/code/app/.agents/skills/ship/SKILL.md": skill("repo", "name: Ship Now\n"),
      "/h/.grok/skills/ship/SKILL.md": skill("user", "name: ship-now\n"),
      "/h/.grok/skills/hidden/SKILL.md": skill("hidden", "user-invocable: false\n"),
      "/h/.grok/skills/disabled/SKILL.md": skill(),
      "/h/.grok/skills/ignored/SKILL.md": skill(),
      "/h/.grok/config.toml": `[skills]\ndisabled = ["disabled"]\nignore = [${JSON.stringify(native("/h/.grok/skills/ignored"))}]\n`,
      "/h/.grok/commands/User_Check.md": skill("command"),
      "/h/.grok/commands/nested/no.md": skill(),
    });
    expect(rows.map((row) => [row.command, row.description])).toEqual([["/ship-now", "local"], ["/user-check", "command"]]);
  });

  test("grok trust gates every project tier and nearest false overrides an ancestor true", async () => {
    const files = {
      ...repo,
      "/g/skills/user/SKILL.md": skill(),
      "/h/code/app/src/.grok/skills/local/SKILL.md": skill(),
      "/h/code/app/.agents/commands/repo.md": skill(),
      "/h/code/app/src/.claude/skills/claude/SKILL.md": skill(),
      "/h/code/app/src/.cursor/skills/cursor/SKILL.md": skill(),
      "/h/.claude/commands/personal.md": skill(),
    };
    for (const trust of ["", "[broken", `[folders.${JSON.stringify(native("/h/code"))}]\ntrusted = true\n[folders.${JSON.stringify(native("/h/code/app"))}]\ntrusted = false\n`]) {
      const rows = await run("grok", { ...files, "/g/trusted_folders.toml": trust }, "/h/code/app/src", { GROK_HOME: native("/g") });
      expect(rows.map((row) => row.command)).toEqual(["/personal", "/user"]);
    }
    const rows = await run("grok", {
      ...files, "/g/trusted_folders.toml": `[folders.${JSON.stringify(native("/h/code/app/src"))}]\ntrusted = true\n`,
    }, "/h/code/app/src", { GROK_HOME: native("/g") });
    expect(rows.map((row) => row.command)).toEqual(["/claude", "/cursor", "/local", "/personal", "/repo", "/user"]);
  });

  test("agy prefers project spellings, hides disable-slash-command, and namespaces plugins", async () => {
    const rows = await run("agy", {
      ...repo,
      "/h/code/app/src/.agents/skills/ship/SKILL.md": skill("nearest"),
      "/h/code/app/.agent/skills/ship/SKILL.md": skill("repo"),
      "/h/.gemini/skills/ship/SKILL.md": skill("user"),
      "/h/.gemini/skills/hidden/SKILL.md": skill("hidden", "disable-slash-command: true\n"),
      "/h/.gemini/antigravity-cli/plugins/nanobanana/skills/restore/SKILL.md": skill("plugin"),
      "/h/.gemini/antigravity/skills/wrong/SKILL.md": skill(),
      "/h/.agents/skills/wrong/SKILL.md": skill(),
      "/h/code/app/_agents/skills/underscore/SKILL.md": skill(),
      "/h/code/app/_agent/skills/singular/SKILL.md": skill(),
    });
    expect(rows.map((row) => [row.command, row.description])).toEqual([
      ["/nanobanana:restore", "plugin"], ["/ship", "nearest"], ["/singular", "test"], ["/underscore", "test"],
    ]);
  });

  test("muse uses folder ids, user precedence and visibility, and reads no untrusted project", async () => {
    const rows = await run("muse", {
      "/h/.config/muse/skills/ship/SKILL.md": skill("muse", "name: ignored\n"),
      "/h/.agents/skills/ship/SKILL.md": skill("agents"),
      "/h/.agents/skills/shared/SKILL.md": skill("agents"),
      "/h/.claude/skills/shared/SKILL.md": skill("claude"),
      "/h/.codex/skills/shared/SKILL.md": skill("codex"),
      "/h/.codex/skills/.system/internal/SKILL.md": skill(),
      "/h/.config/muse/skills/off/SKILL.md": skill("off", "user-invocable: false\n"),
      "/h/.config/muse/skills/Bad/SKILL.md": skill(),
      "/h/.config/muse/skills/-bad/SKILL.md": skill(),
      [`/h/.config/muse/skills/${"a".repeat(81)}/SKILL.md`]: skill(),
      "/h/.config/muse/skills/ok.id_2-3/SKILL.md": skill(),
      "/h/code/app/src/.agents/skills/project/SKILL.md": skill(),
    });
    expect(rows.map((row) => [row.command, row.description])).toEqual([
      ["/ok.id_2-3", "test"], ["/shared", "agents"], ["/ship", "muse"],
    ]);
    expect((await run("muse", {
      "/xdg/muse/skills/custom/SKILL.md": skill(),
      "/codex/skills/other/SKILL.md": skill(),
    }, null, { XDG_CONFIG_HOME: native("/xdg"), CODEX_HOME: native("/codex") })).map((row) => row.command)).toEqual(["/custom", "/other"]);
  });

  test("opencode reads its home folders after the project ones, in the documented order", async () => {
    const tiers = [
      "/h/code/app/src/.claude/skills",
      "/h/code/app/src/.opencode/skill",
      "/h/.config/opencode/skill",
      "/h/.config/opencode/skills",
      "/h/.opencode/skill",
      "/h/.opencode/skills",
      "/h/.claude/skills",
      "/h/.agents/skills",
    ];
    for (const [i, tier] of tiers.entries()) {
      const files = Object.fromEntries(tiers.slice(i).map((root) => [`${root}/a/SKILL.md`, skill(root, "name: dup\n")]));
      expect((await run("opencode", files)).map((row) => row.description)).toEqual([tier]);
    }
    expect(await names("opencode", {
      "/h/.opencode/command/home.md": skill(),
      "/h/code/app/src/.opencode/commands/nested/deep/walk.md": skill(),
    })).toEqual(["/home", "/nested/deep/walk"]);
  });

  test("omp searches its tiers in the documented order", async () => {
    const tiers = [
      "/h/.omp/agent/skills",
      "/h/code/app/.omp/skills",
      "/h/.agents/skills",
      "/h/.agent/skills",
      "/h/code/app/.agents/skills",
      "/h/code/app/.agent/skills",
      "/h/code/app/.claude/skills",
      "/h/code/app/src/.codex/skills",
      "/h/code/app/src/.opencode/skills",
      "/h/code/app/src/.github/skills",
    ];
    for (const [i, tier] of tiers.entries()) {
      const files = Object.fromEntries(tiers.slice(i).map((root) => [`${root}/dup/SKILL.md`, skill(root)]));
      expect((await run("omp", { ...repo, ...files })).map((row) => row.description)).toEqual([tier]);
    }
  });

  test("grok searches its tiers in the documented order", async () => {
    const tiers = [
      "/h/code/app/src/.grok/skills",
      "/h/code/app/src/.agents/skills",
      "/h/code/app/.grok/skills",
      "/h/code/app/.agents/skills",
      "/g/skills",
      "/h/code/app/src/.claude/skills",
      "/h/.claude/skills",
      "/h/code/app/src/.cursor/skills",
      "/h/.cursor/skills",
    ];
    const trust = `[folders.${JSON.stringify(native("/h/code"))}]\ntrusted = true\n`;
    for (const [i, tier] of tiers.entries()) {
      const files = Object.fromEntries(tiers.slice(i).map((root) => [`${root}/dup/SKILL.md`, skill(root)]));
      const rows = await run("grok", { ...repo, ...files, "/g/trusted_folders.toml": trust }, "/h/code/app/src", { GROK_HOME: native("/g") });
      expect(rows.map((row) => row.description)).toEqual([tier]);
    }
  });

  test("muse reads project skills before user ones only in a trusted project, by exact real-path key", async () => {
    const files = {
      ...repo,
      "/h/code/app/src/.agents/skills/a/SKILL.md": skill("project agents"),
      "/h/code/app/.codex/skills/c/SKILL.md": skill("project codex"),
      "/h/code/app/.claude/skills/b/SKILL.md": skill("project claude"),
      "/h/.agents/skills/a/SKILL.md": skill("user"),
    };
    const trust = (path: string, decision = "trusted") => JSON.stringify({ schema_version: 1, projects: { [native(path)]: { decision } } });
    const userOnly = [["/a", "user"]];
    const all = [["/a", "project agents"], ["/b", "project claude"], ["/c", "project codex"]];
    const described = async (extra: FakeTree, env: Readonly<Record<string, string | undefined>> = {}) =>
      (await run("muse", { ...files, ...extra }, "/h/code/app/src", env)).map((row) => [row.command, row.description]);

    expect(await described({})).toEqual(userOnly);
    expect(await described({ "/h/.config/muse/trust.json": trust("/h/code/app") })).toEqual(all);
    expect(await described({ "/h/.config/muse/trust.json": trust("/h/code/app/src") })).toEqual(all);
    expect(await described({ "/xdg/muse/trust.json": trust("/h/code/app") }, { XDG_CONFIG_HOME: native("/xdg") })).toEqual(all);
    for (const trustFile of [trust("/h/code/app", "denied"), trust("/h/code"), "{broken", "[]", JSON.stringify({ projects: [] })]) {
      expect(await described({ "/h/.config/muse/trust.json": trustFile })).toEqual(userOnly);
    }
  });

  test("repository walk stops at the nearest git marker and uses cwd alone without a repository", async () => {
    const files = {
      "/h/code/app/src/.agents/skills/local/SKILL.md": skill(),
      "/h/code/app/.agents/skills/parent/SKILL.md": skill(),
      "/h/code/.agents/skills/above/SKILL.md": skill(),
    };
    expect(await names("codex", files)).toEqual(["$local"]);
    expect(await names("codex", { ...files, ...repo })).toEqual(["$local", "$parent"]);
    expect(await names("codex", { ...files, ...repo, "/h/code/app/src/.git": "gitdir: elsewhere" })).toEqual(["$local"]);
  });

  test("descriptions are clipped, malformed files skipped, and rows sorted with a thousand-row cap", async () => {
    const files = {
      "/h/.agents/skills/broken/SKILL.md": "---\ndescription: [broken\n---\n",
      "/h/.agents/skills/long/SKILL.md": skill(`'${"word ".repeat(80)}'`),
    };
    const long = await run("muse", files, null);
    expect(long[0]?.description.length).toBe(200);
    expect(long[0]?.description.endsWith("…")).toBe(true);
    const many = Object.fromEntries(
      Array.from({ length: 1002 }, (_, i) => [`/h/.agents/skills/s${String(1001 - i).padStart(4, "0")}/SKILL.md`, skill()]),
    );
    const rows = await run("muse", { ...files, ...many }, null);
    expect(rows).toHaveLength(1000);
    expect(rows.map((row) => row.command)).toEqual(rows.map((row) => row.command).toSorted());
  });

  test("codex bounds recursive folder visits to two thousand", async () => {
    const io = fakeIo({});
    let visits = 0;
    const bounded: DiscoveryIo = {
      read: io.read,
      async list(dir) {
        if (!dir.startsWith(native("/h/.codex/skills"))) return null;
        visits++;
        return Array.from({ length: 10 }, (_, i) => ({ name: `d${i}`, dir: true }));
      },
    };
    expect(await discoverAgentSkills("codex", { home: native("/h"), cwd: null, env: {} }, bounded)).toEqual([]);
    expect(visits).toBeLessThanOrEqual(2000);
    expect(visits).toBeGreaterThan(1000);
  });
});

describe("a trust store keyed by the real path", () => {
  // Grok and pi record a trusted folder by its real path (live: a cwd under macOS `/var/...` is keyed
  // `/private/var/...`), while the multiplexer reports the cwd as the shell spelled it.
  const base = mkdtempSync(join(tmpdir(), "collie-skills-"));
  const real = join(base, "real");
  mkdirSync(real);
  const link = join(base, "link");
  symlinkSync(real, link);
  const key = realpathSync(real);
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  const rowsAt = (agent: SkillAgent, files: FakeTree) =>
    discoverAgentSkills(agent, { home: native("/h"), cwd: link, env: {} }, fakeIo(files));

  test("grok loads a trusted project reached through a link", async () => {
    const rows = await rowsAt("grok", {
      "/h/.grok/trusted_folders.toml": `[folders.${JSON.stringify(key)}]\ntrusted = true\n`,
      [join(link, ".git", "HEAD")]: "ref",
      [join(link, ".grok", "skills", "probe", "SKILL.md")]: skill(),
    });
    expect(rows.map((row) => row.command)).toContain("/probe");
  });

  test("pi loads a trusted project reached through a link", async () => {
    const rows = await rowsAt("pi", {
      "/h/.pi/agent/trust.json": JSON.stringify({ [key]: true }),
      [join(link, ".git", "HEAD")]: "ref",
      [join(link, ".pi", "skills", "probe", "SKILL.md")]: skill(),
    });
    expect(rows.map((row) => row.command)).toContain("/skill:probe");
  });
});
