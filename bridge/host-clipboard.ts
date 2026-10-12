import { createOperatorFileReader, diskIo, type OperatorFileIo } from "./operator-file.ts";

// The host's system clipboard, offered to the phone (ADR 9010).
//
// This is the third exception to "the bridge spawns no child for content", beside STT and retell,
// and it has the retell shape: it exists only while the operator's `clipboard.toml` names two
// commands, and every use is ONE short-lived child with the operator's fixed argv, never a shell,
// never a daemon, never an argument the phone chose.
//
// Two commands, because they answer different questions at very different costs. `count` says
// whether the clipboard changed (macOS: NSPasteboard.changeCount) and runs at most once per
// VERSION_CACHE_MS however many phones poll. `read` returns the text: once per counter, kept only as
// whether text came out, and again each time a phone opens the clipboard sheet. Nothing else is kept:
// no history, no copy of the text in memory between requests. A history would hold what a password manager already cleared (the GPT-6 Pro review of
// 2026-10-11), and nobody asked for one.
//
// There is no bridge timer. A phone that is not looking asks nothing, so a closed app costs the
// host nothing; the phone keeps its own "seen" mark and compares it to the version it reads.

/** The operator's `clipboard.toml`, parsed. */
export interface HostClipboardConfig {
  /** Prints the clipboard's change counter, an integer, and nothing else. */
  readonly count: readonly string[];
  /** Prints the clipboard's text. */
  readonly read: readonly string[];
}

/** One child at most this long, then it is killed. The commands answer in tens of milliseconds. */
export const CLIPBOARD_TIMEOUT_MS = 5_000;
/** How long a child asked to stop may take before it is killed outright. */
export const CLIPBOARD_KILL_GRACE_MS = 1_000;
/** The largest text the phone is shown. Past it the answer says so rather than cutting the text. */
export const CLIPBOARD_MAX_TEXT_BYTES = 256 * 1024;
/** A counter is a number; anything this long is not one. */
const COUNT_MAX_BYTES = 64;
/** However many phones poll, the count command runs at most once in this window. */
export const VERSION_CACHE_MS = 4_000;
/** How much of a child's own words a failure carries to the phone. */
const REASON_CHARS = 300;

/**
 * ```toml
 * count = ["/usr/bin/osascript", "-l", "JavaScript", "-e",
 *          "ObjC.import('AppKit'); $.NSPasteboard.generalPasteboard.changeCount"]
 * read = ["/usr/bin/pbpaste"]
 * ```
 *
 * Arrays, not shell lines: nothing is split or interpreted. Both keys or neither — a file naming
 * only one is a mistake worth a warning, not half a feature. Returns zero rows or one.
 */
export function validateHostClipboardConfig(
  doc: { count?: unknown; read?: unknown } | null | undefined,
  warn = defaultWarn,
): HostClipboardConfig[] {
  if (doc === null || doc === undefined) return [];
  if (doc.count === undefined && doc.read === undefined) return [];
  const count = argvOf(doc, "count", warn);
  const read = argvOf(doc, "read", warn);
  if (count === null || read === null) return [];
  return [{ count, read }];
}

function argvOf(
  doc: { count?: unknown; read?: unknown },
  key: "count" | "read",
  warn: (message: string) => void,
): string[] | null {
  const value = doc[key];
  if (!Array.isArray(value) || value.length === 0) {
    warn(`\`${key}\` must be a non-empty array of strings — the clipboard stays off`);
    return null;
  }
  const argv: string[] = [];
  for (const part of value) {
    if (typeof part !== "string" || part === "" || part.includes("\0")) {
      warn(`\`${key}\` holds a value that is not a non-empty string — the clipboard stays off`);
      return null;
    }
    argv.push(part);
  }
  return argv;
}

function defaultWarn(message: string): void {
  console.warn(`[clipboard] ${message}`);
}

export function createOperatorHostClipboard(
  path: string,
  io: OperatorFileIo = diskIo,
  warn = defaultWarn,
): () => Promise<HostClipboardConfig[]> {
  return createOperatorFileReader(path, validateHostClipboardConfig, io, warn);
}

export interface ClipboardChild {
  readonly exited: Promise<number>;
  /** Rejects when the child writes more than the cap it was started with. */
  readonly stdout: Promise<Uint8Array>;
  readonly stderr: Promise<string>;
  kill(signal?: number): void;
}

export type ClipboardSpawn = (argv: readonly string[], maxBytes: number) => ClipboardChild;

class OverCap extends Error {}

async function readCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > max) throw new OverCap(`output over ${max} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export const bunClipboardSpawn: ClipboardSpawn = (argv, maxBytes) => {
  // A launchd job may have no LANG, and pbpaste then decodes in a legacy encoding, so a Chinese
  // clipboard would arrive as `?`. UTF-8 is only filled in when the bridge's own env names none.
  const env = { ...process.env, LANG: process.env.LANG ?? "en_US.UTF-8" };
  const child = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env });
  return {
    exited: child.exited,
    stdout: readCapped(child.stdout, maxBytes),
    stderr: readCapped(child.stderr, 4096).then((bytes) => new TextDecoder().decode(bytes), () => ""),
    kill: (signal) => child.kill(signal),
  };
};

export type ChildOutcome =
  | { readonly ok: true; readonly stdout: Uint8Array }
  | { readonly ok: false; readonly kind: "too-large" }
  | { readonly ok: false; readonly kind: "failed"; readonly reason: string };

function oneLine(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, REASON_CHARS);
}

/** Run one child to its end or the timeout, whichever is first. Never throws. */
export async function runClipboardChild(
  spawn: ClipboardSpawn,
  argv: readonly string[],
  maxBytes: number,
  timeoutMs = CLIPBOARD_TIMEOUT_MS,
  graceMs = CLIPBOARD_KILL_GRACE_MS,
): Promise<ChildOutcome> {
  const name = argv[0] ?? "command";
  let child: ClipboardChild;
  try {
    child = spawn(argv, maxBytes);
  } catch (err) {
    return { ok: false, kind: "failed", reason: `could not start ${name}: ${String(err)}` };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  let done: [number, Uint8Array, string] | "timeout";
  try {
    done = await Promise.race([Promise.all([child.exited, child.stdout, child.stderr]), timedOut]);
  } catch (err) {
    clearTimeout(timer);
    child.kill(9);
    if (err instanceof OverCap) return { ok: false, kind: "too-large" };
    return { ok: false, kind: "failed", reason: `${name}: ${err instanceof Error ? err.message : String(err)}` };
  }
  clearTimeout(timer);
  if (done === "timeout") {
    child.kill();
    let grace: ReturnType<typeof setTimeout> | undefined;
    const stopped = await Promise.race([
      child.exited.then(() => true),
      new Promise<boolean>((resolve) => {
        grace = setTimeout(() => resolve(false), graceMs);
      }),
    ]);
    clearTimeout(grace);
    if (!stopped) child.kill(9);
    return { ok: false, kind: "failed", reason: `${name} did not answer within ${Math.round(timeoutMs / 1000)}s` };
  }
  const [code, stdout, stderr] = done;
  if (code !== 0) {
    const reason = oneLine(stderr);
    return { ok: false, kind: "failed", reason: reason === "" ? `${name} exited with status ${code}` : `${name} exited with status ${code}: ${reason}` };
  }
  return { ok: true, stdout };
}

/** The counter as the count command printed it, or null when what it printed is not one. */
export function parseCount(stdout: Uint8Array): string | null {
  const text = new TextDecoder().decode(stdout).trim();
  return /^\d{1,20}$/.test(text) ? text : null;
}

export type VersionResult = { readonly ok: true; readonly version: string } | { readonly ok: false; readonly reason: string };

/**
 * The counter, and whether the sheet would find text under it. `text` is false for an empty
 * clipboard, an image, a file, and a clipboard that lists text it cannot hand over: a phone told of
 * such a change opened the sheet onto nothing (2026-10-12).
 */
export type CheckedVersion = { readonly ok: true; readonly version: string; readonly text: boolean } | { readonly ok: false; readonly reason: string };

export type ReadResult =
  | { readonly ok: true; readonly text: string; readonly bytes: number; readonly version: string }
  | { readonly ok: false; readonly kind: "empty"; readonly version: string }
  | { readonly ok: false; readonly kind: "too-large"; readonly version: string }
  | { readonly ok: false; readonly kind: "failed"; readonly reason: string };

export interface HostClipboard {
  /**
   * The change counter, cached for {@link VERSION_CACHE_MS}, and whether text is readable under it.
   * `null` while no `clipboard.toml`.
   */
  version(): Promise<CheckedVersion | null>;
  /** The text as it is now. `null` while no `clipboard.toml`. */
  read(): Promise<ReadResult | null>;
}

export function createHostClipboard(
  getConfig: () => Promise<HostClipboardConfig[]>,
  spawn: ClipboardSpawn = bunClipboardSpawn,
  now: () => number = Date.now,
): HostClipboard {
  let cached: { at: number; result: VersionResult } | null = null;
  let inflight: Promise<VersionResult> | null = null;
  // One read per counter, kept as a yes or no and never as the text, so the phone is told of a
  // change only when its sheet would show something. A counter that does not move is not read again.
  let checked: { version: string; text: boolean } | null = null;
  let checking: Promise<{ version: string; text: boolean }> | null = null;

  async function countNow(config: HostClipboardConfig): Promise<VersionResult> {
    const run = await runClipboardChild(spawn, config.count, COUNT_MAX_BYTES);
    if (!run.ok) return { ok: false, reason: run.kind === "too-large" ? "count printed more than a number" : run.reason };
    const version = parseCount(run.stdout);
    return version === null ? { ok: false, reason: "count did not print a number" } : { ok: true, version };
  }

  async function freshVersion(config: HostClipboardConfig): Promise<VersionResult> {
    // One child for every poller in the window: three phones polling cost one `count`, not three.
    if (inflight) return inflight;
    inflight = countNow(config).then((result) => {
      cached = { at: now(), result };
      return result;
    });
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  async function readOnce(config: HostClipboardConfig): Promise<ReadResult | "moved"> {
    const before = await freshVersion(config);
    if (!before.ok) return { ok: false, kind: "failed", reason: before.reason };
    const run = await runClipboardChild(spawn, config.read, CLIPBOARD_MAX_TEXT_BYTES);
    const after = await freshVersion(config);
    if (!after.ok) return { ok: false, kind: "failed", reason: after.reason };
    // The text belongs to the version it was read under only if nothing wrote in between.
    if (after.version !== before.version) return "moved";
    if (!run.ok) return run.kind === "too-large" ? { ok: false, kind: "too-large", version: after.version } : run;
    const text = new TextDecoder().decode(run.stdout);
    if (text === "") return { ok: false, kind: "empty", version: after.version };
    return { ok: true, text, bytes: run.stdout.byteLength, version: after.version };
  }

  async function readSettled(config: HostClipboardConfig): Promise<ReadResult> {
    // Once more if a write landed mid-read; a clipboard that keeps moving is said to, not guessed.
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await readOnce(config);
      if (result !== "moved") return result;
    }
    return { ok: false, kind: "failed", reason: "the clipboard changed while it was being read" };
  }

  async function check(config: HostClipboardConfig, version: string): Promise<{ version: string; text: boolean }> {
    if (checked?.version === version) return checked;
    if (checking) return checking;
    checking = readSettled(config).then((result) => {
      // Too large is still text: the sheet says where to find it, which is not an empty answer.
      const text = result.ok || result.kind === "too-large";
      checked = { version: result.ok || result.kind !== "failed" ? result.version : version, text };
      return checked;
    });
    try {
      return await checking;
    } finally {
      checking = null;
    }
  }

  return {
    async version() {
      const [config] = await getConfig();
      if (!config) return null;
      const counted = cached && now() - cached.at < VERSION_CACHE_MS ? cached.result : await freshVersion(config);
      if (!counted.ok) return counted;
      const { version, text } = await check(config, counted.version);
      return { ok: true, version, text };
    },
    async read() {
      const [config] = await getConfig();
      if (!config) return null;
      return readSettled(config);
    },
  };
}
