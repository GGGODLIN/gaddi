import { describe, expect, test } from "bun:test";

import {
  bunClipboardSpawn,
  createHostClipboard,
  parseCount,
  runClipboardChild,
  validateHostClipboardConfig,
  type ClipboardChild,
  type ClipboardSpawn,
  type HostClipboardConfig,
} from "./host-clipboard.ts";

const CONFIG: HostClipboardConfig = { count: ["count-cmd"], read: ["read-cmd"] };
const configured = async () => [CONFIG];
const absent = async () => [];
const bytes = (s: string) => new TextEncoder().encode(s);

function child(stdout: string, code = 0, stderr = ""): ClipboardChild {
  return {
    exited: Promise.resolve(code),
    stdout: Promise.resolve(bytes(stdout)),
    stderr: Promise.resolve(stderr),
    kill() {},
  };
}

/** A scripted spawn: `count` answers from the list in turn, `read` from its own. */
function scripted(counts: string[], reads: ClipboardChild[]) {
  const calls: string[] = [];
  const spawn: ClipboardSpawn = (argv) => {
    const name = argv[0]!;
    calls.push(name);
    if (name === "count-cmd") return child(counts.shift() ?? "0");
    return reads.shift() ?? child("");
  };
  return { spawn, calls };
}

describe("validateHostClipboardConfig", () => {
  const quiet = () => {};

  test("no file and an empty table mean off, without a warning", () => {
    const warned: string[] = [];
    expect(validateHostClipboardConfig(null, (m) => warned.push(m))).toEqual([]);
    expect(validateHostClipboardConfig({}, (m) => warned.push(m))).toEqual([]);
    expect(warned).toEqual([]);
  });

  test("both arrays make one row", () => {
    expect(validateHostClipboardConfig({ count: ["a", "-x"], read: ["b"] }, quiet)).toEqual([
      { count: ["a", "-x"], read: ["b"] },
    ]);
  });

  test("only one of the two keys is a mistake worth saying, and stays off", () => {
    const warned: string[] = [];
    expect(validateHostClipboardConfig({ read: ["/usr/bin/pbpaste"] }, (m) => warned.push(m))).toEqual([]);
    expect(warned.join()).toContain("`count`");
  });

  test("a shell line, an empty array or an empty string is refused", () => {
    expect(validateHostClipboardConfig({ count: "pbpaste | wc", read: ["b"] }, quiet)).toEqual([]);
    expect(validateHostClipboardConfig({ count: [], read: ["b"] }, quiet)).toEqual([]);
    expect(validateHostClipboardConfig({ count: ["a"], read: [""] }, quiet)).toEqual([]);
    expect(validateHostClipboardConfig({ count: ["a"], read: [1] }, quiet)).toEqual([]);
  });
});

describe("parseCount", () => {
  test("a counter with its newline is the counter", () => {
    expect(parseCount(bytes("1049\n"))).toBe("1049");
  });
  test("anything that is not a bare number is not a counter", () => {
    expect(parseCount(bytes(""))).toBeNull();
    expect(parseCount(bytes("12 34"))).toBeNull();
    expect(parseCount(bytes("error: no pasteboard"))).toBeNull();
  });
});

describe("runClipboardChild", () => {
  test("a non-zero exit is a failure that names the command and its words", async () => {
    const out = await runClipboardChild(() => child("", 1, "no such file\n"), ["/bin/x"], 100);
    expect(out).toEqual({ ok: false, kind: "failed", reason: "/bin/x exited with status 1: no such file" });
  });

  test("a child that never answers is killed and the timeout is named", async () => {
    const killed: (number | undefined)[] = [];
    const hung: ClipboardSpawn = () => ({
      exited: new Promise<number>(() => {}),
      stdout: new Promise<Uint8Array>(() => {}),
      stderr: new Promise<string>(() => {}),
      kill: (signal) => killed.push(signal),
    });
    const out = await runClipboardChild(hung, ["/usr/bin/pbpaste"], 100, 10, 10);
    expect(out).toEqual({ ok: false, kind: "failed", reason: "/usr/bin/pbpaste did not answer within 0s" });
    expect(killed).toEqual([undefined, 9]);
  });

  test("a spawn that throws is a failure, never a throw", async () => {
    const out = await runClipboardChild(() => {
      throw new Error("ENOENT");
    }, ["/nope"], 100);
    expect(out.ok).toBe(false);
  });
});

describe("createHostClipboard", () => {
  test("no clipboard.toml answers null to both questions and runs nothing", async () => {
    const { spawn, calls } = scripted([], []);
    const clip = createHostClipboard(absent, spawn);
    expect(await clip.version()).toBeNull();
    expect(await clip.read()).toBeNull();
    expect(calls).toEqual([]);
  });

  test("the count runs once per window however often it is asked", async () => {
    let clock = 1_000;
    const { spawn, calls } = scripted(["7", "8"], []);
    const clip = createHostClipboard(configured, spawn, () => clock);
    expect(await clip.version()).toEqual({ ok: true, version: "7" });
    clock += 1_000;
    expect(await clip.version()).toEqual({ ok: true, version: "7" });
    clock += 4_000;
    expect(await clip.version()).toEqual({ ok: true, version: "8" });
    expect(calls).toEqual(["count-cmd", "count-cmd"]);
  });

  test("a count that prints no number says so", async () => {
    const { spawn } = scripted(["not a number"], []);
    expect(await createHostClipboard(configured, spawn).version()).toEqual({
      ok: false,
      reason: "count did not print a number",
    });
  });

  test("a read returns the text with the version it was read under", async () => {
    const { spawn } = scripted(["5", "5"], [child("請貼到設定欄")]);
    expect(await createHostClipboard(configured, spawn).read()).toEqual({
      ok: true,
      text: "請貼到設定欄",
      bytes: bytes("請貼到設定欄").byteLength,
      version: "5",
    });
  });

  test("an empty clipboard is its own answer, not empty text", async () => {
    const { spawn } = scripted(["5", "5"], [child("")]);
    expect(await createHostClipboard(configured, spawn).read()).toEqual({ ok: false, kind: "empty", version: "5" });
  });

  test("a write landing mid-read is read again, and a clipboard that keeps moving is said to", async () => {
    const once = scripted(["5", "6", "6", "6"], [child("old"), child("new")]);
    expect(await createHostClipboard(configured, once.spawn).read()).toMatchObject({ ok: true, text: "new", version: "6" });

    const always = scripted(["1", "2", "3", "4"], [child("a"), child("b")]);
    expect(await createHostClipboard(configured, always.spawn).read()).toEqual({
      ok: false,
      kind: "failed",
      reason: "the clipboard changed while it was being read",
    });
  });

  test("text over the cap is too large, never a cut half", async () => {
    // The real spawn and a real child that writes past the cap, so the cap that trips is the
    // module's own. Bun itself is the writer: `/usr/bin/yes` is not on a Windows runner.
    const counts = ["5", "5"];
    const writer = [process.execPath, "-e", "process.stdout.write('x'.repeat(1024 * 1024))"];
    const spawn: ClipboardSpawn = (argv, maxBytes) =>
      argv[0] === "count-cmd" ? child(counts.shift() ?? "5") : bunClipboardSpawn(writer, maxBytes);
    expect(await createHostClipboard(configured, spawn).read()).toEqual({ ok: false, kind: "too-large", version: "5" });
  });
});
