// Fork-only (FORK.md "A local macOS build signs bin/collie with the operator's identity").
//
// macOS privacy (TCC) knows an ad-hoc signed binary only by its content hash, so every update's
// fresh bin/collie is a new program and asks again for the Desktop folder. Until someone answers,
// the bridge's file reads wait on that prompt and every paired request hangs while /api/health
// still answers (fork 2.17.4, 2026-11-28: 25 minutes). Signed with one identity and one identifier,
// each version is the same program to TCC, and the operator's one "Allow" carries over.

import type { Host } from "../bridge/host.ts";
import type { Environment } from "./context.ts";
import type { Exec } from "./sys.ts";

/** The `.env` name holding the signing identity: a certificate's SHA-1 or its full name. */
export const CODESIGN_IDENTITY_ENV = "COLLIE_CODESIGN_IDENTITY";

/** One identifier for every build, so TCC's designated requirement does not move between versions. */
export const CODESIGN_IDENTIFIER = "com.gggodlin.gaddi.collie";

/** A keychain prompt nobody answers must not hold the update's build stage. */
export const CODESIGN_TIMEOUT_MS = 60_000;

export type SignOutcome = "unset" | "not-macos" | "signed" | "failed";

/**
 * Sign the freshly compiled binary at `path` when the operator named an identity. A failure never
 * fails the build: the binary stays ad-hoc signed, as every build was before, and the line says why.
 */
export function signLocalBinary(
  path: string,
  env: Environment,
  host: Host,
  exec: Pick<Exec, "capture">,
  warn: (line: string) => void,
): SignOutcome {
  const identity = env[CODESIGN_IDENTITY_ENV]?.trim() ?? "";
  if (identity === "") return "unset";
  if (host.platform !== "darwin") {
    warn(`warn: ${CODESIGN_IDENTITY_ENV} is set, but this is not macOS — the binary is not re-signed`);
    return "not-macos";
  }
  const r = exec.capture(
    "codesign",
    ["--force", "--sign", identity, "--identifier", CODESIGN_IDENTIFIER, path],
    CODESIGN_TIMEOUT_MS,
  );
  if (r.found && r.code === 0) return "signed";
  const reason = !r.found
    ? "codesign not found"
    : r.code === 124
      ? `codesign did not finish in ${CODESIGN_TIMEOUT_MS / 1000} s (a keychain prompt may be waiting for an answer)`
      : (r.stderr.trim().split("\n")[0] ?? "") || `codesign exited ${r.code}`;
  warn(`warn: could not sign the collie binary with ${CODESIGN_IDENTITY_ENV}: ${reason}`);
  warn("      it stays unsigned, so macOS may ask again for folder access after this update");
  return "failed";
}
