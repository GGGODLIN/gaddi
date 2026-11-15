import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { fetchFilesDir } from "@/lib/api";
import { dirUnderRoot } from "@/lib/file-paths";
import { resolveAtQuery, suggestFiles, type AtToken, type FileSuggestion } from "@/lib/file-suggest";
import type { Scope } from "@/lib/scope";
import type { FileEntry } from "@/lib/types";

/** How long one folder's listing stays fresh in memory for `@` completion. */
export const FILE_SUGGEST_TTL_MS = 30_000;
const MAX_FOLDER_CACHE = 64;

interface PaneRootEntry {
  readonly root: string | null;
  readonly unavailable: boolean;
  readonly at: number;
}

interface FolderEntry {
  readonly state: "ready" | "loading" | "missing" | "unavailable";
  readonly entries: readonly FileEntry[];
  readonly at: number;
}

const EMPTY_ENTRIES: readonly FileEntry[] = [];
const LOADING_FOLDER: FolderEntry = { state: "loading", entries: EMPTY_ENTRIES, at: 0 };
const MISSING_FOLDER: FolderEntry = { state: "missing", entries: EMPTY_ENTRIES, at: 0 };
const UNAVAILABLE_FOLDER: FolderEntry = { state: "unavailable", entries: EMPTY_ENTRIES, at: 0 };

const paneRoots = new Map<string, PaneRootEntry>();
const folderCache = new Map<string, FolderEntry>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

function subscribeStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isFresh(at: number): boolean {
  return Date.now() - at < FILE_SUGGEST_TTL_MS;
}

function freshPaneRoot(paneKey: string): PaneRootEntry | null {
  const held = paneRoots.get(paneKey);
  if (held === undefined) return null;
  if (!isFresh(held.at)) {
    paneRoots.delete(paneKey);
    return null;
  }
  return held;
}

function rememberFolder(dirKey: string, entries: readonly FileEntry[]): void {
  folderCache.delete(dirKey);
  folderCache.set(dirKey, { state: "ready", entries, at: Date.now() });
  while (folderCache.size > MAX_FOLDER_CACHE) {
    const oldest = folderCache.keys().next().value;
    if (oldest === undefined) break;
    folderCache.delete(oldest);
  }
}

function readFolderEntry(paneKey: string, dirKey: string | null): FolderEntry {
  if (dirKey === null) return MISSING_FOLDER;
  const rootEntry = freshPaneRoot(paneKey);
  if (rootEntry?.unavailable === true) return UNAVAILABLE_FOLDER;
  const cached = folderCache.get(dirKey);
  if (cached !== undefined) {
    if (isFresh(cached.at)) return cached;
    folderCache.delete(dirKey);
  }
  if (inFlight.has(dirKey)) return LOADING_FOLDER;
  return MISSING_FOLDER;
}

async function requestFolder(
  paneId: string,
  host: string,
  session: string,
  paneKey: string,
  apiDir: string,
  dirKey: string,
): Promise<void> {
  if (inFlight.has(dirKey)) return;
  const current = readFolderEntry(paneKey, dirKey);
  if (current.state === "ready" || current.state === "unavailable") return;

  inFlight.add(dirKey);
  notifyListeners();

  const requestScope: Scope = {};
  if (host !== "") requestScope.host = host;
  if (session !== "") requestScope.session = session;

  try {
    const answer = await fetchFilesDir({ kind: "pane", paneId }, apiDir, requestScope);
    if (answer.outcome === "body") {
      if (!answer.body.available) {
        paneRoots.set(paneKey, { root: null, unavailable: true, at: Date.now() });
      } else {
        paneRoots.set(paneKey, { root: answer.body.root, unavailable: false, at: Date.now() });
        rememberFolder(dirKey, answer.body.entries);
      }
    } else if (answer.outcome === "unknown-path") {
      rememberFolder(dirKey, EMPTY_ENTRIES);
    } else {
      paneRoots.set(paneKey, { root: null, unavailable: true, at: Date.now() });
    }
  } catch {
    rememberFolder(dirKey, EMPTY_ENTRIES);
  } finally {
    inFlight.delete(dirKey);
    notifyListeners();
  }
}

export function __resetFileSuggestionsCache(): void {
  paneRoots.clear();
  folderCache.clear();
  inFlight.clear();
}

export interface FileSuggestionsInput {
  activeAt: AtToken | null;
  paneId: string;
  scope: Scope | undefined;
  cwd: string | undefined;
  /** The pane's `cwd` relative to the Files root when already known on the pane view. */
  filesDir?: string | null;
}

export interface FileSuggestionsResult {
  suggestions: readonly FileSuggestion[];
  loading: boolean;
}

/**
 * Single-folder `@` file suggestions for an agent pane (#757), reusing `GET /api/pane/:id/files?dir=`
 * within ADR 0083's no-walk bound and caching each read for 30s per `(host, session, paneId, dir)`.
 */
export function useFileSuggestions({
  activeAt,
  paneId,
  scope,
  cwd,
  filesDir,
}: FileSuggestionsInput): FileSuggestionsResult {
  const host = scope?.host ?? "";
  const session = scope?.session ?? "";
  const paneKey = `${host}\0${session}\0${paneId}`;

  const getRootEntry = useCallback(() => freshPaneRoot(paneKey), [paneKey]);
  const rootEntry = useSyncExternalStore(subscribeStore, getRootEntry, getRootEntry);

  const baseDir = useMemo(() => {
    if (filesDir !== undefined && filesDir !== null && filesDir !== "") return filesDir;
    if (rootEntry?.root !== undefined && rootEntry.root !== null) {
      return dirUnderRoot(rootEntry.root, cwd) ?? "";
    }
    return "";
  }, [filesDir, rootEntry, cwd]);

  const resolved = useMemo(
    () => (activeAt === null ? null : resolveAtQuery(activeAt.raw, baseDir)),
    [activeAt, baseDir],
  );
  const dirKey = resolved === null ? null : `${paneKey}\0${resolved.apiDir}`;

  const getFolder = useCallback(() => readFolderEntry(paneKey, dirKey), [paneKey, dirKey]);
  const folder = useSyncExternalStore(subscribeStore, getFolder, getFolder);

  const apiDir = resolved?.apiDir ?? null;
  useEffect(() => {
    if (apiDir === null || dirKey === null || folder.state !== "missing") return;
    void requestFolder(paneId, host, session, paneKey, apiDir, dirKey);
  }, [paneId, host, session, paneKey, apiDir, dirKey, folder.state]);

  const suggestions = useMemo(() => {
    if (resolved === null || folder.state !== "ready") return [];
    return suggestFiles(folder.entries, resolved.insertPrefix, resolved.query);
  }, [resolved, folder]);

  return {
    suggestions,
    loading: resolved !== null && (folder.state === "missing" || folder.state === "loading"),
  };
}
