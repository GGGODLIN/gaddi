import { useEffect, useState } from "react";
import { Check, Clipboard, Loader2, RotateCw, X } from "lucide-react";

import { BottomSheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { StripSlot } from "@/components/ui/strip-host";
import { UnseenMark } from "@/components/ui/unseen-mark";
import { useLocale } from "@/hooks/use-locale";
import { useTick } from "@/hooks/use-tick";
import { copyText } from "@/lib/clipboard";
import { timeAgo } from "@/lib/format";
import { noteCopiedToPhone, useHostClipboard, useHostClipboardPoll } from "@/lib/host-clipboard";
import { t } from "@/lib/i18n";
import { CLIPBOARD } from "@/lib/strip-priority";

// The host clipboard on the phone (ADR 9010): a banner while there is news, a header button that
// keeps the unseen mark after the banner is put down (DESIGN.md §11's second surface), and one sheet
// that reads the text when it opens. The text is never fetched before the sheet asks for it, so
// nothing about it is on this phone until the operator opens the sheet.

/** The largest text the bridge shows, for the too-large sentence. Mirrors CLIPBOARD_MAX_TEXT_BYTES. */
const MAX_TEXT_LABEL = "256 KB";

export function HostClipboardStrip() {
  useLocale();
  // The one poller. This component is mounted for the app's life and renders nothing when quiet,
  // the UpdateRibbon's shape, so the counter is asked once per interval however many screens show.
  useHostClipboardPoll();
  const clip = useHostClipboard();
  // Re-rendered every half minute while it shows, so "2 minutes ago" does not stay "just now".
  const now = useTick(clip.banner, 30_000);
  if (!clip.banner) return null;
  return (
    <StripSlot priority={CLIPBOARD}>
      <Notice
        tone="info"
        variant="strip"
        announce="status"
        icon={<Clipboard />}
        onActivate={clip.open}
        dismissLabel={t("hostClipboard.dismiss")}
        onDismiss={clip.dismiss}
      >
        {t("hostClipboard.changed", { ago: timeAgo(clip.since ?? now, now) })}
      </Notice>
    </StripSlot>
  );
}

/** The header's clipboard button: the permanent way in, carrying the unseen mark. */
export function HostClipboardButton() {
  useLocale();
  const clip = useHostClipboard();
  if (!clip.enabled) return null;
  return (
    <button
      type="button"
      onClick={clip.open}
      aria-label={t("hostClipboard.title")}
      // The SettingsGear's own 44px box, beside which it sits (app-header.tsx explains the size).
      className="relative grid size-11 shrink-0 place-items-center text-muted-foreground transition-colors hover:text-foreground"
    >
      <Clipboard className="size-5" />
      <UnseenMark on={clip.unseen} size="sm" label={t("hostClipboard.unseen")} className="absolute right-2 top-2" />
    </button>
  );
}

/** Mounted once, by the app root. The read is started by the tap that opens it (lib/host-clipboard.ts). */
export function HostClipboardSheet() {
  useLocale();
  const clip = useHostClipboard();
  const { reading } = clip;
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");

  // The per-control echo goes back to its label after a moment, as every copy control's does.
  useEffect(() => {
    if (copy === "idle") return;
    const timer = setTimeout(() => setCopy("idle"), 2_000);
    return () => clearTimeout(timer);
  }, [copy]);

  // Called straight from the tap: an async function runs up to its first await at once, so
  // copyText's legacy path still runs inside the user gesture it needs.
  async function copyToPhone(text: string) {
    try {
      await copyText(text);
      setCopy("copied");
      // Near the computer, this copy comes back to it and moves the counter (ADR 9010).
      noteCopiedToPhone(text);
    } catch {
      setCopy("failed");
    }
  }

  const result = reading.phase === "done" ? reading.result : null;
  return (
    <BottomSheet open={clip.sheetOpen} onClose={clip.close} title={t("hostClipboard.title")}>
      {reading.phase === "loading" && (
        <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("hostClipboard.loading")}
        </p>
      )}
      {result?.ok === true && reading.phase === "done" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {t("hostClipboard.meta", { chars: String([...result.text].length), ago: timeAgo(reading.at) })}
          </p>
          <pre className="max-h-[45dvh] overflow-auto rounded-sm border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere">
            {result.text}
          </pre>
          <Button
            onClick={() => void copyToPhone(result.text)}
          >
            {copy === "copied" ? <Check aria-hidden /> : copy === "failed" ? <X aria-hidden /> : <Clipboard aria-hidden />}
            {copy === "copied" ? t("hostClipboard.copied") : copy === "failed" ? t("hostClipboard.copyFailed") : t("hostClipboard.copy")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("hostClipboard.note")}</p>
        </div>
      )}
      {result?.ok === false && result.kind === "empty" && (
        <Notice variant="box" tone="neutral">
          {t("hostClipboard.empty")}
        </Notice>
      )}
      {result?.ok === false && result.kind === "too-large" && (
        <Notice variant="box" tone="caution">
          {t("hostClipboard.tooLarge", { size: MAX_TEXT_LABEL })}
        </Notice>
      )}
      {result?.ok === false && result.kind === "failed" && (
        <Notice variant="box" tone="danger" announce="alert">
          {t("hostClipboard.failed", { reason: result.reason })}
        </Notice>
      )}
      {reading.phase === "error" && (
        <Notice variant="box" tone="danger" announce="alert">
          {t("hostClipboard.failed", { reason: reading.reason })}
        </Notice>
      )}
      {reading.phase !== "loading" && (
        <Button variant="outline" size="sm" className="mt-3 self-start" onClick={() => {
            setCopy("idle");
            clip.reread();
          }}>
          <RotateCw aria-hidden />
          {t("hostClipboard.reread")}
        </Button>
      )}
    </BottomSheet>
  );
}
