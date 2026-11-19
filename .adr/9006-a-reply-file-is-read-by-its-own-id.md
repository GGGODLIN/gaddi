# 9006 — A reply file is read by its own id

- **Status:** Accepted
- **Date:** 2026-10-09
- **Amends:** [ADR 0088](./0088-paths-the-agent-prints-are-links.md) point 4, which this amends in
  scope and does not rewrite.
- **Relates to:** [ADR 0083](./0083-the-files-view-reads-the-changes-root.md) is unchanged:
  Files still reads one root-relative path, and `withinBound` is not widened.
- **Trail:** the operator asked to open a `file://` link in an agent's reply, including a file a Bash
  command wrote outside the Changes root (`roadmap-validation.json` in this session's scratch pad).
  The other road, the one ADR 0088 refused, is handing that absolute path to the bridge. `herdr-web-ui`
  does that. Collie does not.

## Context

ADR 0088 makes a printed path tappable only when the phone can resolve it to a path inside the
Changes root. A `file:` URL is refused there because it is an absolute path with no root, and a
phone has none of the host's files. That is the right refusal for a path the client names.

It is the wrong refusal for a file the agent's own reply already named. The operator's next tap is
that link. The file may sit outside the Changes root, because the agent was not asked to write it
inside the workspace. Treating the link as a title leaves the file on the host.

The path still must not come from the phone. User text, a note, a summary, thinking, a tool's input
or result, and a turn the agent abandoned are not the reply. A Write or Edit tool card is not the
definition of delivery either: the scratch file above was produced by Bash and Python and then named
in the reply.

## Decision

**The phone sends a pane id and an opaque id. The bridge opens the file it finds again in that
session's assistant reply, or it opens nothing.**

1. **The id is not a path.** It names the session the pane is on now, the turn's uuid, the place of
   one link in that turn's text, and the href of that link as the reply wrote it. A token that does
   not match all of those selects nothing. The href only picks which link. The path is read again
   from that reply, and nothing in the id is opened, including a field someone adds to it. After the
   pane moves to another session, the old id does not read the new session's file.
2. **Only the reply authorises.** `role: "assistant"`, not abandoned, and only a `text` part. The
   list is taken from the transcript cache's bounded tail. A log clipped by that cap is reported
   incomplete. The rest of the file is not scanned to fill the gap.
3. **The read is the reply's path, checked again.** Local `file:` URLs only: empty host or
   `localhost`, one percent-decode, no `..` segment, no NUL, no other host. A `#L16` or `#L16-L20`
   suffix is a location, not a name. Any other fragment, a query, or a decoded backslash is refused,
   and `%23` stays in the name. A `~/` path and a POSIX
   absolute path in a markdown link of that same reply share the check. The opened handle's real
   path must be that file. `.git`, the bridge's state and config folders, and a state-secret's name
   are refused, on the spelled path and on the real path, including a symlink that lands on one.
   The directory of a named file is not readable. A missing file, a file that is not a regular file,
   and a download past the Files cap (1 MiB) are errors, not an empty or cut success. A preview may
   show the start and must say it is cut; that start is not the download.
4. **The gate is `device-read`, on the route.** Pairing and the device header, the same pair Files
   uses. The route is not on the crew wire. No journal, no adapter, or a member this round does not
   forward: the phone keeps the short title and does not ask again as if the link had opened.
5. **`file:` is never an anchor.** http(s) and mailto are unchanged. An in-root path the phone
   already resolves through Files is unchanged. HTML from a named file is drawn only by the existing
   sandboxed frame, as JSON text, never as a document of this origin.

This is a server-discovered allowlist lookup. It is not a fourth place a client-supplied value
becomes a path. The three-place law in `bridge/journal/files.ts` stands.

## Consequences

- **A file the reply names is readable by a paired device, including one the existing deny list
  does not cover.** A `file:` URL of `~/.ssh` is such a file when that path is not already denied.
  The boundary is "the reply named it", not a second secret scanner. Pairing is what keeps an
  unpaired phone out. It does not keep a paired phone out of a file the reply pointed at.
- **A same-user hard link is served when its path is allowed, as Files already does.** The path
  check does not scan the inode's other names, and it is not a guarantee that a secret's bytes are
  unreachable through another hard link.
- **Windows.** A drive `file:` URL is a Windows path only on a Windows host. Elsewhere it is
  refused. `O_NOFOLLOW` does not exist on Windows; the open uses the same flags as Files, and a
  host that cannot make that check does not gain a pretend same-user guarantee.
- **Revisit** if a crew member should serve its own reply files (that is a wire change, and this
  ADR does not make it), or if the 1 MiB cap is the wrong size for a download the operator asked
  for whole.
