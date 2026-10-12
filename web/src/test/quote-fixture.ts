import type { TranscriptEntry } from "@/lib/types";

import { FIXTURE_CHAT_GEN, FIXTURE_SEQ_BASE } from "./handlers";

/**
 * A Chat window for the quote case: one question, a reply with two paragraphs and a list, and a
 * second reply. The reply needs more than one block, because what a browser puts between blocks of
 * a selection is what jsdom cannot show; the second reply is there to drag across.
 */
const turns: TranscriptEntry[] = [
  { uuid: "q1", ts: "2026-10-12T03:00:00.000Z", role: "user", parts: [{ kind: "text", text: "what is the plan?" }] },
  {
    uuid: "q2",
    ts: "2026-10-12T03:00:05.000Z",
    role: "assistant",
    parts: [
      {
        kind: "text",
        text: [
          "The first paragraph explains the plan.",
          "",
          "The second paragraph names a `file.ts` chip.",
          "",
          "- one bullet",
          "- another bullet",
        ].join("\n"),
      },
    ],
  },
  { uuid: "q3", ts: "2026-10-12T03:00:09.000Z", role: "assistant", parts: [{ kind: "text", text: "A later reply." }] },
];

export const fixtureQuoteChat = {
  paneId: "w1:p1",
  available: true,
  page: "live",
  gen: FIXTURE_CHAT_GEN,
  rev: 1,
  head: FIXTURE_SEQ_BASE + turns.length - 1,
  oldest: FIXTURE_SEQ_BASE,
  hasOlder: false,
  upserts: turns.map((e, i) => Object.assign({}, e, { seq: FIXTURE_SEQ_BASE + i })),
};
