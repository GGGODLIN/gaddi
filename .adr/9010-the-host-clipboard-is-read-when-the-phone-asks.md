# 9010 — The host clipboard is read when the phone asks, never watched and never kept

Status: **Accepted** (2026-10-11)

Trail: the operator's roadmap (kept outside the repo), "host clipboard, taken from the phone", and a
GPT-6 Pro review of the first draft on 2026-10-11. Files: `bridge/host-clipboard.ts`,
`bridge/server.ts` (`/api/host-clipboard`, `/api/host-clipboard/text`),
`web/src/lib/host-clipboard.ts`, `web/src/components/host-clipboard.tsx`. Related:
[ADR 9005](./9005-retell-is-a-one-shot-operator-child.md) (the shape this copies),
[ADR 0024](./0024-a-beacon-is-a-hint-never-a-control-channel.md) (why a hook is not the road).

## Context

An agent hands the operator text by putting it on the host's clipboard (`pbcopy`): a long prompt to
paste into another tool's settings is the case on record. Away from the desk, the phone could not
reach it. Apple's Universal Clipboard covers the operator only when the phone is near the Mac.

Four roads were weighed, and three were turned down:

- **Name the agent that copied.** Tried on 2026-10-11 with two agents and the shell writing nine
  times in a row: matching a change to the latest tool call that mentions `pbcopy` was right three
  times, wrong five and missed once. The shell's writes were all pinned on an agent, a command that
  only *mentions* `pbcopy` counted as a write, and a tool call is issued up to a minute before the
  write it makes. The clipboard has no author, and a guess at one is worse than none.
- **Keep a short history so an overwritten copy is not lost.** That is a second, system-wide
  clipboard history, holding what a password manager already cleared. Nobody asked for one.
- **Watch the clipboard from a hook or a resident watcher.** A hook is per harness and ADR 0024's
  beacon carries display fields only; a resident watcher (`wl-paste --watch`, a timer in the bridge)
  is a daemon spending the host's time for a phone that may not be looking.
- **Push a notification when it changes.** The operator chose the in-app notice instead.

## Decision

The bridge may read the host clipboard, with the operator's own commands, only while
`<config-dir>/clipboard.toml` names both:

```toml
count = ["/usr/bin/osascript", "-l", "JavaScript", "-e",
         "ObjC.import('AppKit'); $.NSPasteboard.generalPasteboard.changeCount"]
read = ["/usr/bin/pbpaste"]
```

- **Two one-shot children, argv only, never a shell.** `count` prints the change counter, `read`
  prints the text. Each runs at most 5 seconds and is then killed.
- **The counter is polled by the phone, not watched by the bridge.** `GET /api/host-clipboard`
  answers the counter, runs `count` at most once per 4 seconds however many phones ask, and is gated
  like any read. The phone polls it every 10 seconds while it is visible. A closed app asks nothing,
  and the bridge runs no timer.
- **The text is read when the phone opens the sheet, and only then.** `GET
  /api/host-clipboard/text` is gated `device-read`, like the Files view, and writes an audit line
  with the size, never the words. The counter is read before and after `read`; a write in between is
  read once more, and a clipboard that keeps moving is said to be moving.
- **Nothing is kept.** No history, no copy of the text in the bridge between requests, and on the
  phone only the counter it last saw (`collie:host-clipboard:v1`). The first counter a phone ever
  reads is a baseline, not news.
- **Past 256 KB the answer is "too large"**, never the first 256 KB presented as the clipboard.
- **No author is named.** The banner says the clipboard changed, not who changed it.
- **This host's clipboard only.** It is not forwarded over the crew link, and a pane on a member does
  not offer it.

## Consequences

- A third exception now qualifies "spawns no child for content", beside STT and retell. It is absent
  on every install with no `clipboard.toml`.
- With the app closed the operator hears nothing; the banner waits for the next time the app is
  opened. That is the price of no push and no timer, accepted on 2026-10-11.
- Two writes inside one poll interval show as one change, and only the second text is readable.
- The shipped example is macOS. Linux has no counter on a one-shot command (`wl-paste --watch` is a
  watcher), so it is not documented there. A Linux operator could name commands of their own.
- `pbpaste` under launchd may lack `LANG`; the bridge fills in `en_US.UTF-8` for the child only when
  its own environment names none, so non-ASCII text survives.
- Revisit if the operator needs to know who copied, or needs an overwritten copy back. Either is a
  watcher or a store, not a one-shot child, and would have to argue past this record.
