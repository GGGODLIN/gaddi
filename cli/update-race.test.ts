import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hostFor } from "../bridge/host.ts";
import { capture, context, fakeLinkFs } from "./fakes.ts";
import { EXIT } from "./io.ts";
import { type Exec, type Net, realExec, realFiles } from "./sys.ts";
import { type UpdateDeps, updateCheckout } from "./update.ts";

// A linked clone's update fetches once, pins the upstream commit, judges its major and fast-forwards
// onto that same commit. Against a real remote, a major published after the fetch must not land: a
// `git pull` in the move would fetch again and take it without consent.

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

function git(cwd: string, ...args: string[]): void {
  const r = Bun.spawnSync(["git", ...args], { cwd, env });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
}

function release(seed: string, version: string): void {
  writeFileSync(join(seed, "herdr-plugin.toml"), `id = "herdr.collie"\nversion = "${version}"\n`);
  git(seed, "add", "-A");
  git(seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", version);
  git(seed, "push", "-q", "origin", "HEAD:main");
}

function landedVersion(clone: string): string | undefined {
  return /version = "([^"]+)"/u.exec(readFileSync(join(clone, "herdr-plugin.toml"), "utf8"))?.[1];
}

/** A clone at 2.14.0 whose origin has 2.14.1; `duringPull` runs just before the pull. */
function world(duringPull: (seed: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "collie-update-race-"));
  const origin = join(dir, "origin.git");
  const seed = join(dir, "seed");
  const clone = join(dir, "clone");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  git(dir, "clone", "-q", origin, seed);
  git(seed, "checkout", "-q", "-b", "main");
  release(seed, "2.14.0");
  git(dir, "clone", "-q", origin, clone);
  release(seed, "2.14.1");

  const real = realExec(env, process.env.HOME ?? tmpdir());
  let fired = false;
  const exec: Exec = {
    ...real,
    // The origin assertion reads a GitHub URL; the remote itself is the local bare repo.
    capture: (tool, args, ...rest) =>
      tool === "git" && args.includes("get-url")
        ? { code: 0, stdout: "https://github.com/GGGODLIN/gaddi.git\n", stderr: "", found: true }
        : real.capture(tool, args, ...rest),
    runIn: (tool, args, ...rest) => {
      if (tool === "git" && args.includes("pull") && !fired) {
        fired = true;
        duringPull(seed);
      }
      return real.runIn(tool, args, ...rest);
    },
  };
  const unreachable = { ok: false, failure: { status: null, message: "no network in tests" } } as const;
  const net: Net = {
    getJson: () => Promise.resolve(unreachable),
    download: () => Promise.resolve(unreachable),
    probe: () => Promise.resolve(unreachable),
    tlsCertificate: () => Promise.resolve(unreachable),
  };
  const deps: UpdateDeps = {
    ctx: context({ COLLIE_UPDATE_REPO: "GGGODLIN/gaddi" }, { root: clone }),
    io: capture(),
    exec,
    files: realFiles,
    link: fakeLinkFs(),
    net,
    host: hostFor(process.platform),
    arch: process.arch,
    restart: () => Promise.resolve(EXIT.OK),
    now: () => 0,
    sleep: () => Promise.resolve(),
    pid: process.pid,
    execPath: process.execPath,
  };
  return { deps, clone };
}

describe("a linked clone's update against a real remote", () => {
  test("control: a release inside the major is taken", () => {
    const { deps, clone } = world(() => {});
    expect(updateCheckout(deps, { crossMajor: false }).code).toBe(EXIT.OK);
    expect(landedVersion(clone)).toBe("2.14.1");
  });

  test("a major published between the gate and the pull is not taken", () => {
    const { deps, clone } = world((seed) => release(seed, "3.0.0"));
    updateCheckout(deps, { crossMajor: false });
    expect(landedVersion(clone)).not.toBe("3.0.0");
  });
});
