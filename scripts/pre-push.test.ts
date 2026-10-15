// Tests for scripts/git-hooks/pre-push's `collie.prepush=ci` switch, the fork's one way to leave an
// ordinary push to CI.
//
// The switch is only safe because of what it refuses to skip: CI runs on Linux alone, so a push that
// carries a `chore(release):` commit still runs the typechecks and suites on this machine, and so
// does a push whose range the hook cannot read. A case that let either through would ship a release
// nobody tested on a Mac, so most cases here pin a refusal to skip, not the skip itself.
//
// Every case runs the real hook against a THROWAWAY repository, with a fake `bun` first on PATH that
// records what it was asked to run, and stand-ins for the two scripts the hook shells out to. The
// hook finds its repository with `git rev-parse --show-toplevel` from its working directory, so it
// is run in place rather than copied. bash, sh and the fake are POSIX; the Windows suites skip it.

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const HOOK = join(import.meta.dir, "git-hooks", "pre-push");
const ZERO = "0".repeat(40);
const UNKNOWN = "1234567890abcdef1234567890abcdef12345678";

// A test run inside a git hook inherits GIT_DIR and friends, which would point every git call below
// at the developer's own checkout instead of the fixture.
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

let root = "";
let repo = "";
let log = "";
const sha = { base: "", release: "", after: "" };

function git(...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd: repo, env: baseEnv });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

interface Run {
  code: number;
  err: string;
  calls: string;
}

function push(lines: string, mode: string | null, bunExit = 0): Run {
  if (mode === null) Bun.spawnSync(["git", "config", "--unset", "collie.prepush"], { cwd: repo, env: baseEnv });
  else git("config", "collie.prepush", mode);
  rmSync(log, { force: true });
  const r = Bun.spawnSync(["bash", HOOK], {
    cwd: repo,
    stdin: Buffer.from(lines),
    env: {
      ...baseEnv,
      PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
      FAKE_LOG: log,
      FAKE_BUN_EXIT: String(bunExit),
    },
  });
  return { code: r.exitCode ?? -1, err: r.stderr.toString(), calls: existsSync(log) ? readFileSync(log, "utf8") : "" };
}

const line = (local: string, remote: string) => `refs/heads/dev ${local} refs/heads/dev ${remote}\n`;

function ranEverything(r: Run): void {
  expect(r.calls).toContain("bun run typecheck");
  expect(r.calls).toContain("bun test ./bridge");
  expect(r.calls).toContain("ctl");
  expect(r.calls).toContain("bun run test");
}

describe.skipIf(process.platform === "win32")("pre-push collie.prepush=ci", () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "collie-pre-push-"));
    repo = join(root, "repo");
    log = join(root, "calls.log");
    mkdirSync(join(root, "bin"));
    mkdirSync(join(repo, "web"), { recursive: true });
    mkdirSync(join(repo, "scripts"));
    writeFileSync(join(root, "bin", "bun"), '#!/bin/sh\necho "bun $*" >> "$FAKE_LOG"\nexit "${FAKE_BUN_EXIT:-0}"\n');
    chmodSync(join(root, "bin", "bun"), 0o755);
    writeFileSync(join(repo, "scripts", "collie-ctl.test.sh"), 'echo ctl >> "$FAKE_LOG"\n');
    writeFileSync(join(repo, "scripts", "check-tag.sh"), "exit 0\n");
    git("init", "-q", "-b", "dev");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "test");
    git("config", "commit.gpgsign", "false");
    git("add", ".");
    git("commit", "-q", "-m", "feat: base");
    sha.base = git("rev-parse", "HEAD");
    git("commit", "-q", "--allow-empty", "-m", "chore(release): 1.0.0");
    sha.release = git("rev-parse", "HEAD");
    git("commit", "-q", "--allow-empty", "-m", "fix: after");
    sha.after = git("rev-parse", "HEAD");
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("without the switch every push runs the typechecks and suites", () => {
    const r = push(line(sha.after, sha.release), null);
    expect(r.code).toBe(0);
    ranEverything(r);
  });

  test("with the switch an ordinary push leaves them to CI", () => {
    const r = push(line(sha.after, sha.release), "ci");
    expect(r.code).toBe(0);
    expect(r.calls).toBe("");
    expect(r.err).toContain("left to CI");
  });

  test("a push carrying a release commit still runs them here, tip or not", () => {
    ranEverything(push(line(sha.after, sha.base), "ci"));
    ranEverything(push(line(sha.release, sha.base), "ci"));
  });

  test("one ref with a release commit among several runs them", () => {
    const lines = `refs/heads/x ${sha.after} refs/heads/x ${sha.release}\n${line(sha.after, sha.base)}`;
    ranEverything(push(lines, "ci"));
  });

  test("a new branch is judged by what no remote holds yet", () => {
    git("update-ref", "refs/remotes/origin/dev", sha.release);
    try {
      expect(push(line(sha.after, ZERO), "ci").calls).toBe("");
    } finally {
      git("update-ref", "-d", "refs/remotes/origin/dev");
    }
    ranEverything(push(line(sha.after, ZERO), "ci"));
  });

  test("a range the hook cannot read runs everything", () => {
    ranEverything(push(line(sha.after, UNKNOWN), "ci"));
  });

  test("a value other than ci runs everything and says so", () => {
    const r = push(line(sha.after, sha.release), "yes");
    ranEverything(r);
    expect(r.err).toContain("collie.prepush=yes");
  });

  test("a failing suite still refuses a release push", () => {
    expect(push(line(sha.after, sha.base), "ci", 1).code).not.toBe(0);
  });
});
