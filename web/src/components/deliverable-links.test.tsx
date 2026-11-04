import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeliverableLinks } from "./deliverable-links";
import { MarkdownText } from "./markdown-text";
import { TOKEN_STORAGE_KEY } from "@/lib/pairing";

// The list is asked through the real hook (`useDeliverableLinks` → `fetchDeliverables`). A quiet
// journal and a 500 used to leave `wanted` full and arm the next ask at the 150ms coalesce, so the
// phone hit the list several times a second. The mux `scope.session` is not the agent session: the
// same pane can keep its scope while the reply's file id changes, and the only signal is a 404 on
// the id the list handed out last.

const HREF = "file:///tmp/probe-note.txt";
const HREF_B = "file:///tmp/probe-other.txt";
const RETRY_MS = 30_000;

interface Seen {
  url: string;
  authorization: string | null;
}

interface PendingPreview {
  release?: () => void;
}

const seen: Seen[] = [];
let routes: (url: string, init?: RequestInit) => Response | Promise<Response> = () =>
  new Response("miss", { status: 500 });

function respond(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

function preview(text: string, name = "note.txt"): Response {
  return respond(
    JSON.stringify({
      available: true,
      name,
      size: text.length,
      binary: false,
      truncated: false,
      text,
      downloadable: true,
    }),
  );
}

function listBody(id: string, href = HREF, title = "note.txt"): Response {
  return respond(
    JSON.stringify({
      available: true,
      truncated: false,
      items: [{ id, href, title }],
    }),
  );
}

function errorBody(status: number): Response {
  return respond(JSON.stringify({ error: "unknown-path" }), status);
}

function quietBody(): Response {
  return respond(JSON.stringify({ available: false, reason: "no-session" }));
}

function pairList(): Response {
  return respond(
    JSON.stringify({
      available: true,
      truncated: false,
      items: [
        { id: "id-a", href: HREF, title: "note.txt" },
        { id: "id-b", href: HREF_B, title: "other.txt" },
      ],
    }),
  );
}

function isList(url: string): boolean {
  const path = new URL(url, "http://127.0.0.1").pathname;
  return path.endsWith("/deliverables");
}

function listCount(): number {
  return seen.filter((call) => isList(call.url)).length;
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderNote(paneId = "p1", text = `see [note](${HREF})`): void {
  render(
    <DeliverableLinks paneId={paneId}>
      <MarkdownText text={text} />
    </DeliverableLinks>,
  );
}

beforeEach(() => {
  seen.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      seen.push({ url, authorization: headers.get("authorization") });
      return routes(url, init);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("deliverable list quiet window", () => {
  it("asks once in the first second when there is no journal, and not again before 30s", async () => {
    routes = () => quietBody();
    renderNote();
    await advance(1_000);
    expect(listCount()).toBe(1);
    expect(screen.queryByRole("button", { name: "note" })).toBeNull();
    // The label is a text node beside "see", not its own element, so the paragraph is the match.
    expect(screen.getByText("see note")).toBeInTheDocument();
    await advance(RETRY_MS - 1_500);
    expect(listCount()).toBe(1);
    await advance(1_000);
    expect(listCount()).toBe(2);
  });

  it("asks once in the first second on a 500, and not again before 30s", async () => {
    routes = () => new Response("nope", { status: 500 });
    renderNote("err");
    await advance(1_000);
    expect(listCount()).toBe(1);
    await advance(RETRY_MS - 1_500);
    expect(listCount()).toBe(1);
    await advance(1_000);
    expect(listCount()).toBe(2);
  });

  it.each([
    ["404", 404],
    ["501", 501],
  ])("a %s list is refused, so a later tick does not ask again", async (_label, status) => {
    routes = () => errorBody(status);
    renderNote(`peer-${status}`);
    await advance(1_000);
    expect(listCount()).toBe(1);
    expect(screen.queryByRole("button", { name: "note" })).toBeNull();
    await advance(RETRY_MS);
    expect(listCount()).toBe(1);
  });
});

describe("a cached deliverable id", () => {
  it("follows the new id after the old one 404s, without polling while the pane sits", async () => {
    let id = "id-old";
    routes = (url) => {
      if (isList(url)) return listBody(id);
      if (url.includes("id-new")) return preview("FRESH-B");
      return errorBody(404);
    };
    renderNote();
    await advance(200);
    expect(screen.getByRole("button", { name: "note" })).toBeInTheDocument();
    expect(listCount()).toBe(1);
    id = "id-new";
    await advance(1_000);
    expect(listCount()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "note" }));
    await advance(500);
    expect(screen.getByText("FRESH-B")).toBeInTheDocument();
    expect(seen.some((call) => call.url.includes("/deliverables/id-new") && !call.url.includes("download=1"))).toBe(true);
    expect(listCount()).toBe(2);
  });

  it("does not ask the list again when the same dead id 404s twice", async () => {
    routes = (url) => (isList(url) ? listBody("id-old") : errorBody(404));
    renderNote("stuck");
    await advance(200);
    fireEvent.click(screen.getByRole("button", { name: "note" }));
    await advance(1_000);
    expect(screen.getByText("This file is not available")).toBeInTheDocument();
    expect(listCount()).toBe(2);
    await advance(1_000);
    expect(listCount()).toBe(2);
  });

  it("does not paint a preview that resolved after the sheet moved on", async () => {
    const pending: PendingPreview = {};
    routes = (url, init) => {
      if (isList(url)) return pairList();
      if (url.includes("id-b")) return preview("FRESH-B", "other.txt");
      return new Promise((resolve, reject) => {
        pending.release = () => resolve(preview("STALE-A", "note.txt"));
        init?.signal?.addEventListener("abort", () => {
          const aborted = new Error("aborted");
          aborted.name = "AbortError";
          reject(aborted);
        });
      });
    };
    renderNote("sheet", `see [note](${HREF}) and [other](${HREF_B})`);
    await advance(200);
    fireEvent.click(screen.getByRole("button", { name: "note" }));
    await advance(20);
    fireEvent.click(screen.getByRole("button", { name: "other" }));
    await advance(50);
    expect(screen.getByText("FRESH-B")).toBeInTheDocument();
    expect(pending.release).toBeDefined();
    pending.release?.();
    await act(async () => {});
    expect(screen.queryByText("STALE-A")).toBeNull();
    expect(screen.getByText("FRESH-B")).toBeInTheDocument();
  });

  it("downloads through the pairing header, not a bare file URL", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "tok-1");
    routes = (url) => {
      if (isList(url)) return listBody("id-old");
      if (url.includes("download=1")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      return preview("hello");
    };
    renderNote("dl");
    await advance(200);
    fireEvent.click(screen.getByRole("button", { name: "note" }));
    await advance(50);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await act(async () => {});
    const download = seen.find((call) => call.url.includes("download=1"));
    expect(download?.url).toContain("/api/pane/dl/deliverables/id-old");
    expect(download?.authorization).toBe("Bearer tok-1");
    expect(download?.url.startsWith("file:")).toBe(false);
  });

  it("renders a raster image preview inside the sheet while keeping the Download button", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const shotHref = "file:///tmp/shot.png";
    routes = (url) => {
      if (isList(url)) return listBody("id-shot", shotHref, "shot.png");
      if (url.includes("download=1")) return new Response(pngBytes, { status: 200 });
      return respond(
        JSON.stringify({
          available: true,
          name: "shot.png",
          size: pngBytes.byteLength,
          binary: true,
          truncated: false,
          text: "",
          downloadable: true,
        }),
      );
    };
    renderNote("img", `see [shot](${shotHref})`);
    await advance(200);
    fireEvent.click(screen.getByRole("button", { name: "shot" }));
    await advance(50);
    expect(screen.getByRole("img", { name: "shot.png" })).toBeInTheDocument();
    expect(document.querySelector("[data-slot='file-image']")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
  });
});
