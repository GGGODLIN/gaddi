# 9009 — The palette lists what Claude Code would load

- **Status:** Accepted
- **Date:** 2026-10-11
- **Shipped in:** pending
- **Trail:** a user asked whether skills can be called from the phone with `/`, and the operator's own
  palette had silently missed twenty of their skills ("可以做A，但我希望還是同一個入口，不要分原生與
  user skill，畢竟cc也沒分", 2026-10-11) · `bridge/claude-commands.ts` · `GET /api/pane/<id>/claude-commands`
  · `web/src/lib/agent-commands.ts` (`withFound`) · amends upstream's [ADR 0018](./0018-operator-command-rows-replace-the-catalog.md)
  and the fork's [ADR 9001](./9001-claude-operator-commands-join-the-reference-catalog.md) · fork-only by
  decision, not proposed upstream

## Context

ADR 0018 held that the palette is not a discovery surface: the real command set lives inside the
agent process, nothing on the machine lists it, and the agent's own `/` completion already shows it in
the mirror. ADR 9001 kept that for Claude and added no generated list.

For Claude Code the second premise no longer holds. Its documentation names every place a command can
come from and how each gets its name: personal and project skill folders, `.claude/commands` files,
enabled plugins, and skills synced from claude.ai (code.claude.com/docs/en/skills, read 2026-10-11).
A frontmatter `user-invocable: false` or a `skillOverrides` value of `"off"` keeps a skill out of the
`/` menu, and both are on disk too.

The first premise fails in practice. A palette that shows only the reference catalog plus
`commands.toml` makes every operator keep a hand-written copy of their own skills. This operator did,
and the copy was missing twenty skills they type daily, because the one rule deciding what to copy
read "third party" as "has an upstream". The `/` completion in the mirror does not help on a phone
either: it appears only while the draft is typed key by key into the terminal.

## Decision

On a Claude pane, the palette lists the commands Claude Code would load in that pane's cwd, read off
the pane's machine, in the same list and the same search as everything else. Claude Code's own menu
does not separate built-in, personal and plugin commands, so neither does the palette.

- **What is read:** `<config>/skills/*/SKILL.md` and `<config>/commands/**/*.md`; `.claude/skills` and
  `.claude/commands` in every folder from the cwd up to the repository root (the cwd alone when there
  is no repository, never above home); the `skills/` and `commands/` of each plugin
  `enabledPlugins` turns on and `installed_plugins.json` installs for this cwd; skills and
  organisation plugins synced from claude.ai. `<config>` is the parent of the first Claude journal
  root when that root is a `projects` folder, else `~/.claude`.
- **What is left out:** `user-invocable: false`; a personal or project skill whose `skillOverrides` is
  `"off"` in the user settings or the repository root's `.claude/settings.json` /
  `settings.local.json`; a name with a character other than a letter, a digit or `._:-`.
- **Names follow Claude Code:** the frontmatter `name` or the folder name; a commands subfolder
  becomes a `:` namespace; a plugin's rows are `/<plugin>:<name>`; a synced skill keeps its short name
  only while nothing else uses it, else `/anthropic-skills:<name>`. When two places define a name, the
  one Claude Code runs wins: personal over project, a skill over a command file, the nearer folder
  over the farther.
- **Composition:** the operator's `commands.toml` rows still come first and win a name, so their own
  descriptions stay. A found command naming a reference row replaces that row's description and keeps
  its `dangerous` classification. Found rows are searchable but not on the first screen, which stays
  the operator's rows and the common reference ones.
- **Boundaries:** every path comes from the operator's home, the bridge's config and the cwd the
  multiplexer reported; the request names only a pane id, looked up in the snapshot. Nothing is
  executed and nothing is written. A missing folder is a quiet empty list; a file whose frontmatter
  does not parse is skipped and named in the bridge log. The read is a plain `read`, like
  `/api/config`, which already carries the operator's own command descriptions.
- **Not a registry:** this is a best-effort mirror of Claude Code's loader. The terminal's own `/` menu
  is the authority, and a row here proves only that a file exists where Claude Code looks.

## Consequences

- A newly installed skill is in the palette at the next open; nobody maintains a copy. `commands.toml`
  keeps its job for descriptions, the first screen and the bar.
- Known gaps, each one a place the pane's snapshot cannot see: the managed (enterprise) directory,
  nested skills below the cwd, `--add-dir` folders, and per-session plugin dirs. A pane on a crew member
  gets the lead's 501, so the phone shows the palette it had before.
- The synced layouts (`skills/synced/<account>/` and `plugins/synced/<account>/<name>~<n>/`) are
  observed, not documented. Every account's skills are listed, because a pane's account is not in its
  snapshot. If Claude Code moves them, those rows disappear and nothing else breaks.
- Other harnesses keep ADR 0018's rule unchanged.
- Upstream keeps ADR 0018 as written; this fork does not propose this change upstream, because it
  reverses a premise upstream's maintainer chose.
- Revisit if Claude Code publishes an enumerable command list a bridge can read without starting a
  session, which would replace the disk walk.
