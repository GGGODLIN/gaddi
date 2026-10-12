import { appendQuote, quoteLines } from "./quote";

describe("quoteLines", () => {
  it("marks every line, and keeps a blank line inside the quote", () => {
    expect(quoteLines("first line\n\nsecond paragraph")).toBe("> first line\n>\n> second paragraph");
  });

  it("drops the blank edges a drag across paragraphs picks up", () => {
    expect(quoteLines("\n\n  indented stays  \n\n")).toBe(">   indented stays");
  });

  it("reads a Windows line ending as one break", () => {
    expect(quoteLines("a\r\nb")).toBe("> a\n> b");
  });

  it("has nothing to quote in whitespace", () => {
    expect(quoteLines(" \n\t\n")).toBeNull();
  });
});

describe("appendQuote", () => {
  it("leaves an empty line under the quote for the comment", () => {
    expect(appendQuote("", "> a")).toBe("> a\n\n");
  });

  it("follows an existing draft after a blank line, never replacing it", () => {
    expect(appendQuote("about this:  \n", "> a")).toBe("about this:\n\n> a\n\n");
  });

  it("a second quote follows the first one's comment", () => {
    const once = appendQuote("", "> a") + "why?";
    expect(appendQuote(once, "> b")).toBe("> a\n\nwhy?\n\n> b\n\n");
  });
});
