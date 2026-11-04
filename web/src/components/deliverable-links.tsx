import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { DeliverableContext } from "@/components/markdown-text";
import { FileContent, type FileImages, type FileText } from "@/components/file-preview";
import { BottomSheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/hooks/use-locale";
import {
  fetchDeliverableBytes,
  fetchDeliverablePreview,
  fetchDeliverables,
  isApiErrorStatus,
  type DeliverableListItem,
  type DeliverablePreview,
} from "@/lib/api";
import { t } from "@/lib/i18n";
import type { LinkTarget } from "@/components/markdown-text";
import type { Scope } from "@/lib/scope";

// A file URL in the agent's own reply (ADR 9006). The phone asks once which links this session
// named, then opens one by its id. The id is not a path, and the token never rides in the URL.
// No journal, or a crew member this round does not forward, leaves the short title: a dead button
// is worse than the text the reply already showed. The sheet stays on the pane, so Back closes it
// before it leaves, and the composer underneath is not unmounted.

const RETRY_MS = 30_000;

interface DeliverableSnapshot {
  lookup: (href: string) => DeliverableListItem | null;
}

interface DeliverableLinksHandle {
  opener: (href: string) => LinkTarget | null;
  dismiss: () => boolean;
  sheet: ReactNode;
}

type SheetBody =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; preview: DeliverablePreview };

class DeliverableStore {
  private readonly load: (signal: AbortSignal) => Promise<DeliverableListItem[] | "quiet" | "refuse">;
  private readonly byHref = new Map<string, DeliverableListItem>();
  private readonly missing = new Map<string, number>();
  private readonly wanted = new Set<string>();
  /** Id a preview already refused for this href. The list must not hand that same id back. */
  private readonly deadIds = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller = new AbortController();
  private attached = false;
  private refused = false;
  private quietUntil = 0;
  private inflight = false;
  private onAnswer: () => void = () => {};
  /** A fresh object when a wanted link becomes known, so a memoised opener runs again. */
  snapshot: DeliverableSnapshot = { lookup: (href) => this.lookup(href) };

  constructor(load: (signal: AbortSignal) => Promise<DeliverableListItem[] | "quiet" | "refuse">) {
    this.load = load;
  }

  subscribe(onAnswer: () => void): () => void {
    this.attached = true;
    this.onAnswer = onAnswer;
    if (this.controller.signal.aborted) this.controller = new AbortController();
    if (this.wanted.size > 0) this.arm();
    return () => {
      this.attached = false;
      this.onAnswer = () => {};
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
      this.controller.abort();
    };
  }

  /** The item, or null when this href is not one the reply named. Queues a fetch on the way. */
  lookup(href: string): DeliverableListItem | null {
    const known = this.byHref.get(href);
    if (known !== undefined) return known;
    this.want(href);
    return null;
  }

  private want(href: string): void {
    const missed = this.missing.get(href);
    if (missed !== undefined && Date.now() - missed < RETRY_MS) return;
    if (this.refused || Date.now() < this.quietUntil) return;
    this.wanted.add(href);
    if (!this.inflight) this.arm();
  }

  private arm(): void {
    if (!this.attached || this.timer !== null || this.inflight || this.refused) return;
    // A quiet or failed list leaves `wanted` full. Arming at the coalesce delay would ask
    // again every tick, so the next ask waits out the quiet window.
    const quietLeft = this.quietUntil - Date.now();
    this.timer = setTimeout(() => void this.flush(), quietLeft > 0 ? quietLeft : 150);
  }

  /**
   * The preview refused `deadId`. The pane's mux session need not have changed — the agent
   * session is not that field — so drop the href and ask the list once more. The same id
   * refused twice does not ask again.
   */
  revive(href: string, deadId: string): void {
    if (this.refused) return;
    const known = this.byHref.get(href);
    if (known !== undefined && known.id !== deadId) return;
    this.byHref.delete(href);
    if (this.deadIds.get(href) === deadId) return;
    this.deadIds.set(href, deadId);
    this.missing.delete(href);
    this.wanted.add(href);
    if (!this.inflight) this.arm();
  }

  private async flush(): Promise<void> {
    this.timer = null;
    if (!this.attached || this.refused) return;
    this.inflight = true;
    const signal = this.controller.signal;
    try {
      const answer = await this.load(signal);
      if (signal.aborted) return;
      if (answer === "refuse") {
        this.refused = true;
        return;
      }
      if (answer === "quiet") {
        this.quietUntil = Date.now() + RETRY_MS;
        return;
      }
      let found = false;
      for (const href of this.wanted) {
        const item = answer.find((candidate) => candidate.href === href);
        // Caching the id the preview just refused would send the sheet at it again.
        if (item === undefined || item.id === this.deadIds.get(href)) this.missing.set(href, Date.now());
        else {
          this.byHref.set(href, item);
          this.missing.delete(href);
          this.deadIds.delete(href);
          found = true;
        }
      }
      this.wanted.clear();
      if (found) {
        this.snapshot = { lookup: (href) => this.lookup(href) };
        this.onAnswer();
      }
    } catch {
      if (!signal.aborted) this.quietUntil = Date.now() + RETRY_MS;
    } finally {
      this.inflight = false;
      if (this.attached && this.wanted.size > 0 && !this.refused) this.arm();
    }
  }
}

export function useDeliverableLinks(paneId: string, scope?: Scope): DeliverableLinksHandle {
  const host = scope?.host;
  const session = scope?.session;
  const store = useMemo(() => {
    const at: Scope = {};
    if (host !== undefined) at.host = host;
    if (session !== undefined) at.session = session;
    return new DeliverableStore(async (signal) => {
      try {
        const body = await fetchDeliverables(paneId, at, signal);
        if (!body.available) return "quiet";
        return body.items;
      } catch (error) {
        if (isApiErrorStatus(error, 501) || isApiErrorStatus(error, 404)) return "refuse";
        throw error;
      }
    });
  }, [paneId, host, session]);
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);
  const read = useCallback(() => store.snapshot, [store]);
  const snapshot = useSyncExternalStore(subscribe, read, read);
  const [open, setOpen] = useState<{ href: string; id: string; title: string } | null>(null);
  const opener = useCallback(
    (href: string): LinkTarget | null => {
      const item = snapshot.lookup(href);
      if (item === null) return null;
      return {
        kind: "local",
        href: "#",
        onOpen: () => setOpen({ href: item.href, id: item.id, title: item.title }),
      };
    },
    [snapshot],
  );
  // A 404 drops the cached id. Until the list names a new one, keep the open target so the
  // sheet stays up; once it does, the sheet reads that id instead of the one it 404'd.
  const resolved = open === null ? null : snapshot.lookup(open.href);
  const target = useMemo(() => {
    if (open === null) return null;
    if (resolved === null || resolved.id === open.id) return open;
    return { href: open.href, id: resolved.id, title: resolved.title };
  }, [open, resolved]);
  const onUnavailable = useCallback(
    (href: string, id: string) => {
      store.revive(href, id);
    },
    [store],
  );
  const dismiss = useCallback(() => {
    if (open === null) return false;
    setOpen(null);
    return true;
  }, [open]);
  const sheet = (
    <DeliverableSheet
      paneId={paneId}
      scope={scope}
      target={target}
      onClose={() => setOpen(null)}
      onUnavailable={onUnavailable}
    />
  );
  return { opener, dismiss, sheet };
}

/** Wraps a pane's text so its file links can open, and draws the sheet over that same screen. */
export function DeliverableLinks({
  paneId,
  scope,
  dismissRef,
  children,
}: {
  paneId: string;
  scope?: Scope;
  /** Set to the current dismiss, so the screen's Back closes the sheet before leaving. */
  dismissRef?: { current: (() => boolean) | null };
  children: ReactNode;
}) {
  const links = useDeliverableLinks(paneId, scope);
  useEffect(() => {
    if (dismissRef === undefined) return;
    dismissRef.current = links.dismiss;
    return () => {
      dismissRef.current = null;
    };
  }, [dismissRef, links.dismiss]);
  return (
    <DeliverableContext.Provider value={links.opener}>
      {children}
      {links.sheet}
    </DeliverableContext.Provider>
  );
}

function matchesAscii(bytes: Uint8Array, offset: number, ascii: string): boolean {
  if (bytes.length < offset + ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

function sniffDeliverableImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (matchesAscii(bytes, 0, "GIF87a") || matchesAscii(bytes, 0, "GIF89a")) {
    return "image/gif";
  }
  if (matchesAscii(bytes, 0, "RIFF") && matchesAscii(bytes, 8, "WEBP")) {
    return "image/webp";
  }
  if (matchesAscii(bytes, 4, "ftypavif") || matchesAscii(bytes, 4, "ftypavis")) {
    return "image/avif";
  }
  return null;
}

function DeliverableSheet({
  paneId,
  scope,
  target,
  onClose,
  onUnavailable,
}: {
  paneId: string;
  scope?: Scope;
  target: { href: string; id: string; title: string } | null;
  onClose: () => void;
  onUnavailable: (href: string, id: string) => void;
}) {
  useLocale();
  const [body, setBody] = useState<SheetBody>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<"too-large" | "failed" | null>(null);
  const host = scope?.host;
  const session = scope?.session;
  useEffect(() => {
    if (target === null) return;
    const ac = new AbortController();
    setBody({ kind: "loading" });
    setSaveError(null);
    const run = async () => {
      try {
        const preview = await fetchDeliverablePreview(paneId, target.id, scope, ac.signal);
        if (!ac.signal.aborted) setBody({ kind: "ready", preview });
      } catch (error) {
        if (ac.signal.aborted) return;
        if (isApiErrorStatus(error, 404)) onUnavailable(target.href, target.id);
        if (ac.signal.aborted) return;
        setBody({ kind: isApiErrorStatus(error, 404) ? "missing" : "error" });
      }
    };
    void run();
    return () => ac.abort();
  }, [paneId, host, session, scope, target, onUnavailable]);
  const download = async () => {
    if (target === null || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const blob = await fetchDeliverableBytes(paneId, target.id, scope);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = target.title;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setSaveError(isApiErrorStatus(error, 413) ? "too-large" : "failed");
    } finally {
      setSaving(false);
    }
  };
  const ready = body.kind === "ready" ? body.preview : null;
  const images = useMemo<FileImages>(
    () => ({
      bytes: async (_path, signal) => {
        if (target === null || ready === null) return { outcome: "failed" };
        if (!ready.downloadable) return { outcome: "too-large" };
        try {
          const rawBlob = await fetchDeliverableBytes(paneId, target.id, scope, signal);
          const head = new Uint8Array(await rawBlob.slice(0, 32).arrayBuffer());
          const type = sniffDeliverableImageType(head);
          if (type === null) return { outcome: "not-image" };
          return { outcome: "image", blob: new Blob([rawBlob], { type }) };
        } catch (error) {
          if (signal.aborted) throw error;
          if (isApiErrorStatus(error, 413)) return { outcome: "too-large" };
          return { outcome: "failed" };
        }
      },
      text: async () => null,
    }),
    [paneId, ready, scope, target],
  );
  const file: FileText | null =
    ready === null
      ? null
      : {
          available: true,
          root: "",
          path: ready.name,
          size: ready.size,
          binary: ready.binary,
          truncated: ready.truncated,
          text: ready.text,
        };
  return (
    <BottomSheet open={target !== null} onClose={onClose} title={target?.title ?? ""}>
      {body.kind === "loading" && <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("files.loading")}</p>}
      {body.kind === "missing" && <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("files.unknown.file")}</p>}
      {body.kind === "error" && <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("files.file.error")}</p>}
      {file !== null && ready !== null && (
        <>
          <FileContent file={file} view="preview" images={images} />
          {!ready.downloadable && <p className="px-4 pt-3 text-xs text-muted-foreground">{t("deliverable.tooLarge")}</p>}
          {ready.downloadable && (
            <div className="px-4 py-3">
              <Button type="button" variant="outline" onClick={() => void download()} disabled={saving}>
                {t("deliverable.download")}
              </Button>
              {saveError === "too-large" && <p className="pt-2 text-xs text-muted-foreground">{t("deliverable.tooLarge")}</p>}
              {saveError === "failed" && <p className="pt-2 text-xs text-muted-foreground">{t("files.file.error")}</p>}
            </div>
          )}
        </>
      )}
    </BottomSheet>
  );
}
