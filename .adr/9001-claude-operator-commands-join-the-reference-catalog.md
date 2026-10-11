# 9001 — Claude operator commands join the reference catalog

- **Status:** Accepted; command execution amended by [ADR 9002](./9002-the-agent-palette-stages-never-sends.md); "not a runtime registry" amended by [ADR 9009](./9009-the-palette-lists-what-claude-code-would-load.md)
- **Date:** 2026-09-23
- **Shipped in:** pending
- **Trail:** operator request in the 2026-09-23 Claude Code design thread ("自製 slash 一定出現，原生的也要有") · `web/src/lib/agent-commands.ts` (`commandsFor`) · [ADR 0018](./0018-operator-command-rows-replace-the-catalog.md) · [ADR 0043](./0043-operator-bar-rows-replace-the-bar-not-the-palette.md)

## Context

The Agent palette keeps a maintained per-harness reference catalog. It is curated for useful phone
actions and search, not read from the running harness, so a row means Collie knows how to present and
send that command; it does not prove the current session supports it.

`commands.toml` supplies the other half: commands installed by the operator or a plugin that cannot
belong in a shipped list. ADR 0018 made any matching operator row replace the whole palette. On Claude
Code that turns adding one custom slash command into restating the reference catalog by hand, and the
catalog is now a searchable reference rather than the handful of shortcuts ADR 0018 described.

The operator chose the opposite trade-off for Claude: custom rows must remain visible without hiding
the maintained reference rows. That does not reopen the composition policy for every harness or every
surface.

## Decision

**Claude's Agent palette merges matching operator rows with the maintained reference catalog.** Scope
resolution still runs first through `rowsFor`. The resolved operator rows appear first, followed by
reference rows whose complete command string does not occur in the operator set.

**An exact-name operator row wins presentation but cannot lower confirmation.** Its description,
argument behavior and hint are used, it is shown on the first screen, and its danger flag is
`shippedDangerous || operator.confirm`. Namespaces and aliases are not inferred; only the exact command
string is one identity.

**Every other command palette keeps ADR 0018's replacement rule.** The harness bar remains its own
replacement surface under ADR 0043. `keys.toml` and `quick-replies.toml` remain replacement lists.
Their shared reader and scope ladder do not imply shared composition.

**The reference catalog is not a runtime registry.** This decision adds no Claude process, live
subscription, generated snapshot or promise that the list matches the active TUI. Updating that
catalog remains a separate maintenance decision.

## Consequences

- Adding `/deploy` to a Claude scope keeps `/compact`, `/model` and the rest of the maintained
  reference catalog available in search.
- Declaring `/clear` changes its label and argument behavior but keeps the shipped two-tap
  confirmation.
- An operator can no longer use one Claude row to hide every reference row. Hiding or grouping rows
  would be a separate feature with its own interface.
- Other harnesses retain the end-to-end operator-owned list that ADR 0018 chose, and the actions row
  does not grow merely because the Agent palette did.
- The reference catalog may lag Claude Code or show a command unavailable in one session. The active
  harness remains the authority on whether submitted text is accepted.
- Revisit generation only after a candidate source proves it can preserve Collie's presentation,
  argument and confirmation policy rather than supplying names alone.
