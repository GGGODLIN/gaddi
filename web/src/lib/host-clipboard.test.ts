import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import {
  __resetHostClipboard,
  dismissBanner,
  foldVersion,
  hasUnseen,
  markSeen,
  needsBounceCheck,
  noteCopiedToPhone,
  parseMarks,
  pollHostClipboard,
  showsBanner,
  type ClipboardMarks,
} from "./host-clipboard";

describe("host clipboard marks", () => {
  it("the first reading is a baseline: no banner, no dot", () => {
    const marks = foldVersion(null, "100", 1);
    expect(marks).toEqual({ seen: "100", pending: null, dismissed: null });
    expect(hasUnseen(marks)).toBe(false);
    expect(showsBanner(marks)).toBe(false);
  });

  it("a new counter is news, dated when this device first noticed it", () => {
    const marks = foldVersion(foldVersion(null, "100", 1), "101", 50);
    expect(marks.pending).toEqual({ version: "101", since: 50 });
    expect(showsBanner(marks)).toBe(true);
  });

  it("the same pending counter keeps its first-noticed time", () => {
    const first = foldVersion(foldVersion(null, "100", 1), "101", 50);
    expect(foldVersion(first, "101", 90)).toBe(first);
  });

  it("a later counter replaces the pending one and dates itself", () => {
    const first = foldVersion(foldVersion(null, "100", 1), "101", 50);
    expect(foldVersion(first, "102", 90).pending).toEqual({ version: "102", since: 90 });
  });

  it("dismissing hides the banner and keeps the dot", () => {
    const pending = foldVersion(foldVersion(null, "100", 1), "101", 50);
    const dismissed = dismissBanner(pending);
    expect(showsBanner(dismissed)).toBe(false);
    expect(hasUnseen(dismissed)).toBe(true);
  });

  it("a newer change after a dismissal raises the banner again", () => {
    const dismissed = dismissBanner(foldVersion(foldVersion(null, "100", 1), "101", 50));
    expect(showsBanner(foldVersion(dismissed, "102", 60))).toBe(true);
  });

  it("reading in the sheet clears both", () => {
    const seen = markSeen("101");
    expect(hasUnseen(seen)).toBe(false);
    expect(foldVersion(seen, "101", 70)).toEqual(seen);
  });

  it("a counter that went back to the seen value is no longer news", () => {
    const pending = foldVersion(foldVersion(null, "100", 1), "101", 50);
    expect(hasUnseen(foldVersion(pending, "100", 60))).toBe(false);
    expect(foldVersion(pending, "102", 60, false)).toEqual({ seen: "102", pending: null, dismissed: null });
  });
});

describe("parseMarks", () => {
  const good: ClipboardMarks = { seen: "7", pending: { version: "8", since: 123 }, dismissed: null };

  it("reads back what it wrote", () => {
    expect(parseMarks(JSON.stringify(good))).toEqual(good);
    expect(parseMarks(JSON.stringify({ seen: "7", pending: null, dismissed: "8" }))).toEqual({
      seen: "7",
      pending: null,
      dismissed: "8",
    });
  });

  it("anything else is null, which the store treats as a baseline", () => {
    expect(parseMarks("not json")).toBeNull();
    expect(parseMarks(JSON.stringify({ seen: 7, pending: null, dismissed: null }))).toBeNull();
    expect(parseMarks(JSON.stringify({ seen: "7", pending: { version: "8" }, dismissed: null }))).toBeNull();
  });
});

describe("the bounce of this phone's own copy", () => {
  const seen = { seen: "10", pending: null, dismissed: null };

  it("needs a check only inside the window, for a counter not seen or pended", () => {
    expect(needsBounceCheck(seen, "11", { until: 100 }, 50)).toBe(true);
    expect(needsBounceCheck(seen, "11", { until: 100 }, 101)).toBe(false);
    expect(needsBounceCheck(seen, "11", null, 50)).toBe(false);
    expect(needsBounceCheck(seen, "10", { until: 100 }, 50)).toBe(false);
    expect(needsBounceCheck(null, "11", { until: 100 }, 50)).toBe(false);
  });

  function stored() {
    return parseMarks(localStorage.getItem("collie:host-clipboard:v1") ?? "");
  }

  function serve(version: () => string, text: () => string) {
    let reads = 0;
    server.use(
      http.get("/api/host-clipboard", () => HttpResponse.json({ ok: true, version: version() })),
      http.get("/api/host-clipboard/text", () => {
        reads += 1;
        return HttpResponse.json({ ok: true, text: text(), bytes: text().length, version: version() });
      }),
    );
    return () => reads;
  }

  beforeEach(() => {
    localStorage.clear();
    __resetHostClipboard();
  });

  it("identical text right after a copy is that copy coming back, not news", async () => {
    let v = "10";
    const reads = serve(() => v, () => "same prompt");
    await pollHostClipboard();
    noteCopiedToPhone("same prompt");
    v = "11";
    await pollHostClipboard();
    expect(hasUnseen(stored())).toBe(false);
    expect(stored()?.seen).toBe("11");
    expect(reads()).toBe(1);
  });

  it("different text inside the window is still news", async () => {
    let v = "10";
    serve(() => v, () => "something the agent copied");
    await pollHostClipboard();
    noteCopiedToPhone("same prompt");
    v = "11";
    await pollHostClipboard();
    expect(showsBanner(stored())).toBe(true);
  });

  it("a change the bridge found no text under is seen at once, and reads nothing here", async () => {
    let v = "10";
    let text = true;
    let reads = 0;
    server.use(
      http.get("/api/host-clipboard", () => HttpResponse.json({ ok: true, version: v, text })),
      http.get("/api/host-clipboard/text", () => {
        reads += 1;
        return HttpResponse.json({ ok: false, kind: "empty", version: v });
      }),
    );
    await pollHostClipboard();
    v = "11";
    await pollHostClipboard();
    expect(showsBanner(stored())).toBe(true);
    v = "12";
    text = false;
    noteCopiedToPhone("anything");
    await pollHostClipboard();
    expect(hasUnseen(stored())).toBe(false);
    expect(stored()?.seen).toBe("12");
    expect(reads).toBe(0);
  });

  it("a bridge that does not say whether there is text keeps every change as news", async () => {
    let v = "10";
    server.use(http.get("/api/host-clipboard", () => HttpResponse.json({ ok: true, version: v })));
    await pollHostClipboard();
    v = "11";
    await pollHostClipboard();
    expect(showsBanner(stored())).toBe(true);
  });

  it("without a copy from this phone a change reads nothing and is news", async () => {
    let v = "10";
    const reads = serve(() => v, () => "x");
    await pollHostClipboard();
    v = "11";
    await pollHostClipboard();
    expect(showsBanner(stored())).toBe(true);
    expect(reads()).toBe(0);
  });
});
