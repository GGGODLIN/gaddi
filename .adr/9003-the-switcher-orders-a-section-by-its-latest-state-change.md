# 9003 — The switcher orders a section by its latest state change

> Amended in scope by [9004](./9004-both-pane-switcher-entries-use-attention.md): the in-pane
> switcher now uses the same frozen attention order.

- **Status:** Accepted
- **Date:** 2026-09-25
- **Amended in scope by:** [ADR 9004](./9004-both-pane-switcher-entries-use-attention.md) (in-pane switcher uses the same frozen attention order)
- **Amends:** [0063](./0063-a-pane-keeps-its-place-when-its-state-changes.md), in scope: the
  switcher's attention sections only
- **Trail:** `web/src/lib/triage.ts` (`triage`, `newestFirst`) · Herdr v0.9.0
  `src/client/shell/agent_sidebar.rs` (`ordered_agent_pane_ids`) and `src/client/shell.rs`
  (`status_priority`)

## Context

0063 made every list a place list and left `triage()` classifying only. The switcher's attention
arrangement, the one the dashboard summary opens, still groups rows into Needs you, Ready, Recent
and Working, and inside each section it kept the order the bridge sent: space, tab, position. On
the phone that read as random, because the rows in one section carried times that jumped back and
forth (11:20, 00:02, 00:10 in one Recent section).

The operator runs Herdr with `agent_panel_sort = "priority"`. Herdr orders that panel by status
rank (blocked, done, working, idle) and then by `state_change_seq`, newest first. The phone's
sections were the only place the same panes appeared in a different order, and the operator reads
the two side by side.

## Decision

**Inside each attention section, the pane whose state changed last comes first.**

1. `triage()` sorts every bucket by `lastActiveAt`, newest first, which is the bridge's record of
   the last status transition and so the same clock Herdr's `state_change_seq` counts. Ties and
   panes without a timestamp keep the order they were sent; untimed panes sink below timed ones.
2. The Recent direction toggle still reverses Recent alone.
3. Nothing else moves. Place-ordered surfaces (the dashboard's workspace groups, the in-pane
   switcher, the pane strip, the space view) never took their position from `triage()` and still do
   not.

## Consequences

- **Rows can change place between two openings of the switcher.** They cannot move while it is open:
  `HomeRoute` freezes the rows when the sheet opens, the property 0063 required of any surface that
  sorts by urgency.
- **The tour's "first blocked pane" is now the newest blocked one**, which its own comment already
  claimed.
- **Revisit if the switcher stops freezing its rows**, or if Herdr's priority order changes shape.
