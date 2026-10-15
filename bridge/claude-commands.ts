import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";

import type { JsonObject, JsonValue } from "./json.ts";

// The slash commands Claude Code would load for a pane, read off this machine's disk (ADR 9009).
//
// A best-effort mirror of Claude Code's own loader, not a registry: the terminal's `/` menu stays the
// authority, and a row here proves only that a file exists where Claude Code looks. Every path is
// built from the operator's home, the bridge's own environment and the pane's cwd as the multiplexer
// reported it, never from a request, so the journal's containment rule has nothing to contain.
//
// Read: personal skills and commands, skills synced from claude.ai, project skills and commands from
// the pane's cwd up to its repository root, and the skills and commands of enabled plugins. Not
// read, on purpose: the managed (enterprise) directory, nested skills below the cwd, and `--add-dir`
// directories, which a pane's snapshot cannot see.

export interface ClaudeCommand {
  /** Includes the leading slash, e.g. `/to-spec` or `/codex:rescue`. */
  command: string;
  description: string;
  /** The frontmatter `argument-hint`, or empty when the file declares none. */
  argHint: string;
}

/** Kept behind an interface so discovery is testable without a disk. */
export interface DiscoveryIo {
  /** The entries of `dir`, symlinks followed; null when the folder is absent or unreadable. */
  list(dir: string): Promise<Array<{ name: string; dir: boolean }> | null>;
  /** The file's text, or null when it is absent or unreadable. */
  read(path: string): Promise<string | null>;
}

export const discoveryDiskIo: DiscoveryIo = {
  async list(dir) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return null;
    }
    const out: Array<{ name: string; dir: boolean }> = [];
    for (const name of names) {
      try {
        const info = await stat(join(dir, name));
        if (info.isDirectory() || info.isFile()) out.push({ name, dir: info.isDirectory() });
      } catch {
        // A dangling symlink is not a skill; Claude Code skips it too.
      }
    }
    return out;
  },
  async read(path) {
    try {
      const file = Bun.file(path);
      if (file.size > MAX_FILE_BYTES) return (await file.slice(0, MAX_FILE_BYTES).text());
      return await file.text();
    } catch {
      return null;
    }
  },
};

/** Frontmatter sits at the top; a file this large is read only this far. */
const MAX_FILE_BYTES = 64 * 1024;
/** A machine with more than this is not one a phone list can serve anyway. */
export const MAX_COMMANDS = 1000;
/** How many folders the walk from the cwd to the repository root may climb. */
const MAX_WALK = 32;
const MAX_DESCRIPTION = 200;
/** What Claude Code accepts as a command name, after the slash: letters, digits and `._:-`. */
const NAME = /^[\p{L}\p{N}._:-]+$/u;

export interface Frontmatter {
  name?: string;
  description?: string;
  argumentHint?: string;
  userInvocable?: boolean;
  /** omp's `enabled: false`; Claude Code ignores it. */
  enabled?: boolean;
  /** Antigravity's `disable-slash-command: true`; Claude Code ignores it. */
  disableSlashCommand?: boolean;
}

export function asObject(value: JsonValue | undefined): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

export function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** `skillOverrides` from a settings file: skill name → `on` / `name-only` / `user-invocable-only` / `off`. */
interface OverrideStates {
  [skill: string]: string;
}
/** `enabledPlugins` from a settings file: `<plugin>@<marketplace>` → on or off. */
interface PluginSwitches {
  [plugin: string]: boolean;
}

/** Only the entries of `value` whose value is a string; for `skillOverrides`. */
function stringEntries(value: JsonValue | undefined): OverrideStates {
  const out: OverrideStates = {};
  for (const [key, entry] of Object.entries(asObject(value) ?? {})) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

/** Only the entries of `value` whose value is a boolean; for `enabledPlugins`. */
function booleanEntries(value: JsonValue | undefined): PluginSwitches {
  const out: PluginSwitches = {};
  for (const [key, entry] of Object.entries(asObject(value) ?? {})) {
    if (typeof entry === "boolean") out[key] = entry;
  }
  return out;
}

export function parseJson(text: string): JsonValue {
  // SAFETY: `JSON.parse` answers with a JSON value by definition, and every reader below narrows it
  // through asObject/asString/stringEntries/booleanEntries before believing a field.
  return JSON.parse(text) as JsonValue;
}

/**
 * The YAML block at the top of a skill or command file. Null when the file opens with a block that
 * does not parse, which the caller reports; an empty object when there is no block at all, which is
 * an ordinary command file.
 */
export function parseFrontmatter(text: string): Frontmatter | null {
  const body = text.replace(/^\uFEFF/, "");
  if (!/^---\r?\n/.test(body)) return {};
  const end = body.search(/\r?\n---[ \t]*(\r?\n|$)/);
  if (end < 0) return null;
  let doc: JsonValue;
  try {
    // SAFETY: `Bun.YAML.parse` answers with a plain YAML value (scalars, arrays, objects), and the
    // lines below read it only through asObject/asString and one boolean check.
    doc = Bun.YAML.parse(body.slice(body.indexOf("\n") + 1, end)) as JsonValue;
  } catch {
    return null;
  }
  if (doc === null) return {};
  const fields = asObject(doc);
  if (fields === null) return null;
  const invocable = fields["user-invocable"];
  const enabled = fields.enabled;
  const disabled = fields["disable-slash-command"];
  return {
    name: asString(fields.name),
    description: asString(fields.description),
    argumentHint: asString(fields["argument-hint"]),
    userInvocable: invocable === true || invocable === false ? invocable : undefined,
    enabled: enabled === true || enabled === false ? enabled : undefined,
    disableSlashCommand: disabled === true || disabled === false ? disabled : undefined,
  };
}

export function cleanDescription(raw: string | undefined): string {
  // Control characters out: the text reaches a phone screen, and Claude Code strips them as well.
  const flat = (raw ?? "").replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/g, " ").trim();
  return flat.length > MAX_DESCRIPTION ? `${flat.slice(0, MAX_DESCRIPTION - 1)}…` : flat;
}

interface Settings {
  skillOverrides: OverrideStates;
  enabledPlugins: PluginSwitches;
}

async function readSettings(io: DiscoveryIo, path: string, warn: (m: string) => void): Promise<Settings> {
  const none = { skillOverrides: {}, enabledPlugins: {} };
  const text = await io.read(path);
  if (text === null) return none;
  let doc: JsonValue;
  try {
    doc = parseJson(text);
  } catch (err) {
    warn(`${path} could not be parsed (${String(err)}); its skill settings are ignored`);
    return none;
  }
  const fields = asObject(doc) ?? {};
  return {
    skillOverrides: stringEntries(fields.skillOverrides),
    enabledPlugins: booleanEntries(fields.enabledPlugins),
  };
}

/**
 * The folders from `cwd` up to the repository root, nearest first. With no repository above it the
 * cwd alone counts, which is where Claude Code started. The walk never climbs past `home`: a
 * `.claude` there is the personal folder, read once as such.
 */
export async function projectDirs(io: DiscoveryIo, cwd: string, home: string): Promise<string[]> {
  const dirs: string[] = [];
  let dir = cwd;
  for (let i = 0; i < MAX_WALK; i++) {
    if (dir === home) break;
    dirs.push(dir);
    const entries = await io.list(dir);
    if (entries?.some((e) => e.name === ".git")) return dirs;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return dirs.slice(0, 1);
}

interface Found extends ClaudeCommand {
  /** The bare name `skillOverrides` is keyed by; null for a plugin row, which it does not govern. */
  overrideKey: string | null;
}

/** `<root>/<name>/SKILL.md` for every folder under `root`, plus a root `SKILL.md` when asked. */
async function skillsIn(
  io: DiscoveryIo,
  root: string,
  prefix: string,
  warn: (m: string) => void,
  skip: ReadonlySet<string> = new Set(),
): Promise<Found[]> {
  const entries = await io.list(root);
  if (entries === null) return [];
  const out: Found[] = [];
  for (const entry of entries.filter((e) => e.dir && !skip.has(e.name.toLowerCase()))) {
    const path = join(root, entry.name, "SKILL.md");
    const text = await io.read(path);
    // A folder without SKILL.md is not a skill (a test fixture, a notes folder); Claude Code skips it.
    if (text === null) continue;
    const front = parseFrontmatter(text);
    if (front === null) {
      warn(`${path}: the frontmatter does not parse, so the skill is left out`);
      continue;
    }
    if (front.userInvocable === false) continue;
    const name = front.name?.trim() || entry.name;
    if (!NAME.test(name)) continue;
    out.push({
      command: `/${prefix}${name}`,
      description: cleanDescription(front.description),
      argHint: cleanDescription(front.argumentHint),
      overrideKey: prefix === "" ? name : null,
    });
  }
  return out;
}

/** `.md` files under `root`, a subfolder becoming a `:`-joined namespace. */
async function commandsIn(
  io: DiscoveryIo,
  root: string,
  prefix: string,
  warn: (m: string) => void,
  depth = 0,
): Promise<Found[]> {
  if (depth > 4) return [];
  const entries = await io.list(root);
  if (entries === null) return [];
  const out: Found[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.dir) {
      out.push(...(await commandsIn(io, path, `${prefix}${entry.name}:`, warn, depth + 1)));
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    const name = entry.name.slice(0, -3);
    if (!NAME.test(name)) continue;
    const text = await io.read(path);
    if (text === null) continue;
    const front = parseFrontmatter(text);
    if (front === null) {
      warn(`${path}: the frontmatter does not parse, so the command is left out`);
      continue;
    }
    if (front.userInvocable === false) continue;
    out.push({
      command: `/${prefix}${name}`,
      description: cleanDescription(front.description),
      argHint: cleanDescription(front.argumentHint),
      overrideKey: prefix === "" ? name : null,
    });
  }
  return out;
}

/** Enabled plugins and where each is installed for this cwd: a user install, or a project one above it. */
async function enabledPlugins(
  io: DiscoveryIo,
  configDir: string,
  enabled: PluginSwitches,
  cwd: string,
  warn: (m: string) => void,
): Promise<Array<{ name: string; path: string }>> {
  const record = join(configDir, "plugins", "installed_plugins.json");
  const text = await io.read(record);
  if (text === null) return [];
  let doc: JsonValue;
  try {
    doc = parseJson(text);
  } catch (err) {
    warn(`${record} could not be parsed (${String(err)}); plugin commands are left out`);
    return [];
  }
  const plugins = asObject(asObject(doc)?.plugins);
  if (plugins === null) return [];
  const covers = (entry: JsonObject) => {
    if (entry.scope === "user") return true;
    const project = asString(entry.projectPath);
    if (project === undefined) return false;
    return cwd === project || cwd.startsWith(project.endsWith(sep) ? project : `${project}${sep}`);
  };
  const out: Array<{ name: string; path: string }> = [];
  for (const [key, entries] of Object.entries(plugins)) {
    if (enabled[key] !== true || !Array.isArray(entries)) continue;
    for (const entry of entries) {
      const fields = asObject(entry);
      const path = asString(fields?.installPath);
      if (fields === null || path === undefined || !covers(fields)) continue;
      out.push({ name: key.split("@")[0]!, path });
      break;
    }
  }
  return out;
}

/**
 * The Claude config dir to read: the parent of the first Claude journal root when that root is a
 * `projects` folder, which is how an operator running a `CLAUDE_CONFIG_DIR` profile already points
 * Collie at it (`COLLIE_TRANSCRIPT_ROOT`); `<home>/.claude` otherwise.
 */
export function claudeConfigDir(journalRoots: readonly string[], home: string): string {
  const first = journalRoots[0];
  return first !== undefined && basename(first) === "projects" ? dirname(first) : join(home, ".claude");
}

export interface DiscoverOptions {
  home: string;
  /** The pane's cwd as the multiplexer reported it; null reads only what is not per-project. */
  cwd: string | null;
  /** See {@link claudeConfigDir}. */
  configDir: string;
  io?: DiscoveryIo;
  warn?: (message: string) => void;
}

/**
 * Every command Claude Code would offer in `cwd`, one row per name. When two places define a name,
 * the one Claude Code runs wins: personal over project, a skill over a command file, the nearer
 * project folder over a farther one. A skill synced from claude.ai keeps its short name only while
 * nothing else uses it, as Claude Code does.
 */
export async function discoverClaudeCommands(opts: DiscoverOptions): Promise<ClaudeCommand[]> {
  const io = opts.io ?? discoveryDiskIo;
  const warn = opts.warn ?? ((m: string) => console.warn(`[claude-commands] ${m}`));
  const { home, configDir } = opts;
  const dirs = opts.cwd === null ? [] : await projectDirs(io, opts.cwd, home);

  // Narrowest last, so it wins the merge: user, then the project root's shared and local files.
  const root = dirs.at(-1);
  const layers = [
    await readSettings(io, join(configDir, "settings.json"), warn),
    ...(root === undefined
      ? []
      : [
          await readSettings(io, join(root, ".claude", "settings.json"), warn),
          await readSettings(io, join(root, ".claude", "settings.local.json"), warn),
        ]),
  ];
  const overrides: OverrideStates = {};
  const enabled: PluginSwitches = {};
  for (const layer of layers) {
    Object.assign(overrides, layer.skillOverrides);
    Object.assign(enabled, layer.enabledPlugins);
  }

  const ordered: Found[] = [
    ...(await skillsIn(io, join(configDir, "skills"), "", warn, new Set(["synced"]))),
    ...(await commandsIn(io, join(configDir, "commands"), "", warn)),
  ];
  for (const dir of dirs) {
    ordered.push(...(await skillsIn(io, join(dir, ".claude", "skills"), "", warn)));
    ordered.push(...(await commandsIn(io, join(dir, ".claude", "commands"), "", warn)));
  }
  const plugins = await enabledPlugins(io, configDir, enabled, opts.cwd ?? home, warn);
  // Observed 2026-10-11, not documented: a plugin an organisation syncs from claude.ai sits in
  // `plugins/synced/<account>/<name>~<generation>/`, enabled by being there.
  const syncedPlugins = join(configDir, "plugins", "synced");
  for (const bucket of (await io.list(syncedPlugins)) ?? []) {
    if (!bucket.dir || bucket.name.startsWith(".")) continue;
    for (const entry of (await io.list(join(syncedPlugins, bucket.name))) ?? []) {
      const name = entry.name.split("~")[0]!;
      if (!entry.dir || entry.name.startsWith(".") || !NAME.test(name)) continue;
      if (plugins.some((p) => p.name === name)) continue;
      plugins.push({ name, path: join(syncedPlugins, bucket.name, entry.name) });
    }
  }
  for (const plugin of plugins) {
    ordered.push(...(await skillsIn(io, join(plugin.path, "skills"), `${plugin.name}:`, warn)));
    ordered.push(...(await commandsIn(io, join(plugin.path, "commands"), `${plugin.name}:`, warn)));
  }
  // Observed 2026-10-11, not documented: one folder per signed-in account under `synced/`, each
  // holding that account's skills. A pane's account is not in its snapshot, so every account counts.
  const synced: Found[] = [];
  const syncedRoot = join(configDir, "skills", "synced");
  for (const bucket of (await io.list(syncedRoot)) ?? []) {
    if (bucket.dir && !bucket.name.startsWith(".")) synced.push(...(await skillsIn(io, join(syncedRoot, bucket.name), "", warn)));
  }

  const byName = new Map<string, Found>();
  for (const row of ordered) {
    if (row.overrideKey !== null && overrides[row.overrideKey] === "off") continue;
    if (!byName.has(row.command)) byName.set(row.command, row);
  }
  const syncedNames = new Set<string>();
  for (const row of synced) {
    // The same account skill sits in every account folder that has it; it is one command.
    if (syncedNames.has(row.command)) continue;
    syncedNames.add(row.command);
    const command = byName.has(row.command) ? `/anthropic-skills:${row.command.slice(1)}` : row.command;
    if (!byName.has(command)) byName.set(command, { ...row, command });
  }
  return [...byName.values()].slice(0, MAX_COMMANDS).map(({ command, description, argHint }) => ({
    command,
    description,
    argHint,
  }));
}

