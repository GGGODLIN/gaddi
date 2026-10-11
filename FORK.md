# FORK.md — what this fork carries that upstream should not take as-is

This is GGGODLIN's fork of [AltanS/collie](https://github.com/AltanS/collie). Most fork work is
meant to go upstream and is recorded the ordinary way, as a bullet under `## [Unreleased]` in
[`CHANGELOG.md`](/CHANGELOG.md).

This file lists the other kind: changes that only make sense on this operator's own setup. Read it
before opening an upstream PR, so none of these ride along, and before publishing the fork, so a
reader knows which parts assume tools they do not have.

## Keeping this list current

Last audited against `upstream/main` at `54d76632` (2026-09-26): every non-docs fork commit since
then is either a `CHANGELOG.md` bullet or an entry below.

1. Add the entry in the same commit as the change (CLAUDE.md → *Personal changes go in FORK.md*).
2. After each upstream merge and before each upstream PR, list what the fork still carries.

   ```
   git fetch upstream && git log --no-merges --format='%h %s' upstream/main..main
   ```

3. Sort any commit newer than the audit point into general or personal, then move the hash above.

A personal change that upstream later accepts in a general form leaves this list in the merge
that brings it back.

## Personal changes

Each entry says what it is, where it lives, and what it assumes.

### Gaddi brand: the fork's own name and pixel-art dog (2026-10-08)

- **What.** The fork is published as Gaddi, with a pixel-art Gaddi dog as its mark, because
  upstream's [`TRADEMARKS.md`](/TRADEMARKS.md) keeps the ColliePWA name and dog mark out of a fork.
  It replaces the 2026-09-22 `COLLIE-GGGODLIN` title bar.
- **Where.** The UI strings keep upstream's dictionaries as they are: `t()` and `tn()` in
  [`web/src/lib/i18n/index.ts`](/web/src/lib/i18n/index.ts) swap the word Collie for Gaddi on the
  way out. The mark is [`web/src/components/collie-mark.tsx`](/web/src/components/collie-mark.tsx)
  (upstream's name and props, new drawing in `gaddi-mark-art.ts`). Names: the header wordmark,
  `web/index.html`, the manifest names in `web/vite-icons.ts`, the idle lock, the default push
  title, the iPhone app's display names and strings. Images: the icons under `web/public/`, the
  iPhone app icon and Island mark, `assets/social-card.png` and `assets/gaddi-banner.png`.
- **Assumes.** Nothing outside the repo. Internal names stay upstream's: the `collie` command, the
  plugin id `herdr.collie`, file names and identifiers, so an existing install updates in place.
- **Not renamed, on purpose (2026-10-11).** The CLI's own output and the pages under `docs/` still
  say Collie. Their reader is the operator at a terminal typing `collie`, the README says so up
  front, and the `cli/` sources hold about 170 such lines mixed with action names and paths that
  must not change.
- **To upstream.** Leave it out. An upstream PR takes no file from this list.

### The pane description reads a recap cc-mod-waitwhat writes (2026-09-24)

- **What.** One of the three sources of a pane's description is a recap file the operator's
  Claude Code mod writes to `~/.cache/cc-recap/<sessionId>.json`. The other two, a waiting
  approval and the newest prompt, work anywhere.
- **Where.** [`bridge/journal/recap.ts`](/bridge/journal/recap.ts), read by
  [`bridge/description/resolve.ts`](/bridge/description/resolve.ts). The design notes stay in the
  operator's local research folder, outside the repo.
- **Assumes.** cc-mod-waitwhat's recap hook is installed; without it that source is simply absent.
- **To upstream.** The description can go as it is. The recap source needs the file format written
  down as a contract any plugin can produce, not one mod's output.

### Plain / Lost retellings run cc-sidecar-waitwhat (2026-09-26)

- **What.** The pane sheet's Plain and Lost rows run the command `retell.toml` names, appending
  `--session-id <id> --json`, and read its JSON answer.
- **Where.** [`bridge/retell.ts`](/bridge/retell.ts),
  [`web/src/components/retell-sheet.tsx`](/web/src/components/retell-sheet.tsx),
  [ADR 9005](/.adr/9005-retell-is-a-one-shot-operator-child.md).
- **Assumes.** The operator's own [cc-sidecar-waitwhat](https://github.com/GGGODLIN/cc-sidecar-waitwhat)
  (`ww`): its flags and its JSON shape are the contract. The account switch that landed in the same
  commit is general and is not part of this entry.
- **To upstream.** Only with the argv and answer shape documented as Collie's own contract, and
  ADR 9005's security exception accepted by the maintainer.

### The live e2e suite in e2e-live (2026-09-25)

- **What.** A browser suite that drives the active Collie through this machine's tailnet front door
  against a throwaway Herdr session.
- **Where.** [`e2e-live/`](/e2e-live/), and the *Fork-only live e2e* section of
  [`CLAUDE.md`](/CLAUDE.md).
- **Assumes.** This machine's front door and the `ccp-free` Claude launcher, so a run spends only
  the free pool.
- **To upstream.** Leave it out. Upstream's Tier 2 (`web/e2e/live/`) is the general form.

### The wait-what band is hidden from the mirror (2026-09-26)

- **What.** The phone's pane mirror drops the band that
  [cc-mod-waitwhat](https://github.com/GGGODLIN/cc-sidecar-waitwhat) draws above Claude's input box
  (the `wait what [ 白話 ] [ 跟丟了 ]` row, its recap line and any retelling under it).
- **Where.** [`web/src/lib/harness/claude/waitwhat-band.ts`](/web/src/lib/harness/claude/waitwhat-band.ts),
  applied after `stripChrome` in [`web/src/lib/harness/claude/index.ts`](/web/src/lib/harness/claude/index.ts).
- **Assumes.** The operator runs that mod, whose labels are in Traditional Chinese. On the phone its
  buttons are dead text; the retell sheet (ADR 9005) and the pane description replace them.
- **To upstream.** It would need to become a general rule, for example an operator-declared list of
  band headers to hide, instead of one mod's labels written into the code.

### Updates come from this fork (2026-09-27)

- **What.** `collie update`, `collie doctor` and the in-app update banner take their releases from
  `GGGODLIN/gaddi` (named `GGGODLIN/collie` until the 2026-10-11 rename, which `originMatches` still
  accepts in a clone's `origin`) unless `COLLIE_UPDATE_REPO` says otherwise, and the release and triage workflows
  skip the jobs that need upstream's site token, AUR key and model key.
- **Where.** `DEFAULT_UPDATE_REPO` in [`cli/install-kind.ts`](/cli/install-kind.ts), which
  [`bridge/index.ts`](/bridge/index.ts) now reads too; the `update_repo` default in
  [`bridge/config-schema.ts`](/bridge/config-schema.ts); the test fixtures naming the default; the
  `if:` of `notify-website` and `refresh-packages` in
  [`.github/workflows/release.yml`](/.github/workflows/release.yml) and of `classify` in
  [`.github/workflows/triage.yml`](/.github/workflows/triage.yml); CI also runs on pushes to `dev`
  ([`.github/workflows/ci.yml`](/.github/workflows/ci.yml)). The slow-read case in
  [`web/e2e/pane-glide.spec.ts`](/web/e2e/pane-glide.spec.ts) sets the claude pane working, because
  a blocked row here opens the list approval first (`web/src/hooks/use-list-approval.tsx`).
- **Assumes.** This fork cuts its own releases on `main` (CLAUDE.md → *Fork branches and
  releases*).
- **To upstream.** Leave it out. `bridge/index.ts` reading `updateRepoOf` instead of its own copy of
  the default is general and could go on its own.

### Windows VM rehearsal is permanently waived (2026-10-04)

- **What.** Fork releases do not run `make win-rehearse`. The waiver is permanent and covers only
  the Windows VM install, update and rollback rehearsal. Windows CI on the release commit must
  still be green, and the Windows zip, build and asset checks stay as they are. Windows stays
  experimental; the VM path stays unverified. `windows.yml` can be started by hand
  (`workflow_dispatch`) so the same CI can run on a `dev` commit before a release. That is not a
  check on every `dev` push, and this entry does not record that a dispatch was run.
- **Where.** [`CLAUDE.md`](/CLAUDE.md) (*Versioning* step 7 points at *Fork branches and releases*
  → *Windows VM rehearsal*), [`docs/windows.md`](/docs/windows.md), the same "today" lines in
  [`README.md`](/README.md) and [`docs/install.md`](/docs/install.md), and `workflow_dispatch` in
  [`.github/workflows/windows.yml`](/.github/workflows/windows.yml).
- **Assumes.** This fork has no Windows VM, and the operator cannot configure one.
- **To upstream.** Leave it out. Upstream's VM rehearsal requirement is unchanged.

### The fork numbers its own releases (2026-10-10)

- **What.** From fork 2.0.0 the fork's version is its own SemVer, picked from what each release
  means to someone running Gaddi, and no longer derived from the upstream release it is built on.
  Each release still names that upstream release in its first CHANGELOG bullet. The ADR 0038 test
  clock reads that bullet instead of the package major, so the fork reaching 2.0.0 does not demand
  the `collie pack` alias's removal before upstream makes it.
- **Where.** [`CLAUDE.md`](/CLAUDE.md) → *Fork branches and releases* → *Version numbers*,
  [ADR 9008](/.adr/9008-the-fork-numbers-its-own-releases.md), and the "`crew` alias is gone in
  2.0.0" case in [`cli/program.test.ts`](/cli/program.test.ts).
- **Assumes.** Every release's CHANGELOG section carries the "Built on upstream Collie X.Y.Z."
  bullet.
- **To upstream.** Leave it out. Upstream numbers its own releases already.
