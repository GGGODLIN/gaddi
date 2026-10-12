// A passage of an agent's reply, quoted into the operator's draft as Markdown, so the agent can tell
// the words it wrote from the comment that follows.

/** The selection as `> ` lines, or null when it holds nothing but whitespace. */
export function quoteLines(selection: string): string | null {
  const lines = selection.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  if (lines.length === 0) return null;
  // A bare `>` keeps a blank line inside the quote instead of ending it.
  return lines.map((line) => (line === "" ? ">" : `> ${line}`)).join("\n");
}

/** The draft with the quote after it, a blank line apart, ending on an empty line for the comment. */
export function appendQuote(draft: string, quote: string): string {
  const head = draft.trimEnd();
  return `${head === "" ? "" : `${head}\n\n`}${quote}\n\n`;
}
