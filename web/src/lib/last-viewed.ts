import { useEffect, useState } from "react";

import { paneRowKey } from "./hosts";
import { asJsonObject, asJsonString, parseJson } from "./json";
import { panePlaceParts } from "./pane-name";
import type { AgentView } from "./types";

// The last few panes opened on this device, newest first, so the attention switcher can offer a
// single one-tap "Last viewed" row at the top (excluding the pane currently open when the switcher
// is pulled up from inside a pane).
//
// Keyed by `{ row: paneRowKey(pane), space: panePlaceParts(pane).space }` for the same reason
// `lib/pins.ts` and `lib/slots.ts` carry the workspace name: multiplexer pane ids are reused across
// workspaces and restarts, and an id now belonging to another workspace must not read as the pane
// the operator was just looking at.
//
// Read directly from `localStorage` on each access (like `lib/slots.ts` and `lib/pairing.ts`) so a
// wipe in another tab cannot be resurrected from a stale module cache; `fallback` is consulted only
// when `localStorage` itself is blocked or throws.

const STORAGE_KEY = "collie:last-viewed:v1";

/** Keep a short tail behind the top slot so excluding the open pane or a closed pane still finds the previous one. */
export const MAX_LAST_VIEWED = 4;

export interface LastViewed {
  readonly row: string;
  readonly space: string;
}

const NONE: readonly LastViewed[] = [];

/** Used only when `localStorage` is unavailable or throws (locked-down / private storage). */
let fallback: readonly LastViewed[] = NONE;

function decode(raw: string | null): readonly LastViewed[] {
  if (raw === null) return NONE;
  const doc = parseJson(raw);
  if (!Array.isArray(doc)) return NONE;
  const out: LastViewed[] = [];
  for (const item of doc) {
    const rec = asJsonObject(item);
    const row = asJsonString(rec?.row);
    const space = asJsonString(rec?.space);
    if (row === undefined || space === undefined || row === "") continue;
    if (out.some((entry) => entry.row === row)) continue;
    out.push({ row, space });
    if (out.length >= MAX_LAST_VIEWED) break;
  }
  return out;
}

/** The device's recent-viewed trail, newest first. */
export function currentLastViewed(): readonly LastViewed[] {
  try {
    const store = globalThis.localStorage;
    if (!store) return fallback;
    return decode(store.getItem(STORAGE_KEY));
  } catch {
    return fallback;
  }
}

function save(next: readonly LastViewed[]): void {
  try {
    const store = globalThis.localStorage;
    if (!store) {
      fallback = next;
      return;
    }
    store.setItem(STORAGE_KEY, JSON.stringify(next));
    fallback = NONE;
  } catch {
    fallback = next;
  }
}

/** Record that the operator opened `(row, space)` on this device. */
export function recordLastViewed(row: string, space: string): void {
  if (row === "") return;
  const entries = currentLastViewed();
  if (entries[0]?.row === row && entries[0]?.space === space) return;
  const next: LastViewed[] = [{ row, space }];
  for (const prev of entries) {
    if (prev.row === row) continue;
    next.push(prev);
    if (next.length >= MAX_LAST_VIEWED) break;
  }
  save(next);
}

/** Convenience wrapper around {@link recordLastViewed} for a live {@link AgentView}. */
export function notePaneViewed(pane: AgentView): void {
  recordLastViewed(paneRowKey(pane), panePlaceParts(pane).space);
}

/**
 * Pick the single most recently viewed live pane from `panes`, skipping `currentPaneKey` (when the
 * switcher was opened from inside a pane) and any record whose id was reused in another workspace.
 */
export function resolveLastViewed(
  records: readonly LastViewed[],
  panes: readonly AgentView[],
  currentPaneKey: string,
): AgentView | undefined {
  if (records.length === 0 || panes.length === 0) return undefined;
  const byRow = new Map<string, AgentView>();
  for (const pane of panes) byRow.set(paneRowKey(pane), pane);
  for (const rec of records) {
    if (rec.row === currentPaneKey) continue;
    const live = byRow.get(rec.row);
    if (live !== undefined && panePlaceParts(live).space === rec.space) return live;
  }
  return undefined;
}

/** Remember each live pane route visited on this device (`routes/root.tsx`). */
export function useLastViewedMemory(pane: AgentView | undefined): void {
  const row = pane === undefined ? "" : paneRowKey(pane);
  const space = pane === undefined ? "" : panePlaceParts(pane).space;
  useEffect(() => {
    if (row !== "") recordLastViewed(row, space);
  }, [row, space]);
}

/**
 * Freeze the recent-viewed trail when the attention switcher opens (ADR 0063 / ADR 9004) and return
 * the single non-current live pane to show at the top.
 */
export function useLastViewedShortcut(
  enabled: boolean,
  panes: readonly AgentView[],
  currentPaneKey: string,
): AgentView | undefined {
  const [frozen] = useState<readonly LastViewed[]>(() => (enabled ? currentLastViewed() : NONE));
  if (!enabled) return undefined;
  return resolveLastViewed(frozen, panes, currentPaneKey);
}

/** Forget every remembered pane on unpair/revoke/expiry (`lib/wipe.ts`). */
export function forgetLastViewed(): void {
  fallback = NONE;
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Locked-down storage: nothing persisted to remove.
  }
}

/** Test seam: clear both fallback memory and storage between cases (`test/setup.ts`). */
export function __resetLastViewed(): void {
  forgetLastViewed();
}

/** Test seam: retained for explicit reload symmetry in tests. */
export function __reloadLastViewed(): void {
  fallback = NONE;
}
