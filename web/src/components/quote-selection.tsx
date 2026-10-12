import { TextQuote } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/hooks/use-locale";
import { t } from "@/lib/i18n";
import { quoteLines } from "@/lib/quote";

/** Marks an element whose text a selection may quote: an agent's reply, never the operator's own turn. */
const QUOTE_SOURCE = "data-quote-source";

function sourceOf(node: Node | null): Element | null {
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  return element?.closest(`[${QUOTE_SOURCE}]`) ?? null;
}

/** The current selection as a quote, when both of its ends sit inside the same quotable reply. */
function selectedQuote(): string | null {
  const selection = document.getSelection();
  if (selection === null || selection.isCollapsed) return null;
  const source = sourceOf(selection.anchorNode);
  if (source === null || source !== sourceOf(selection.focusNode)) return null;
  return quoteLines(selection.toString());
}

interface QuoteSelectionProps {
  /** False while the composer cannot take text: a gone pane, read-only, a host block. */
  enabled: boolean;
  onQuote: (quoted: string) => void;
}

/**
 * A "Quote" button over the composer while text in one agent reply is selected. iOS draws its own
 * Copy menu beside the selection and a page cannot add to it, so the button stands apart from it.
 * The quote is taken when the finger lands, because a tap elsewhere may clear the selection before
 * the click arrives; lifting the finger off the button cancels.
 */
export function QuoteSelection({ enabled, onQuote }: QuoteSelectionProps): ReactNode {
  useLocale();
  const [quoted, setQuoted] = useState<string | null>(null);
  const held = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const read = () => {
      if (held.current === null) setQuoted(selectedQuote());
    };
    document.addEventListener("selectionchange", read);
    return () => document.removeEventListener("selectionchange", read);
  }, [enabled]);
  if (!enabled || quoted === null) return null;
  const release = () => {
    held.current = null;
    setQuoted(selectedQuote());
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="absolute right-3 bottom-full z-10 mb-2 bg-card shadow-md"
      onPointerDown={(e) => {
        // Keeps the selection (and the focus) where it is on a mouse; a touch may clear it anyway.
        e.preventDefault();
        held.current = quoted;
      }}
      onPointerCancel={release}
      onPointerLeave={() => {
        if (held.current !== null) release();
      }}
      onClick={() => {
        const text = held.current ?? quoted;
        held.current = null;
        setQuoted(null);
        document.getSelection()?.removeAllRanges();
        onQuote(text);
      }}
    >
      <TextQuote aria-hidden />
      {t("quote.selection")}
    </Button>
  );
}
