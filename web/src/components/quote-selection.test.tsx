import { act, fireEvent, render, screen } from "@testing-library/react";

import { QuoteSelection } from "./quote-selection";

// jsdom keeps a real Selection but does not announce changes to it, so each case announces its own.
function select(from: Node, fromOffset: number, to: Node, toOffset: number) {
  const range = document.createRange();
  range.setStart(from, fromOffset);
  range.setEnd(to, toOffset);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => { document.dispatchEvent(new Event("selectionchange")); });
}

function clear() {
  document.getSelection()!.removeAllRanges();
  act(() => { document.dispatchEvent(new Event("selectionchange")); });
}

function page(onQuote = vi.fn(), enabled = true) {
  const view = render(
    <div>
      <p id="mine">my own question</p>
      <div data-quote-source="">
        <p id="reply">first line of the reply</p>
        <p id="reply-2">second line</p>
      </div>
      <div data-quote-source="">
        <p id="other">another reply</p>
      </div>
      <QuoteSelection enabled={enabled} onQuote={onQuote} />
    </div>,
  );
  const text = (id: string) => view.container.querySelector(`#${id}`)!.firstChild!;
  return { onQuote, text };
}

afterEach(() => document.getSelection()?.removeAllRanges());

describe("QuoteSelection", () => {
  it("offers Quote for text selected in a reply and hands over the quoted passage", () => {
    const { onQuote, text } = page();
    expect(screen.queryByRole("button", { name: "Quote" })).toBeNull();
    select(text("reply"), 0, text("reply"), 10);
    fireEvent.click(screen.getByRole("button", { name: "Quote" }));
    expect(onQuote).toHaveBeenCalledWith("> first line");
    expect(screen.queryByRole("button", { name: "Quote" })).toBeNull();
    expect(document.getSelection()?.isCollapsed).toBe(true);
  });

  it("is gone again once the selection is", () => {
    const { text } = page();
    select(text("reply"), 0, text("reply"), 5);
    expect(screen.getByRole("button", { name: "Quote" })).toBeInTheDocument();
    clear();
    expect(screen.queryByRole("button", { name: "Quote" })).toBeNull();
  });

  it("offers nothing for the operator's own words, or for a drag across two replies", () => {
    const { text } = page();
    select(text("mine"), 0, text("mine"), 6);
    expect(screen.queryByRole("button", { name: "Quote" })).toBeNull();
    select(text("reply"), 0, text("other"), 3);
    expect(screen.queryByRole("button", { name: "Quote" })).toBeNull();
  });

  it("offers nothing while the composer cannot take text", () => {
    const { text } = page(vi.fn(), false);
    select(text("reply"), 0, text("reply"), 5);
    expect(screen.queryByRole("button", { name: "Quote" })).toBeNull();
  });

  it("keeps the passage the finger landed on when the tap clears the selection first", () => {
    const { onQuote, text } = page();
    // One paragraph: jsdom joins two paragraphs' text with no break, which a browser does not.
    select(text("reply"), 6, text("reply"), 23);
    const button = screen.getByRole("button", { name: "Quote" });
    fireEvent.pointerDown(button);
    clear();
    fireEvent.click(button);
    expect(onQuote).toHaveBeenCalledWith("> line of the reply");
  });

  it("lets go when the finger slides off before lifting", () => {
    const { onQuote, text } = page();
    select(text("reply"), 0, text("reply"), 5);
    const button = screen.getByRole("button", { name: "Quote" });
    fireEvent.pointerDown(button);
    clear();
    fireEvent.pointerLeave(button);
    expect(screen.queryByRole("button", { name: "Quote" })).toBeNull();
    expect(onQuote).not.toHaveBeenCalled();
  });
});
