import { paneScopeKey, type Scope } from "./scope";

// Manual unread holds, prefetch epochs, and the last-visited pane URL live in a dependency-free
// leaf module rather than `api.ts` or `loaders.ts` so `test/setup.ts` can reset them in `beforeEach`
// without evaluating `api.ts` or `loaders.ts` before a test file's hoisted `vi.mock("@/lib/api")`.
const unreadEpochs = new Map<string, number>();
const unreadHold = new Map<string, number>();
let lastPaneUrl: string | undefined;

export function seenEpoch(paneId: string, scope?: Scope): number {
  return unreadEpochs.get(paneScopeKey(scope, paneId)) ?? 0;
}

export function isUnreadHeld(paneId: string, scope?: Scope): boolean {
  return unreadHold.has(paneScopeKey(scope, paneId));
}

export function clearUnreadHold(paneId: string, scope?: Scope): void {
  unreadHold.delete(paneScopeKey(scope, paneId));
}

export function beginPaneSeenChange(paneId: string, seen: boolean, scope?: Scope): number {
  const key = paneScopeKey(scope, paneId);
  const nextEpoch = (unreadEpochs.get(key) ?? 0) + 1;
  unreadEpochs.set(key, nextEpoch);
  if (seen) {
    unreadHold.delete(key);
  } else {
    // Armed synchronously before the `/seen` POST leaves so overlapping mirror/chat/history polls
    // cannot re-stamp `x-collie-seen: 1` while the route is still mounted.
    unreadHold.set(key, nextEpoch);
  }
  return nextEpoch;
}

export function rollbackUnreadHold(paneId: string, epoch: number, scope?: Scope): void {
  const key = paneScopeKey(scope, paneId);
  // Only drop the hold when no newer manual toggle superseded `epoch`.
  if (unreadHold.get(key) === epoch) unreadHold.delete(key);
}

export function getLastPaneUrl(): string | undefined {
  return lastPaneUrl;
}

export function setLastPaneUrl(url: string | undefined): void {
  lastPaneUrl = url;
}

export function notePaneRouteLeft(): void {
  lastPaneUrl = undefined;
}

export function __resetSeenState(): void {
  unreadEpochs.clear();
  unreadHold.clear();
  lastPaneUrl = undefined;
}
