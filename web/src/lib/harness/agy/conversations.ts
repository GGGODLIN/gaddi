// The CONVERSATIONS picker agy 1.3.5–1.4.8 paints for `/resume` (live 2026-10-15): a `CLI  Other` tab row, a
// `Conversations` title, a search row, one row per conversation with `> ` at column 0 on the
// highlighted one, an `[a-b of n items]` pager, and a two-row footer of `<key> <verb>` hints:
//
//   Keyboard: ↑/↓ Navigate  ←/→ Page  ctrl+f Grouped View  enter Select  f2 Rename  f4 Delete  tab Switch Tab
//     esc Go back / Clear search
//
// It lifts as a generic `menu` (menu-model.ts) carrying only keys the footer printed and a phone may
// fire safely: Up and Down, Enter to select, Escape to go back.
import type { MenuModel } from "../menu-model";
import { capitaliseMenuLabel } from "../menu-hints";
import { regionSignature } from "./prompt-select";

/** The detection result buildBlocks needs: the model plus the title row everything above stays raw. */
export interface ConversationsRegion {
  model: MenuModel;
  startLine: number;
  statusStartLine?: number;
}

const TITLE = /^\s*Conversations\s*$/;
const POINTER = /^> \S/;
const KEYBOARD = /^Keyboard:\s/;
// Each hint is a whole segment: a run of spaces, the `Keyboard:` label or the row's edge on both sides
// keeps `enter Select` from matching inside a conversation's title.
const hint = (text: string) => new RegExp(String.raw`(?:^\s*|\s{2,}|Keyboard:\s+)${text}(?=\s{2,}|\s*$)`);
const NAVIGATE = hint(String.raw`↑/↓ Navigate`);
const SELECT = hint("enter Select");
const GO_BACK = hint("esc Go back(?: / Clear search)?");
// Non-blank rows under the `esc` row: the model and effort status agy prints at the bottom right.
const STATUS_ROWS = 2;
const STATUS =
  /^(?:\s{8,}\S+(?: \S+)* · \S+\s*|\S+\s+(?:idle|reviewing|error|working|thinking|authenticating|merging|waiting|done)\s+\S.*|\S+(?: \S+)*\s{2,}(?:(?:auto|default|accept-edits|plan|fast|custom)\s{2,})?(?:idle|reviewing|error|working|thinking|tool_use|initializing|authenticating|merging|waiting|done)(?:\s{2,}\S.*)?)$/;
const NAMES_A_KEY = /\b(?:enter|esc(?:ape)?|space|tab|ctrl\+\S+|y\/n)\b/i;
const PROMPTS_FOR_A_KEY = /\b(?:press|hit)\s+\S+\s+to\b|\[y\/n\]|\(y\/n\)/i;
const FOOTER_ROWS = 3;
const TITLE_SCAN_ROWS = 40;

/**
 * Detect the Conversations picker at the tail of `texts`, or null.
 *
 * Fail-closed: the footer must name `↑/↓ Navigate`, `enter Select` and `esc Go back`, the title must sit
 * above it, and a conversation must be highlighted. A search with no match has no pointer, so it stays
 * raw (the unread-dialog card still offers Escape) rather than offering Select over nothing.
 */
export function detectConversationsRegion(texts: string[]): ConversationsRegion | null {
  let last = texts.length - 1;
  while (last >= 0 && texts[last]!.trim() === "") last--;
  let escRow = -1;
  let seen = 0;
  for (let i = last; i >= 0 && seen <= STATUS_ROWS; i--) {
    if (texts[i]!.trim() === "") continue;
    if (GO_BACK.test(texts[i]!)) {
      escRow = i;
      break;
    }
    if (i === last && !STATUS.test(texts[i]!)) return null;
    if (NAMES_A_KEY.test(texts[i]!)) return null;
    seen++;
  }
  if (escRow < 0) return null;

  let keyboard = -1;
  for (let i = escRow; i >= 0 && escRow - i <= FOOTER_ROWS; i--) {
    if (KEYBOARD.test(texts[i]!)) {
      keyboard = i;
      break;
    }
    if (i < escRow && !/^\s{2,}\S/.test(texts[i]!)) return null;
  }
  if (keyboard < 0) return null;
  const footer = texts.slice(keyboard, escRow + 1).join("  ");
  // At 50 columns the native footer drops navigation hints and starts with Select; the list keeps its pointer.
  if ((!NAVIGATE.test(footer) && !/^Keyboard:\s+enter Select(?:\s{2,}|$)/i.test(footer)) || !SELECT.test(footer)) {
    return null;
  }

  let top = -1;
  for (let i = keyboard - 1; i >= 0 && keyboard - i <= TITLE_SCAN_ROWS; i--) {
    if (TITLE.test(texts[i]!)) {
      top = i;
      break;
    }
  }
  if (top < 0) return null;
  const listed = texts.slice(top + 1, keyboard);
  if (!listed.some((row) => POINTER.test(row))) return null;
  if (listed.some((row) => PROMPTS_FOR_A_KEY.test(row))) return null;

  const signature = regionSignature(texts, top, last);
  if (signature === "") return null;
  return {
    model: {
      title: texts[top]!.trim(),
      actions: [
        { label: capitaliseMenuLabel("select"), keys: ["Enter"] },
        { label: capitaliseMenuLabel("go back"), keys: ["Escape"], cancel: true },
      ],
      nav: { upDown: true },
      signature,
    },
    startLine: top,
    statusStartLine: escRow + 1 < texts.length ? escRow + 1 : undefined,
  };
}
