import { t, type MessageKey } from "@/lib/i18n";
import { descriptionNow } from "@/lib/description-now";
import type { PaneDescription as Description } from "@/lib/types";
import { useLocale } from "@/hooks/use-locale";

// THE PANE'S DESCRIPTION ON THE PANE SCREEN — goal, now, next, whichever the bridge sent. The bridge
// decides the words and their priority (bridge/description/resolve.ts); this renders them as text
// and nothing else. The labels are translated, and so is a blocked or prompt `now` through its parts
// (lib/description-now.ts); a recap's words are the agent's own and read as sent.
// Each line truncates, so a long recap never wraps the chrome above the mirror.

const ROWS: readonly { field: "goal" | "now" | "next"; label: MessageKey }[] = [
  { field: "goal", label: "pane.description.goal" },
  { field: "now", label: "pane.description.now" },
  { field: "next", label: "pane.description.next" },
];

export function PaneDescription({ description }: { description?: Description }) {
  useLocale();
  if (description === undefined) return null;
  const rows = ROWS.flatMap((r) => {
    const text = r.field === "now" ? descriptionNow(description) : description[r.field];
    return text === undefined || text === "" ? [] : [{ ...r, text }];
  });
  if (rows.length === 0) return null;
  return (
    <dl aria-label={t("pane.description.label")} className="mx-3 mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 text-xs leading-4">
      {rows.map((r) => (
        <div key={r.field} className="contents">
          <dt className="text-muted-foreground">{t(r.label)}</dt>
          <dd className="min-w-0 truncate" title={r.text}>
            {r.text}
          </dd>
        </div>
      ))}
    </dl>
  );
}
