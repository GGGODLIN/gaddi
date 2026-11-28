import { describe, expect, test } from "bun:test";

import { hostFor } from "../bridge/host.ts";
import { CODESIGN_IDENTIFIER, CODESIGN_IDENTITY_ENV, CODESIGN_TIMEOUT_MS, signLocalBinary } from "./codesign.ts";
import { fakeExec } from "./fakes.ts";

const BIN = "/opt/collie/bin/collie.new";
const ID = "0123456789ABCDEF0123456789ABCDEF01234567";

function run(env: Record<string, string>, platform: "darwin" | "linux", scripted: Parameters<typeof fakeExec>[0] = {}) {
  const exec = fakeExec(scripted);
  const warnings: string[] = [];
  const outcome = signLocalBinary(BIN, env, hostFor(platform), exec, (line) => warnings.push(line));
  return { outcome, calls: exec.calls, timeouts: exec.timeouts, warnings };
}

describe("signLocalBinary: a local macOS build keeps one code identity across updates", () => {
  test("unset: nothing runs and nothing is said", () => {
    const r = run({}, "darwin");
    expect(r.outcome).toBe("unset");
    expect(r.calls).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  test("a blank value reads as unset", () => {
    expect(run({ [CODESIGN_IDENTITY_ENV]: "   " }, "darwin").calls).toEqual([]);
  });

  test("set on macOS: codesign signs the staged binary with the fixed identifier, bounded", () => {
    const r = run({ [CODESIGN_IDENTITY_ENV]: ID }, "darwin");
    expect(r.outcome).toBe("signed");
    expect(r.calls).toEqual([`codesign --force --sign ${ID} --identifier ${CODESIGN_IDENTIFIER} ${BIN}`]);
    expect(r.timeouts).toEqual([{ call: r.calls[0] ?? "", ms: CODESIGN_TIMEOUT_MS }]);
    expect(r.warnings).toEqual([]);
  });

  test("set off macOS: skipped, and the reason is said", () => {
    const r = run({ [CODESIGN_IDENTITY_ENV]: ID }, "linux");
    expect(r.outcome).toBe("not-macos");
    expect(r.calls).toEqual([]);
    expect(r.warnings.join("\n")).toContain("not macOS");
  });

  test("codesign refuses: the build goes on unsigned and says why", () => {
    const r = run({ [CODESIGN_IDENTITY_ENV]: ID }, "darwin", {
      answers: [["codesign", { code: 1, stderr: "error: The specified item could not be found in the keychain.\n" }]],
    });
    expect(r.outcome).toBe("failed");
    expect(r.warnings.join("\n")).toContain("could not be found in the keychain");
    expect(r.warnings.join("\n")).toContain("unsigned");
  });

  test("codesign past its bound: a waiting keychain prompt is named", () => {
    const r = run({ [CODESIGN_IDENTITY_ENV]: ID }, "darwin", { answers: [["codesign", { code: 124 }]] });
    expect(r.outcome).toBe("failed");
    expect(r.warnings.join("\n")).toContain("keychain");
  });

  test("codesign missing: failed, with the reason", () => {
    const r = run({ [CODESIGN_IDENTITY_ENV]: ID }, "darwin", { absent: ["codesign"] });
    expect(r.outcome).toBe("failed");
    expect(r.warnings.join("\n")).toContain("codesign not found");
  });
});
