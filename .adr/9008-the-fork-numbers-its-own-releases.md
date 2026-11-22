# 9008 — The fork numbers its own releases

- **Status:** Accepted
- **Date:** 2026-10-10
- **Relates to:** [ADR 0020](./0020-a-major-upgrade-is-consented-by-flag.md) (a major is crossed by
  consent), which makes the move to 2.0.0 a one-time tap. [ADR 0038](./0038-the-group-is-a-crew-the-wire-keeps-pack.md),
  whose 2.0 test clock this re-keys.
- **Trail:** the third rule in two weeks. 2026-09-27: an independent SemVer from 1.15.0, dropped
  because fork 1.17.0 read as behind upstream 1.17.2. 2026-10-07: upstream's major and minor with
  the patch ×100 plus a fork count (1.17.200, 1.19.3), dropped on 2026-10-10 because it tied every
  fork number to upstream's and made every fork-only release a patch, before the operator publicises
  the fork as Gaddi.

## Context

The fork is published under its own name and its own update source (FORK.md, "Updates come from
this fork"). Its number still came from upstream's, so a reader could not tell fork 1.19.3 from
upstream 1.19.3, and a fork feature could never be a minor.

What the number must satisfy is fixed by code, not by upstream's rules:

- strict `vX.Y.Z`, or no installed Collie offers it (`SEMVER_TAG` in `bridge/update.ts`);
- above every number already published, or no installed Collie takes it;
- at or above 1.9.0, or a crew lead running upstream refuses the member
  (`PROTOCOL_FLOOR_VERSION` in `cli/update-check.ts`).

Roads not taken:

- **Restart at 1.0.0.** Below 1.19.3 and below the crew floor.
- **Calendar majors (26.10.0).** A major crossing, and so a consent tap on every install, each
  January.
- **A date in the minor (1.261010.0).** Works, but keeps the fork on upstream's major and reads as
  noise.
- **A tag format of the fork's own, or the fork's own updater.** About 10,500 lines across 15 files
  that upstream changed by some 4,000 lines in the month before this decision; every sync would
  conflict in the one path that cannot repair itself once broken.

## Decision

**From fork 2.0.0, the fork's number is its own SemVer. Upstream's code still merges in; upstream's
number does not.**

1. **The axis is what the release means to someone running Gaddi.** A sync takes the axis its
   upstream changes amount to for them, which can differ from upstream's own.
2. **Every release names its upstream base** in the first `### Changed` bullet, as before. That
   line, not the number, says which upstream release a fork release contains.
3. **A fork major is a change the operator must act on.** It costs every install a consent tap
   (ADR 0020), so it is never spent on a renumbering again.
4. **The ADR 0038 clock reads the upstream base.** `cli/program.test.ts` takes the major from the
   newest "Built on upstream Collie X.Y.Z." line, so it fires when a sync takes upstream's 2.0.

## Consequences

- Every install crosses 1.19.3 → 2.0.0 once, by the separate major button on the phone or
  `update --major` on the machine; until then it stays on 1.19.3 with a banner naming the step.
- When upstream reaches 2.x, a fork 2.x and an upstream 2.x share numbers again. No code compares
  them: the fork's installs read only the fork's releases, crew skew is amber, and upstream's tags
  live under `refs/tags/upstream/*`. Say "fork 2.1.0" or "upstream 2.1.0".
- The sync that takes upstream 2.0 brings the alias removal with it and trips the re-keyed clock;
  that sync revisits it.
