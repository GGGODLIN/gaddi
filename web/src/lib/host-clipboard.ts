import { useEffect, useSyncExternalStore } from "react";

import { fetchHostClipboardVersion, readHostClipboard, type HostClipboardText } from "./api";
import { asJsonNumber, asJsonObject, asJsonString, parseJsonObject } from "./json";
import { useHostClipboardEnabled } from "./operator-config";

// Whether the host clipboard changed since THIS device last looked (ADR 9010).
//
// The bridge only reports a counter. Which value this phone has seen is the phone's own, kept in
// localStorage, so two phones each get their own banner and the bridge holds no per-device state.
// The very first read is a baseline, not news: a phone that has never looked has nothing to be told
// it missed, and a fresh install must not open on a banner about a clipboard nobody mentioned.
//
// Polled only while the app is visible. A hidden or closed app asks nothing, which is the point of
// doing this in the app rather than through a push: the host runs no clipboard command for a phone
// that is not looking.

const STORAGE_KEY = "collie:host-clipboard:v1";
/** The bridge answers from a 4 s cache, so a poll faster than this would read the same value. */
export const HOST_CLIPBOARD_POLL_MS = 10_000;

/** What this device remembers. Counters only: the text is never stored. */
export interface ClipboardMarks {
  /** The counter this device has seen, or read in the sheet. */
  readonly seen: string;
  /** A newer counter, and when this device first noticed it. */
  readonly pending: { readonly version: string; readonly since: number } | null;
  /** The pending counter whose banner the operator closed. The header dot stays. */
  readonly dismissed: string | null;
}

/**
 * Fold one counter reading into the marks. Pure, so the whole rule is a table of cases in a test.
 * A counter the sheet would find no text under is seen at once: news that opens onto nothing is
 * worse than none, and whatever was pending before it has been overwritten.
 */
export function foldVersion(marks: ClipboardMarks | null, version: string, now: number, text = true): ClipboardMarks {
  if (marks === null || !text) return { seen: version, pending: null, dismissed: null };
  if (version === marks.seen) return { seen: marks.seen, pending: null, dismissed: null };
  if (marks.pending?.version === version) return marks;
  return { seen: marks.seen, pending: { version, since: now }, dismissed: null };
}

export function markSeen(version: string): ClipboardMarks {
  return { seen: version, pending: null, dismissed: null };
}

export function dismissBanner(marks: ClipboardMarks): ClipboardMarks {
  return marks.pending === null ? marks : { ...marks, dismissed: marks.pending.version };
}

/** Unseen news: the header dot. */
export function hasUnseen(marks: ClipboardMarks | null): boolean {
  return marks?.pending != null;
}

/** Unseen and not put down: the banner. */
export function showsBanner(marks: ClipboardMarks | null): boolean {
  return marks?.pending != null && marks.dismissed !== marks.pending.version;
}

function readMarks(): ClipboardMarks | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  return raw === null ? null : parseMarks(raw);
}

/** A stored value this build wrote, or null for anything else: a bad value is a baseline, not news. */
export function parseMarks(raw: string): ClipboardMarks | null {
  const obj = parseJsonObject(raw);
  const seen = asJsonString(obj?.seen);
  if (obj === undefined || seen === undefined) return null;
  const dismissed = obj.dismissed === null ? null : asJsonString(obj.dismissed);
  if (dismissed === undefined) return null;
  if (obj.pending === null) return { seen, pending: null, dismissed };
  const pending = asJsonObject(obj.pending);
  const version = asJsonString(pending?.version);
  const since = asJsonNumber(pending?.since);
  if (version === undefined || since === undefined) return null;
  return { seen, pending: { version, since }, dismissed };
}

function writeMarks(marks: ClipboardMarks): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
  } catch {
    // Private mode or a full store: the banner still works for this page's life, it just forgets.
  }
}

/** What the sheet shows. The text lives here only while the sheet is open, and is dropped on close. */
export type ClipboardReading =
  | { readonly phase: "loading" }
  | { readonly phase: "done"; readonly result: HostClipboardText; readonly at: number }
  | { readonly phase: "error"; readonly reason: string };

interface State {
  readonly marks: ClipboardMarks | null;
  readonly sheetOpen: boolean;
  readonly reading: ClipboardReading;
}

const LOADING: ClipboardReading = { phase: "loading" };

let state: State = { marks: readMarks(), sheetOpen: false, reading: LOADING };
const listeners = new Set<() => void>();

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  if (next.marks !== undefined && next.marks !== null) writeMarks(next.marks);
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const read = () => state;

let ticket = 0;

/**
 * Read the text now. Started by the tap that opens the sheet, or by "Read again", never by an
 * effect: the read is the operator's act. A reply that lands after the sheet closed is dropped.
 */
async function readNow(): Promise<void> {
  const mine = ++ticket;
  set({ reading: LOADING });
  let next: ClipboardReading;
  try {
    const result = await readHostClipboard();
    next = { phase: "done", result, at: Date.now() };
  } catch (err) {
    next = { phase: "error", reason: err instanceof Error ? err.message : String(err) };
  }
  if (mine !== ticket) return;
  // What the sheet now shows is the news the banner was about, so the news is seen. A clipboard that
  // would not be read puts the pending news down too: the banner has nothing more to offer.
  const version =
    next.phase !== "done"
      ? null
      : next.result.ok || next.result.kind !== "failed"
        ? next.result.version
        : (state.marks?.pending?.version ?? null);
  set(version === null ? { reading: next } : { reading: next, marks: markSeen(version) });
}

/**
 * How long after "Copy to this phone" a change may be this phone's own copy coming back. With the
 * phone near the computer, Universal Clipboard carries the copy to the Mac in about a second, and
 * the counter moves as if the computer had copied something new.
 */
export const BOUNCE_WINDOW_MS = 30_000;

/** What this phone just copied, held in memory only, for one comparison inside the window. */
let copied: { readonly text: string; readonly until: number } | null = null;

/** The sheet copied `text` to this phone. */
export function noteCopiedToPhone(text: string, now = Date.now()): void {
  copied = { text, until: now + BOUNCE_WINDOW_MS };
}

/**
 * Whether a new counter needs one read to rule out the bounce: only inside the window, and only for
 * a counter this device has not already seen or pended. Pure, so the window is a table in a test.
 */
export function needsBounceCheck(
  marks: ClipboardMarks | null,
  version: string,
  copy: { readonly until: number } | null,
  now: number,
): boolean {
  if (copy === null || now > copy.until || marks === null) return false;
  return version !== marks.seen && marks.pending?.version !== version;
}

/** One poll. Exported for the store's own tests; the app polls through {@link useHostClipboardPoll}. */
export async function pollHostClipboard(): Promise<void> {
  try {
    const got = await fetchHostClipboardVersion();
    if (!got.ok) return;
    const now = Date.now();
    const copy = copied;
    if (got.text && copy !== null && needsBounceCheck(state.marks, got.version, copy, now)) {
      // The one read outside the sheet, and it is caused by the operator's own copy: identical text
      // is that copy coming back, not news. Anything else, a failed read included, is news.
      const expected = copy.text;
      copied = null;
      const back = await readHostClipboard().catch(() => null);
      if (back?.ok === true && back.text === expected) {
        set({ marks: markSeen(back.version) });
        return;
      }
    }
    if (copied !== null && now > copied.until) copied = null;
    set({ marks: foldVersion(state.marks, got.version, now, got.text) });
  } catch {
    // A failed poll changes nothing: no banner from a guess, and the next poll tries again.
  }
}

/**
 * Poll while mounted, enabled and visible. Mounted once, by the app root; the counter is per host
 * and the banner is app-wide, so a second poller would only double the requests.
 */
export function useHostClipboardPoll(): void {
  const enabled = useHostClipboardEnabled();
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer !== null || document.visibilityState !== "visible") return;
      void pollHostClipboard();
      timer = setInterval(() => void pollHostClipboard(), HOST_CLIPBOARD_POLL_MS);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}

export function useHostClipboard() {
  const enabled = useHostClipboardEnabled();
  const { marks, sheetOpen, reading } = useSyncExternalStore(subscribe, read, read);
  return {
    enabled,
    unseen: enabled && hasUnseen(marks),
    banner: enabled && showsBanner(marks),
    since: marks?.pending?.since ?? null,
    sheetOpen: enabled && sheetOpen,
    reading,
    open: () => {
      set({ sheetOpen: true });
      void readNow();
    },
    reread: () => void readNow(),
    close: () => {
      ticket += 1;
      set({ sheetOpen: false, reading: LOADING });
    },
    dismiss: () => {
      if (state.marks !== null) set({ marks: dismissBanner(state.marks) });
    },
  };
}

/** Test helper — reset module state between cases. */
export function __resetHostClipboard(): void {
  ticket += 1;
  copied = null;
  state = { marks: readMarks(), sheetOpen: false, reading: LOADING };
}
