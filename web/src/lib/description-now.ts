import { t } from "@/lib/i18n";
import type { PaneDescription } from "@/lib/types";

/**
 * A description's `now` in the phone's language. The bridge keeps `now` as one Chinese sentence for
 * the push body (bridge/description/resolve.ts); a blocked or prompt description also sends the
 * `parts` it was built from, and those are what get translated. A recap is the agent's own words,
 * and a bridge that predates `parts` sends none, so both read exactly as sent.
 */
export function descriptionNow(d: PaneDescription): string {
  const p = d.parts;
  if (p === undefined) return d.now;
  if (d.source === "prompt" && p.prompt !== undefined) return t("pane.description.prompt", { text: p.prompt });
  if (d.source !== "blocked") return d.now;
  if (p.tool === undefined) return t("pane.description.blocked");
  return t("pane.description.blockedOn", { tool: p.target === undefined ? p.tool : `${p.tool} · ${p.target}` });
}
