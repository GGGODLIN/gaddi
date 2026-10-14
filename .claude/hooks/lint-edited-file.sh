#!/usr/bin/env bash
#
# PostToolUse hook: lint the file that was just written or edited.
#
# The point is feedback latency. Without this, a lint violation survives until
# `bun run lint` runs — by which time the assistant has usually moved on and the
# fix is a context reload. Linting the single edited file costs ~30ms and puts
# the finding in front of the model while it still has the file in mind.
#
# Exit code 2 is the Claude Code convention for "block and show stderr to the
# model", which is what turns this from a log line into a correction.
#
# This is a CONVENIENCE, not the authority. It shells out to the same root
# `.oxlintrc.json` every other surface uses — no flags of its own — but only the
# full-tree runs (CI and `collie build`) define "passing". A single-file run can
# miss a cross-file finding; it never gets to declare the tree green.
#
# PILOT — watch the first real sessions before trusting this blindly. It ships
# blocking because the tree is already green, so it can only fire on a NEW
# violation. The thing to watch for is `anti-slop/require-safety-comment-for-
# type-assertion` teaching agents to write a rote, content-free `// SAFETY:`
# comment ("safe: trust me") purely to clear the rule instead of stating the
# actual invariant. If that is what shows up, either tighten the rule so the
# comment must name the invariant that makes the assertion sound, or drop the
# rule at triage — do not leave a gamed rule standing. (M8 spec
# 04-enforcement-surfaces.md, "Pilot the Claude Code PostToolUse hook".)

set -uo pipefail

cd "$CLAUDE_PROJECT_DIR" || exit 0

file=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$file" ] && exit 0

case "$file" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs) ;;
  *) exit 0 ;;
esac

[ -f "$file" ] || exit 0

# A file outside this checkout is judged by where it lives, not by where the hook runs. oxlint
# picks the nearest `.oxlintrc.json` above the file, so a file in a `git worktree` of this repo
# found the worktree's config, whose plugin import cannot resolve without that worktree's own
# `node_modules`, and every edit there was blocked with a module error instead of a finding. A
# worktree of this repo is linted under this checkout's config; a file in no repo or in another
# repo is not ours to lint.
config_args=()
root=$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null) || exit 0
if [ "$root" != "$(pwd -P)" ] && [ "$root" != "$CLAUDE_PROJECT_DIR" ]; then
  theirs=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  ours=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  [ -n "$theirs" ] && [ "$theirs" = "$ours" ] || exit 0
  config_args=(-c "$CLAUDE_PROJECT_DIR/.oxlintrc.json")
fi

# Vendored plugin sources are excluded in .oxlintrc.json, but naming a file on the
# command line overrides that ignore — so skip the spawn entirely.
case "$file" in
  */tools/oxlint/anti-slop/* | tools/oxlint/anti-slop/* | */contrib/* | contrib/*) exit 0 ;;
esac

# Same config, same flags as `bun run lint`; only the file set narrows.
# The `+` form, because bash 3.2 (macOS) treats an empty array as unbound under `set -u`.
if ! output=$(bunx oxlint --max-warnings 0 ${config_args[@]+"${config_args[@]}"} "$file" 2>&1); then
  {
    echo "oxlint found issues in ${file#"$CLAUDE_PROJECT_DIR"/}:"
    echo
    echo "$output"
    echo
    echo "Fix the code — do not downgrade a rule or add a suppression comment."
  } >&2
  exit 2
fi

exit 0
