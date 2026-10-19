import { loadDraftEntry, saveDraft } from "./drafts";
import { appendQuote } from "./quote";
import type { Scope } from "./scope";
import type { DiffRow } from "./unified-diff";

export type DiffCodeRow = Extract<DiffRow, { kind: "context" | "add" | "del" }>;

export interface DiffComment {
  id: number;
  repo: string;
  path: string;
  /** Stable row keys from diffRowKeys(rows) that this comment covers, in file order. */
  rowKeys: readonly string[];
  /** Human-readable line range, e.g. "+12" or "+12–15" or "-8". */
  lineLabel: string;
  /** The quoted diff lines with their +/-/space prefix captured at selection time. */
  linesText: readonly string[];
  /** The operator's comment text. */
  note: string;
}

function singleLineLabel(row: DiffCodeRow): string {
  return row.newNo !== null ? `+${row.newNo}` : `-${row.oldNo ?? 1}`;
}

export function formatDiffLineLabel(rows: readonly DiffCodeRow[]): string {
  const first = rows[0];
  if (first === undefined) return "";
  if (rows.length === 1) return singleLineLabel(first);
  const last = rows.at(-1)!;
  const endNo = last.newNo ?? last.oldNo ?? 1;
  return `${singleLineLabel(first)}–${endNo}`;
}

export function captureDiffLines(rows: readonly DiffCodeRow[]): string[] {
  return rows.map((row) => {
    const sign = row.kind === "add" ? "+" : row.kind === "del" ? "-" : " ";
    return `${sign}${row.text}`;
  });
}

export function formatDiffComment(
  comment: Pick<DiffComment, "repo" | "path" | "lineLabel" | "linesText" | "note">,
): string {
  const displayPath =
    comment.repo !== "" && comment.repo !== "."
      ? `${comment.repo.replace(/\/+$/, "")}/${comment.path}`
      : comment.path;
  const codeQuote = comment.linesText
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
  return `> \`${displayPath}\` (${comment.lineLabel})\n${codeQuote}\n\n${comment.note.trim()}`;
}

export function formatDiffCommentBatch(
  comments: readonly Pick<DiffComment, "repo" | "path" | "lineLabel" | "linesText" | "note">[],
): string {
  return comments.map((c) => formatDiffComment(c)).join("\n\n");
}

export function stageDiffCommentsToDraft(
  scope: Scope | undefined,
  paneId: string,
  comments: readonly DiffComment[],
): void {
  if (comments.length === 0) return;
  const existing = loadDraftEntry(scope, paneId);
  const formatted = formatDiffCommentBatch(comments);
  const nextText = appendQuote(existing?.text ?? "", formatted);
  saveDraft(scope, paneId, nextText, existing?.attachments ?? [], existing?.next ?? 1);
}
