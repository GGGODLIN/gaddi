import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

import type { JsonObject, JsonValue } from "./json.ts";
import {
  asObject,
  asString,
  cleanDescription,
  discoveryDiskIo,
  MAX_COMMANDS,
  parseFrontmatter,
  parseJson,
  projectDirs,
  type ClaudeCommand,
  type DiscoveryIo,
  type Frontmatter,
} from "./claude-commands.ts";

// The skills and prompt commands seven agents other than Claude would load for a pane, read off this
// machine's disk (ADR 9011), the sibling of claude-commands.ts (ADR 9009) and held to the same habits:
// a best-effort mirror of each agent's loader, not a registry, so a row proves only that a file exists
// where that agent looks. Every path is built from the operator's home, the bridge's own environment
// and the pane's cwd as the multiplexer reported it, never from a request. Nothing is executed and
// nothing is written; a missing folder is a quiet empty list and a file that does not parse is skipped.
//
// Each rule below was read from the agent's source or documentation, or seen live in its `/` menu, on
// 2026-10-15. A rule marked `?` is our assumption: the wrong reading costs a missing row or an extra
// one, never a send, because the phone only stages the text.

const SKILL_AGENTS = ["codex", "opencode", "pi", "omp", "grok", "agy", "muse"] as const;
export type SkillAgent = (typeof SKILL_AGENTS)[number];

const KNOWN_AGENTS: ReadonlySet<string> = new Set(SKILL_AGENTS);

export function isSkillAgent(agent: string): agent is SkillAgent {
  return KNOWN_AGENTS.has(agent);
}

export interface SkillDiscovery {
  home: string;
  /** The pane's cwd as the multiplexer reported it; null reads only what is not per-project. */
  cwd: string | null;
  env: Readonly<Record<string, string | undefined>>;
}

const SKILL_FILE = "SKILL.md";
/** Folders below a skill root a recursive agent descends; Codex's own limit, reused for opencode and pi. */
const MAX_SCAN_DEPTH = 6;
/** Folders one root may make the scan list; a runaway tree must not stall the bridge. */
const MAX_SCAN_FOLDERS = 2000;
/** Pi shows a prompt template's first body line cut here when the file has no description. */
const MAX_PROMPT_LINE = 60;
/** How many folders the walk up from the cwd looks for a trust entry. */
const MAX_TRUST_WALK = 64;

/** What can be typed after the slash: no whitespace and no control character, which also keep a name from breaking the row. */
const TYPEABLE = /^[^\s\p{Cc}\p{Cf}]+$/u;
/** A Codex mention is `$name`, and only these characters can be typed in one. */
const CODEX_NAME = /^[A-Za-z0-9_:-]+$/;
/** Muse's skill id, taken from the folder name. */
const MUSE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;

interface Found {
  /** The SKILL.md, or the loose markdown file itself. */
  path: string;
  /** The skill's folder name, or the loose file's stem. */
  name: string;
  /** Null when the file opens with a block that does not parse. */
  front: Frontmatter | null;
}

interface Parsed extends Found {
  front: Frontmatter;
}

interface ScanRules {
  /** 1 reads `<root>/<name>/SKILL.md` only; larger values descend that many folders. */
  depth: number;
  /** Skip `.`-prefixed entries, which keeps Codex's `.system` built-ins out. */
  skipHidden: boolean;
  /** A folder holding a SKILL.md is a skill root and is not descended further. */
  stopAtSkill: boolean;
  skip: ReadonlySet<string>;
  /** Top-level `*.md` files are skills too (Pi's own roots only). */
  loose: boolean;
}

const NO_SKIP: ReadonlySet<string> = new Set();
const ONE_LEVEL: ScanRules = { depth: 1, skipHidden: false, stopAtSkill: false, skip: NO_SKIP, loose: false };
const DEEP: ScanRules = { ...ONE_LEVEL, depth: MAX_SCAN_DEPTH };

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

function envDir(env: SkillDiscovery["env"], key: string): string | undefined {
  const value = env[key];
  return value === undefined || value === "" ? undefined : value;
}

function parseToml(text: string): JsonObject | null {
  try {
    // SAFETY: `Bun.TOML.parse` answers with a plain object of TOML values; the readers below narrow it
    // through asObject/asString/Array.isArray before believing a field, and never inspect a date.
    return asObject(Bun.TOML.parse(text) as JsonValue);
  } catch {
    return null;
  }
}

function parseJsonObject(text: string): JsonObject | null {
  try {
    return asObject(parseJson(text));
  } catch {
    return null;
  }
}

function stringList(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.flatMap((entry) => asString(entry) ?? []) : [];
}

function nameOf(found: Parsed): string {
  const named = found.front.name?.trim();
  return named === undefined || named === "" ? found.name : named;
}

function hasDescription(front: Frontmatter): boolean {
  return cleanDescription(front.description) !== "";
}

function rowOf(command: string, front: Frontmatter, description?: string): ClaudeCommand {
  return {
    command,
    description: description ?? cleanDescription(front.description),
    argHint: cleanDescription(front.argumentHint),
  };
}

const parsed = (all: Found[]): Parsed[] => all.filter((found): found is Parsed => found.front !== null);

async function readSkillFile(io: DiscoveryIo, folder: string): Promise<Found | null> {
  const path = join(folder, SKILL_FILE);
  const text = await io.read(path);
  return text === null ? null : { path, name: basename(folder), front: parseFrontmatter(text) };
}

/** The skills under `root`, entries in name order so a clash between two folders resolves the same way every time. */
async function scan(io: DiscoveryIo, root: string, rules: ScanRules): Promise<Found[]> {
  const out: Found[] = [];
  let budget = MAX_SCAN_FOLDERS;
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (budget <= 0) return;
    budget--;
    const entries = await io.list(dir);
    if (entries === null) return;
    for (const entry of entries.toSorted(byName)) {
      if ((rules.skipHidden && entry.name.startsWith(".")) || rules.skip.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (!entry.dir) {
        if (depth === 0 && rules.loose && entry.name.endsWith(".md") && entry.name !== SKILL_FILE) {
          const text = await io.read(path);
          if (text !== null) out.push({ path, name: entry.name.slice(0, -3), front: parseFrontmatter(text) });
        }
        continue;
      }
      const skill = await readSkillFile(io, path);
      if (skill !== null) out.push(skill);
      if (skill !== null && rules.stopAtSkill) continue;
      if (depth + 1 < rules.depth) await visit(path, depth + 1);
    }
  };
  await visit(root, 0);
  return out;
}

interface MarkdownFile {
  /** The path below the root without `.md`, one entry per folder. */
  rel: string[];
  text: string;
  front: Frontmatter;
}

/** `*.md` files under `root`, `depth` 1 meaning direct children only. */
async function markdownIn(io: DiscoveryIo, root: string, depth: number): Promise<MarkdownFile[]> {
  const out: MarkdownFile[] = [];
  let budget = MAX_SCAN_FOLDERS;
  const visit = async (dir: string, rel: string[]): Promise<void> => {
    if (budget <= 0) return;
    budget--;
    const entries = await io.list(dir);
    if (entries === null) return;
    for (const entry of entries.toSorted(byName)) {
      const path = join(dir, entry.name);
      if (entry.dir) {
        if (rel.length + 1 < depth) await visit(path, [...rel, entry.name]);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      const text = await io.read(path);
      const front = text === null ? null : parseFrontmatter(text);
      if (text !== null && front !== null) out.push({ rel: [...rel, entry.name.slice(0, -3)], text, front });
    }
  };
  await visit(root, []);
  return out;
}

function bodyOf(text: string): string {
  const body = text.replace(/^﻿/, "");
  if (!/^---\r?\n/.test(body)) return body;
  const end = /\r?\n---[ \t]*(\r?\n|$)/.exec(body);
  return end === null ? body : body.slice(end.index + end[0].length);
}

/** An absolute path, or a `~/` one spelled from `home`; anything else a settings file might hold is not ours to resolve. */
function absoluteFrom(raw: string, home: string): string | null {
  if (raw.startsWith("~/")) return resolve(home, raw.slice(2));
  return isAbsolute(raw) ? resolve(raw) : null;
}

function atOrUnder(path: string, ancestor: string): boolean {
  const here = resolve(path);
  return here === ancestor || here.startsWith(ancestor.endsWith(sep) ? ancestor : `${ancestor}${sep}`);
}

/** `decisions` keyed by path: the nearest folder at or above `cwd` with an entry decides. */
function nearestDecision(cwd: string, decisions: ReadonlyMap<string, boolean>): boolean {
  let dir = resolve(cwd);
  for (let i = 0; i < MAX_TRUST_WALK; i++) {
    const decision = decisions.get(dir);
    if (decision !== undefined) return decision;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return false;
}

function decisionsFrom(entries: ReadonlyArray<[string, JsonValue | undefined]>): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const [path, decision] of entries) {
    if ((decision === true || decision === false) && isAbsolute(path)) out.set(resolve(path), decision);
  }
  return out;
}

// ── codex ──────────────────────────────────────────────────────────────────────────────────────

interface CodexDisabled {
  names: Set<string>;
  /** Resolved paths of a SKILL.md or of its folder. */
  paths: Set<string>;
}

/** `[[skills.config]]` entries with `enabled = false`; a config that does not parse disables nothing. */
async function codexDisabled(io: DiscoveryIo, path: string): Promise<CodexDisabled> {
  const out: CodexDisabled = { names: new Set(), paths: new Set() };
  const text = await io.read(path);
  const config = text === null ? null : parseToml(text);
  const entries = asObject(config?.skills)?.config;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const fields = asObject(entry);
    if (fields === null || fields.enabled !== false) continue;
    const name = asString(fields.name);
    const where = asString(fields.path);
    if (name !== undefined) out.names.add(name);
    if (where !== undefined && isAbsolute(where)) out.paths.add(resolve(where));
  }
  return out;
}

async function codexRows(where: SkillDiscovery, io: DiscoveryIo, dirs: string[]): Promise<ClaudeCommand[]> {
  const codexHome = envDir(where.env, "CODEX_HOME") ?? join(where.home, ".codex");
  const disabled = await codexDisabled(io, join(codexHome, "config.toml"));
  // The built-in `.system` skills are shipped as static rows by the phone; scanning them would list them twice.
  const rules: ScanRules = { ...DEEP, skipHidden: true };
  const roots = [
    ...dirs.map((dir) => join(dir, ".agents", "skills")),
    join(codexHome, "skills"),
    join(where.home, ".agents", "skills"),
  ];
  const rows: ClaudeCommand[] = [];
  for (const root of roots) {
    for (const found of parsed(await scan(io, root, rules))) {
      const name = nameOf(found);
      if (!hasDescription(found.front) || !CODEX_NAME.test(name)) continue;
      if (disabled.names.has(name) || disabled.paths.has(resolve(found.path)) || disabled.paths.has(resolve(dirname(found.path)))) continue;
      rows.push(rowOf(`$${name}`, found.front));
    }
  }
  return rows;
}

// ── opencode ───────────────────────────────────────────────────────────────────────────────────

const skillAndSkills = (base: string) => [join(base, "skill"), join(base, "skills")];

async function opencodeRows(where: SkillDiscovery, io: DiscoveryIo, dirs: string[]): Promise<ClaudeCommand[]> {
  const config = join(envDir(where.env, "XDG_CONFIG_HOME") ?? join(where.home, ".config"), "opencode");
  const roots = [
    ...dirs.flatMap((dir) => [join(dir, ".claude", "skills"), join(dir, ".agents", "skills")]),
    ...dirs.flatMap((dir) => skillAndSkills(join(dir, ".opencode"))),
    ...skillAndSkills(config),
    ...skillAndSkills(join(where.home, ".opencode")),
    join(where.home, ".claude", "skills"),
    join(where.home, ".agents", "skills"),
  ];
  const rows: ClaudeCommand[] = [];
  for (const root of roots) {
    for (const found of parsed(await scan(io, root, DEEP))) {
      // No folder fallback: opencode skips a SKILL.md that names nothing.
      const name = found.front.name?.trim() ?? "";
      if (TYPEABLE.test(name)) rows.push(rowOf(`/${name}`, found.front));
    }
  }
  // Listed order is the priority: the user's own folder before a project's `.opencode`. ? Opencode itself
  // may merge a project's commands over the user's; the cost of that reading being wrong is one description.
  const commandBases = [config, ...dirs.map((dir) => join(dir, ".opencode")), join(where.home, ".opencode")];
  for (const base of commandBases) {
    for (const root of [join(base, "command"), join(base, "commands")]) {
      for (const file of await markdownIn(io, root, MAX_SCAN_DEPTH)) {
        const name = file.rel.join("/");
        if (TYPEABLE.test(name)) rows.push(rowOf(`/${name}`, file.front));
      }
    }
  }
  return rows;
}

// ── pi ─────────────────────────────────────────────────────────────────────────────────────────

/** Entries of `settings.json` `skills` that start with `-`: paths a skill may not sit at or under. */
async function piExcluded(io: DiscoveryIo, path: string, home: string): Promise<string[]> {
  const text = await io.read(path);
  const settings = text === null ? null : parseJsonObject(text);
  const out: string[] = [];
  for (const entry of stringList(settings?.skills)) {
    const target = entry.startsWith("-") ? absoluteFrom(entry.slice(1), home) : null;
    if (target !== null) out.push(target);
  }
  return out;
}

async function piTrusted(io: DiscoveryIo, agentDir: string, cwd: string): Promise<boolean> {
  const text = await io.read(join(agentDir, "trust.json"));
  const trust = text === null ? null : parseJsonObject(text);
  if (trust === null) return false;
  const decisions = decisionsFrom(Object.entries(trust));
  // pi keys a folder by its real path (`canonicalizePath`), so a cwd reached through a link is looked up
  // by both spellings.
  return nearestDecision(cwd, decisions) || nearestDecision(await realPath(cwd), decisions);
}

async function piRows(where: SkillDiscovery, io: DiscoveryIo, dirs: string[]): Promise<ClaudeCommand[]> {
  const agentDir = envDir(where.env, "PI_CODING_AGENT_DIR") ?? join(where.home, ".pi", "agent");
  const here = dirs[0];
  const trusted = here !== undefined && where.cwd !== null && (await piTrusted(io, agentDir, where.cwd));
  const rules: ScanRules = { ...DEEP, skipHidden: true, stopAtSkill: true, skip: new Set(["node_modules"]) };
  const loose: ScanRules = { ...rules, loose: true };
  const roots: Array<[string, ScanRules]> = [
    ...(trusted ? [[join(here, ".pi", "skills"), loose] satisfies [string, ScanRules]] : []),
    ...(trusted ? dirs.map((dir): [string, ScanRules] => [join(dir, ".agents", "skills"), rules]) : []),
    [join(agentDir, "skills"), loose],
    [join(where.home, ".agents", "skills"), rules],
  ];
  const excluded = await piExcluded(io, join(agentDir, "settings.json"), where.home);
  const rows: ClaudeCommand[] = [];
  for (const [root, scanRules] of roots) {
    for (const found of parsed(await scan(io, root, scanRules))) {
      const name = nameOf(found);
      if (!hasDescription(found.front) || !TYPEABLE.test(name)) continue;
      if (excluded.some((ancestor) => atOrUnder(found.path, ancestor))) continue;
      rows.push(rowOf(`/skill:${name}`, found.front));
    }
  }
  for (const file of await markdownIn(io, join(agentDir, "prompts"), 1)) {
    const name = file.rel.join("/");
    if (!TYPEABLE.test(name)) continue;
    const firstLine = bodyOf(file.text).split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
    const fallback = cleanDescription(firstLine).slice(0, MAX_PROMPT_LINE);
    rows.push(rowOf(`/${name}`, file.front, hasDescription(file.front) ? undefined : fallback));
  }
  return rows;
}

// ── omp ────────────────────────────────────────────────────────────────────────────────────────

async function ompRows(where: SkillDiscovery, io: DiscoveryIo, dirs: string[]): Promise<ClaudeCommand[]> {
  const here = dirs[0];
  const { home } = where;
  // The walk never includes home, so `.omp/skills` there is read once, as the user's own. Foreign user
  // folders (`~/.claude/skills`, `~/.codex/skills`, `~/.config/opencode/skills`) are off by default in omp.
  const tiers: Array<[string, boolean]> = [
    [join(home, ".omp", "agent", "skills"), false],
    ...dirs.map((dir): [string, boolean] => [join(dir, ".omp", "skills"), false]),
    [join(home, ".agents", "skills"), false],
    [join(home, ".agent", "skills"), false],
    ...dirs.flatMap((dir): Array<[string, boolean]> => [[join(dir, ".agents", "skills"), false], [join(dir, ".agent", "skills"), false]]),
    ...dirs.map((dir): [string, boolean] => [join(dir, ".claude", "skills"), false]),
    ...(here === undefined
      ? []
      : ([
          [join(here, ".codex", "skills"), false],
          [join(here, ".opencode", "skills"), false],
          [join(here, ".github", "skills"), true],
        ] satisfies Array<[string, boolean]>)),
  ];
  const rows: ClaudeCommand[] = [];
  for (const [root, needsDescription] of tiers) {
    for (const found of parsed(await scan(io, root, ONE_LEVEL))) {
      const name = nameOf(found);
      if (found.front.enabled === false || name.includes("/") || name.includes("\\") || !TYPEABLE.test(name)) continue;
      if (needsDescription && !hasDescription(found.front)) continue;
      rows.push(rowOf(`/skill:${name}`, found.front));
    }
  }
  return rows;
}

// ── grok ───────────────────────────────────────────────────────────────────────────────────────

/** Grok's names are lowercase with `-` for spaces and underscores. */
const grokName = (raw: string) => raw.toLowerCase().replace(/[\s_]/g, "-");

async function grokTrusted(io: DiscoveryIo, grokHome: string, cwd: string): Promise<boolean> {
  const text = await io.read(join(grokHome, "trusted_folders.toml"));
  const doc = text === null ? null : parseToml(text);
  const folders = asObject(doc?.folders);
  if (folders === null) return false;
  // ? Whether a nearer `trusted = false` overrides a farther `true` is our reading of "the nearest
  // ancestor decides"; it fails closed, so the wrong reading hides project rows, never exposes them.
  const entries = Object.entries(folders).map((entry): [string, JsonValue | undefined] => [entry[0], asObject(entry[1])?.trusted]);
  const decisions = decisionsFrom(entries);
  // Grok keys a folder by its real path (live: `/private/var/...` for a cwd under `/var/...`), so the
  // cwd is looked up by both spellings.
  return nearestDecision(cwd, decisions) || nearestDecision(await realPath(cwd), decisions);
}

interface GrokPlace {
  /** The `.grok` / `.agents` / `.claude` / `.cursor` folder. */
  base: string;
  /** `.cursor` has a skills folder but no commands one. */
  commands: boolean;
  /** Project places load only in a trusted folder. */
  project: boolean;
}

const project = (base: string, commands: boolean): GrokPlace => ({ base, commands, project: true });
const user = (base: string, commands: boolean): GrokPlace => ({ base, commands, project: false });

async function grokRows(where: SkillDiscovery, io: DiscoveryIo, dirs: string[]): Promise<ClaudeCommand[]> {
  const { home } = where;
  const grokHome = envDir(where.env, "GROK_HOME") ?? join(home, ".grok");
  const here = dirs[0];
  const trusted = here !== undefined && where.cwd !== null && (await grokTrusted(io, grokHome, where.cwd));
  const places: GrokPlace[] = [
    ...(here === undefined ? [] : [project(join(here, ".grok"), true), project(join(here, ".agents"), true)]),
    ...dirs.slice(1).flatMap((dir) => [project(join(dir, ".grok"), true), project(join(dir, ".agents"), true)]),
    user(grokHome, true),
    ...(here === undefined ? [] : [project(join(here, ".claude"), true)]),
    user(join(home, ".claude"), true),
    ...(here === undefined ? [] : [project(join(here, ".cursor"), false)]),
    user(join(home, ".cursor"), false),
  ];

  const configText = await io.read(join(grokHome, "config.toml"));
  const config = asObject((configText === null ? null : parseToml(configText))?.skills);
  const disabled = new Set(stringList(config?.disabled).map(grokName));
  const ignored = stringList(config?.ignore).flatMap((entry) => absoluteFrom(entry, home) ?? []);

  const rows: ClaudeCommand[] = [];
  for (const place of places) {
    if (place.project && !trusted) continue;
    for (const found of parsed(await scan(io, join(place.base, "skills"), ONE_LEVEL))) {
      const name = grokName(nameOf(found));
      if (found.front.userInvocable === false || disabled.has(name) || !TYPEABLE.test(name)) continue;
      if (ignored.some((ancestor) => atOrUnder(found.path, ancestor))) continue;
      rows.push(rowOf(`/${name}`, found.front));
    }
    if (!place.commands) continue;
    for (const file of await markdownIn(io, join(place.base, "commands"), 1)) {
      const name = grokName(file.rel.join("/"));
      if (file.front.userInvocable !== false && TYPEABLE.test(name)) rows.push(rowOf(`/${name}`, file.front));
    }
  }
  return rows;
}

// ── agy ────────────────────────────────────────────────────────────────────────────────────────

async function agyRows(where: SkillDiscovery, io: DiscoveryIo, dirs: string[]): Promise<ClaudeCommand[]> {
  const gemini = join(where.home, ".gemini");
  // `~/.gemini/antigravity/skills` and `~/.agents/skills` are deliberately absent: checked live in agy
  // 1.3.5, neither shows in its `/` menu, so reading them would list skills the agent cannot run.
  const tiers: Array<[string, string]> = [
    ...dirs.flatMap((dir) => [".agents", ".agent", "_agents", "_agent"].map((name): [string, string] => [join(dir, name, "skills"), ""])),
    [join(gemini, "skills"), ""],
  ];
  const plugins = join(gemini, "antigravity-cli", "plugins");
  for (const plugin of ((await io.list(plugins)) ?? []).toSorted(byName)) {
    if (plugin.dir) tiers.push([join(plugins, plugin.name, "skills"), `${plugin.name}:`]);
  }
  const rows: ClaudeCommand[] = [];
  for (const [root, prefix] of tiers) {
    for (const found of parsed(await scan(io, root, ONE_LEVEL))) {
      const name = nameOf(found);
      if (found.front.disableSlashCommand === true || !TYPEABLE.test(name)) continue;
      rows.push(rowOf(`/${prefix}${name}`, found.front));
    }
  }
  return rows;
}

// ── muse ───────────────────────────────────────────────────────────────────────────────────────

async function realPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/**
 * Muse's trust store records the REAL path (seen live: a cwd under macOS `/var/...` is keyed
 * `/private/var/...`), so the cwd and the repository root are compared by both spellings.
 * ? Only an exact key counts, with no ancestor walk; that reading comes from one live check, and the
 * wrong one costs a project's rows, which fail closed.
 */
async function museTrusted(io: DiscoveryIo, trustFile: string, dirs: string[]): Promise<boolean> {
  const here = dirs[0];
  const root = dirs.at(-1);
  if (here === undefined || root === undefined) return false;
  const text = await io.read(trustFile);
  const projects = asObject((text === null ? null : parseJsonObject(text))?.projects);
  if (projects === null) return false;
  const keys = new Set([here, root, await realPath(here), await realPath(root)]);
  return Object.entries(projects).some(([key, entry]) => keys.has(key) && asObject(entry)?.decision === "trusted");
}

async function museRows(where: SkillDiscovery, io: DiscoveryIo, dirs: string[]): Promise<ClaudeCommand[]> {
  const { home } = where;
  const config = envDir(where.env, "XDG_CONFIG_HOME") ?? join(home, ".config");
  const codexHome = envDir(where.env, "CODEX_HOME") ?? join(home, ".codex");
  const trusted = await museTrusted(io, join(config, "muse", "trust.json"), dirs);
  // ? Whether Muse walks up to the repository root or reads only the root is not known; walking covers both.
  const projectRoots = trusted ? dirs.flatMap((dir) => [".agents", ".codex", ".claude"].map((name) => join(dir, name, "skills"))) : [];
  const roots = [
    ...projectRoots,
    join(config, "muse", "skills"),
    join(home, ".agents", "skills"),
    join(home, ".claude", "skills"),
    join(codexHome, "skills"),
  ];
  const rules: ScanRules = { ...ONE_LEVEL, skipHidden: true };
  const rows: ClaudeCommand[] = [];
  for (const root of roots) {
    for (const found of parsed(await scan(io, root, rules))) {
      // The id is the folder name; a frontmatter `name` does not rename it.
      if (found.front.userInvocable === false || !MUSE_ID.test(found.name)) continue;
      rows.push(rowOf(`/${found.name}`, found.front));
    }
  }
  return rows;
}

/**
 * Every skill and prompt command `agent` would offer in `where.cwd`, one row per command, sorted. When
 * two places define a name the first in the agent's own search order wins, and a skill an agent hides
 * does not shadow one below it.
 */
export async function discoverAgentSkills(
  agent: SkillAgent,
  where: SkillDiscovery,
  io: DiscoveryIo = discoveryDiskIo,
): Promise<ClaudeCommand[]> {
  const dirs = where.cwd === null ? [] : await projectDirs(io, where.cwd, where.home);
  const rows = await rowsFor(agent, where, io, dirs);
  const byCommand = new Map<string, ClaudeCommand>();
  for (const row of rows) {
    if (!byCommand.has(row.command)) byCommand.set(row.command, row);
  }
  return [...byCommand.values()].slice(0, MAX_COMMANDS).toSorted((a, b) => (a.command < b.command ? -1 : a.command > b.command ? 1 : 0));
}

function rowsFor(agent: SkillAgent, where: SkillDiscovery, io: DiscoveryIo, dirs: string[]): Promise<ClaudeCommand[]> {
  switch (agent) {
    case "codex":
      return codexRows(where, io, dirs);
    case "opencode":
      return opencodeRows(where, io, dirs);
    case "pi":
      return piRows(where, io, dirs);
    case "omp":
      return ompRows(where, io, dirs);
    case "grok":
      return grokRows(where, io, dirs);
    case "agy":
      return agyRows(where, io, dirs);
    case "muse":
      return museRows(where, io, dirs);
  }
}
