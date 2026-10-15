# 9011 — The palette lists what seven more agents would load

- **Status:** Accepted
- **Date:** 2026-10-15
- **Shipped in:** pending
- **Trail:** the operator asked that skill listing work "跟claude一樣做兩階段，照上游政策內建的可以直接列出，到時候可以貢獻上游，user自建的就留在我的fork" (2026-10-15) · `bridge/agent-skills.ts` · the same `GET /api/pane/<id>/claude-commands` route · `web/src/lib/agent-commands.ts` (`FOUND_AGENTS`, `withFound`) · amends the fork's [ADR 9009](./9009-the-palette-lists-what-claude-code-would-load.md), which said other harnesses keep [ADR 0018](./0018-operator-command-rows-replace-the-catalog.md) unchanged · fork-only by decision

## Context

ADR 9009 made a Claude pane's palette list the skills Claude Code would load, read off disk, and
left every other agent on the shipped catalog. Seven of the agents this operator runs load skills
too: Codex, opencode, pi, Oh My Pi, Grok Build, Antigravity and Muse Code. Each has its own folders,
its own order, its own way to hide a skill and its own spelling: `$name` in Codex, `/skill:name` in pi
and Oh My Pi, `/<plugin>:<skill>` for an Antigravity plugin, `/name` elsewhere. Several also read
Claude's own `~/.claude/skills`, which is how the operator's Claude skills reach them.

A skill comes in two kinds. A **built-in** one ships with the agent and is the same on every machine
that runs that version. A **user** one is whatever this operator installed. They differ in who may
want them: the first belongs in the maintained catalogs every install gets, the second only on the
machine that has it.

Two agents can list their own skills without a model call: `muse skills list --json`, and
`grok inspect --json` per Grok's docs. Calling them would be exact where a disk walk is a guess.

## Decision

**Built-in skills are rows in the shipped catalog.** Each agent's built-ins that its own completion
offers on a live pane go into `agent-commands.ts` like any other command, with the agent's spelling,
and leave out what the agent hides. They are an upstream candidate: ADR 0018's catalog already lists
what an agent offers.

**User skills are read off disk, per agent, the way ADR 9009 reads Claude's.** `bridge/agent-skills.ts`
mirrors each agent's documented or source-read loader: its folders and their order, the project
walk to the repository root, its trust gate where it has one (pi's `trust.json`, Grok's
`trusted_folders.toml`), its hiding rules, and its spelling. The bridge answers on the route ADR 9009
added; the route keeps its first name. The phone folds the rows into the same list and search.

- **No child process.** The bridge never runs an agent's own lister. A palette open would spawn the
  agent's binary as the bridge user, on every open, which is the kind of content child the security
  posture allows only behind an operator's own config (ADR 0029, ADR 9005). The disk walk executes
  nothing.
- **Fork-only.** Upstream keeps ADR 0018 as written, as ADR 9009 already decided for Claude.
- **The operator's own rows still replace the catalog on a non-Claude pane** (ADR 0018), found rows
  included. ADR 9001's additive rule stays Claude's.

## Consequences

- A skill installed for any of the eight agents is in the palette at the next open. The agent itself
  may need a restart to offer it: Antigravity loads its skills at startup (seen live).
- Each loader is a best-effort mirror of a moving target; the agent's own menu is the authority. What
  the walk does not cover is named in `agent-skills.ts`: Muse's per-skill toggles (their store is
  unknown), Oh My Pi's foreign user folders when its settings turn them on, Antigravity built-ins its
  default agent does not offer.
- Trust stores key a folder by its real path (Grok, pi and Muse, seen live and in pi's source), so a
  cwd the multiplexer reports through a link is looked up by both spellings.
- `CODEX_HOME`, `GROK_HOME`, `PI_CODING_AGENT_DIR` and `XDG_CONFIG_HOME` are read from the BRIDGE's
  environment, not the agent's. An operator who sets one only in an interactive shell sees the
  default folder's skills in the palette.
- Checked on 2026-10-15 against each agent's own list, live: two project probe skills in a throwaway
  repository matched every agent's `/` (or `$`, or `/skills`) menu, trust gates included; sampled
  user rows were in each menu; and `muse skills list --json` matched the Muse loader exactly, 144 of
  144.
- The built-in rows age with each agent release, like every catalog row.
- Revisit if an agent's lister becomes something the bridge already runs, or if an agent publishes a
  file a bridge can read for the list.
