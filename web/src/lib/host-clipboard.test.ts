import { describe, expect, it } from "vitest";

import { dismissBanner, foldVersion, hasUnseen, markSeen, parseMarks, showsBanner, type ClipboardMarks } from "./host-clipboard";

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
