# 9004 — Both pane switcher entries use attention

- **Status:** Accepted
- **Date:** 2026-09-25
- **Shipped in:** pending
- **Amends:** [0063](./0063-a-pane-keeps-its-place-when-its-state-changes.md) and
  [9003](./9003-the-switcher-orders-a-section-by-its-latest-state-change.md), in scope: the
  in-pane switcher sheet
- **Trail:** Operator discussion on 2026-09-25 ("對，我要統一") ·
  `web/src/components/agent-chat.tsx` · `web/src/routes/home.tsx` · `DESIGN.md` §2

## Context

The dashboard summary opened a switcher grouped by attention, but the Layers mark inside a pane
opened the same switcher component grouped by workspace. The operator expected the two entry points
to use the same arrangement. Simply changing the in-pane sheet's order would make a poll move a row
under a thumb, the problem 0063 excluded.

## Decision

**Both entry points open the pane switcher in attention order, with its pane list fixed for that
opening.** The in-pane Layers tap and upward pull share one opening path that copies the agent and
shell lists. The dashboard summary continues to copy its agent list. A later opening reads the latest
lists. Shells and Launch remain trailing sections; launch availability and write refusals still read
live state.

Place order remains available to other callers of `ThreadSidebar`. The dashboard body, pane strip
and space view do not change their order.

## Consequences

- A pane's status or presence can change while the sheet is open without moving its row or removing
  its Shells section. Closing and reopening refreshes the list.
- The switcher may briefly show a pane that has since closed. Selection still uses the pane's own
  address; this snapshot promises a stable choice, not a fresh existence check.
- The attention-section ordering from 9003 now applies to the in-pane sheet too, without changing
  any place-ordered surface.
- **Addendum (2026-11-12):** Live `herdr-core` child terminals ([9014](./9014-a-child-terminal-reports-completion-to-its-parent.md))
  stay nested under their unpinned root parent inside the attention sections (`triageTrees`), and the
  family takes the most urgent bucket and newest transition timestamp among its members, matching
  Herdr App's Priority view.
