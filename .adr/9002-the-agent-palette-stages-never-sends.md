# 9002 — The Agent palette stages commands, never sends them

- **Status:** Accepted
- **Date:** 2026-09-23
- **Trail:** operator report in the 2026-09-23 Claude Code thread ("這個 agent 面板會點了就送出？我不喜歡這樣") · `web/src/components/command-palette.tsx` · `web/src/components/composer.tsx` · [ADR 9001](./9001-claude-operator-commands-join-the-reference-catalog.md)

## Context

The Agent palette used one row for two different acts. An argument-taking command filled the
composer so the operator could finish it, while a no-argument command submitted immediately. A
dangerous command added a two-tap confirmation, but the second tap still sent text into the live
terminal without showing it in the composer first.

That made the catalogue's metadata decide whether a phone tap was editing or execution. It also
made an incorrect `takesArg` classification a sending decision rather than a presentation mistake.
The operator wants the palette to remain a selection and editing surface, with Send as the one
explicit execution step.

The harness bar is different. Its buttons are named direct actions above the keyboard, and its
confirmation rule already belongs to that surface.

## Decision

**Selecting any Agent-palette row puts its command in the composer and closes the palette.** A
no-argument row inserts the command exactly. An argument-taking row adds one trailing space so the
operator can continue typing. Neither path submits.

**The palette does not confirm before staging.** A dangerous row remains visibly marked, but review
in the composer plus the explicit Send action replaces the palette's two-tap gate. The
`dangerous`/`confirm` classification remains a floor for direct-action surfaces.

**The harness bar remains direct.** Its buttons still send their commands and keep their existing
two-tap confirmation. Moving a row onto the bar therefore remains an explicit choice to make it an
action rather than a draft.

## Consequences

- Every palette command costs one explicit Send tap after selection.
- The operator can edit, add arguments to or discard any selected command before it reaches the
  terminal.
- A stale or wrong `takesArg` value can only add or omit a trailing space; it cannot cause an
  immediate send.
- `confirm = true` still protects `bar = true` commands, while palette-only rows never execute on
  selection.
- Revisit only if the palette gains a separately labelled direct-action control. A row tap itself
  remains staging.
