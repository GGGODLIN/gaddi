# 9005 — A retelling is one short-lived child the operator named, never a service or a prompt Collie owns

Status: **Accepted** (2026-09-26)
Date: 2026-09-26

Trail: item 4 of the operator's roadmap (kept outside the repo), where option a ("the
producer stays in the host's mod or sidecar, because the bridge may not call a model") was the
chosen road, and the implementation hand-off that proposed the alternatives below. Files:
`bridge/retell.ts`, `bridge/server.ts` (`retellPane`), `web/src/components/retell-sheet.tsx`.
Related: [ADR 0029](./0029-speech-to-text-is-a-provider-seam-collie-owns.md) (the first exception to
the same rule, and the shape this one copies).

## Context

The phone wants the "plain" (last turn) and "lost" (whole session) retellings that
cc-sidecar-waitwhat already writes for the terminal and for the in-Claude mod. The mod's own buttons
cannot serve the phone: they are text in the mirror, and pressed, they split a new terminal pane to
run `ww` that the phone would then have to switch to.

The security posture says the bridge makes no outbound call and spawns no child for content. Three
other roads were weighed and each costs more than the exception below:

- **Collie writes its own prompts and calls a model.** A second copy of the prompts, the turn
  selection and the cache would drift from the terminal's; and it is the credential-bearing egress
  ADR 0029 only accepted behind a setup verb.
- **The mod produces, Collie reads a result file.** The mod has no way to hear the phone, so this
  needs a request channel into a running Claude (a polled file or a socket) — a new long-lived
  surface to answer one button.
- **A resident retell service.** One more daemon for a feature used a few times a day.

## Decision

The bridge may run the operator's own retell command, once per request, only while
`<config-dir>/retell.toml` names it:

```toml
command = ["/Users/me/.local/bin/ww", "--source", "http"]
```

- **The argv is the operator's; the phone chooses nothing in it.** The phone sends a pane id and one
  of two modes. The bridge maps the pane to the session id the multiplexer reported and appends
  `[1] --session-id <id> --json [--no-cache]`. No shell, no client string, no path.
- **The sidecar keeps the prompts, the selection and the cache.** Collie adds none, so the phone,
  the terminal and the mod hit each other's cache entries.
- **One child, bounded.** 180 seconds, then it is killed; one request per pane and mode at a time.
- **Where the model call goes is the operator's `command`.** `--source http` keeps it on the
  loopback proxy; the bridge itself still opens no outbound connection.
- **An answer for another session is refused**, not shown, so a late reply cannot be read as the
  retelling of what is on screen now.
- **The route is a write.** Each retelling is a paid model call, so an unpaired or read-only device
  gets none.

## Consequences

- A second exception now qualifies "spawns no child for content", beside STT. It stays absent on
  every install that has no `retell.toml`.
- The phone depends on the sidecar's `--session-id` and `--json` contract (added for this, sidecar
  commit a9c5d5c). A sidecar older than that fails the request with its own argparse error.
- The timeout kills the direct child only. A `command` whose sidecar spawns a grandchild (`--source
  cmd` or `auto`, which run `claude -p`) can leave that grandchild running after a timeout; the shipped
  example uses `--source http`, which spawns none.
- Revisit if a retelling needs streaming, a conversation, or history — each of those is a service,
  not a one-shot child, and would have to argue past this record.
