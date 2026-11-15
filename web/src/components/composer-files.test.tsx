import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetFileSuggestionsCache } from "@/hooks/use-file-suggestions";
import { clearDraft } from "@/lib/drafts";
import { markLive, resetLiveness } from "@/lib/liveness";
import { __resetOperatorCommands } from "@/lib/operator-config";
import { clearStatus, useStatus } from "@/lib/status";
import { fixtureFilesDir, FIXTURE_FILES_UNKNOWN, recordedSends } from "@/test/handlers";
import { server } from "@/test/setup";
import { Composer } from "./composer";

const ROOT = "/home/you/webapp";

beforeAll(() => {
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});

beforeEach(() => {
  clearStatus();
  clearDraft(undefined, "w1:p1");
  resetLiveness();
  __resetOperatorCommands();
  __resetFileSuggestionsCache();
  markLive("w1:p1");
});

afterEach(() => {
  cleanup();
  __resetFileSuggestionsCache();
});

function StatusProbe() {
  const status = useStatus();
  return status === null ? null : <output data-slot="test-status">{status.text}</output>;
}

function renderComposer(overrides: Partial<ComponentProps<typeof Composer>> = {}) {
  const props: ComponentProps<typeof Composer> = {
    paneId: "w1:p1",
    agent: "claude",
    isShell: false,
    cwd: ROOT,
    gone: false,
    readOnly: false,
    surface: { revision: 1, turn: "idle", modal: "none", composer: "empty" },
    text: "❯ ",
    terminalDraft: null,
    rawTerminalDraft: null,
    prefs: {
      wrap: true,
      fontSize: 11,
      draftFontSize: 14,
      chatFontSize: 14,
      fontFamily: "system",
      rawTerminal: false,
      tapToFocus: true,
      expandClippedReply: true,
      stretchText: false,
    },
    display: { open: false, onToggle: vi.fn() },
    onSent: vi.fn(),
    ...overrides,
  };
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <>
          <StatusProbe />
          <Composer {...props} />
        </>
      ),
    },
  ]);
  render(<RouterProvider router={router} />);
  return props;
}

const box = () => screen.getByPlaceholderText<HTMLTextAreaElement>(/type a reply/i);
const FILE_STRIP = { name: "File suggestions" };

function fileStripState(): "open" | "closed" | "absent" {
  const strip = screen.queryByRole("group", FILE_STRIP);
  if (strip === null) return "absent";
  return strip.closest('[data-slot="collapse"]')?.getAttribute("data-state") === "open" ? "open" : "closed";
}

describe("Composer @ file suggestions (#757)", () => {
  it("lists folders before files on `@`, hides git-ignored entries, drills into folders without closing, and adds a trailing space on file pick", async () => {
    const user = userEvent.setup();
    renderComposer();

    expect(screen.queryByRole("group", FILE_STRIP)).toBeNull();

    await user.type(box(), "@");
    const list = await screen.findByRole("group", FILE_STRIP);
    expect(list).toHaveAttribute("data-slot", "file-suggestions");
    expect(list).toHaveClass("h-11");

    const labels = Array.from(list.querySelectorAll("button")).map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual([
      "@docs/",
      "@packages/",
      "@public/",
      "@src/",
      "@current",
      "@index.html",
      "@logo.png",
      "@package.json",
      "@README.md",
    ]);
    expect(within(list).queryByRole("button", { name: /node_modules/i })).toBeNull();
    expect(within(list).queryByRole("button", { name: /debug\.log/i })).toBeNull();

    // Tapping a folder stages `@src/` without trailing space, keeps focus, sends nothing, and lists children.
    await user.click(within(list).getByRole("button", { name: "@src/" }));
    expect(box()).toHaveValue("@src/");
    expect(box()).toHaveFocus();
    expect(recordedSends()).toEqual([]);

    await waitFor(() =>
      expect(within(screen.getByRole("group", FILE_STRIP)).getByRole("button", { name: "@src/routes/" })).toBeInTheDocument(),
    );
    await user.click(within(screen.getByRole("group", FILE_STRIP)).getByRole("button", { name: "@src/routes/" }));
    expect(box()).toHaveValue("@src/routes/");

    await waitFor(() =>
      expect(
        within(screen.getByRole("group", FILE_STRIP)).getByRole("button", { name: "@src/routes/checkout.tsx" }),
      ).toBeInTheDocument(),
    );
    await user.type(box(), "ch");
    const fileChip = within(screen.getByRole("group", FILE_STRIP)).getByRole("button", {
      name: "@src/routes/checkout.tsx",
    });
    expect(fileChip.querySelector(".font-bold")?.textContent).toBe("ch");

    // Tapping a file appends a trailing space, keeps focus, sends nothing, and closes the strip.
    await user.click(fileChip);
    expect(box()).toHaveValue("@src/routes/checkout.tsx ");
    expect(box()).toHaveFocus();
    expect(recordedSends()).toEqual([]);
    await waitFor(() => expect(fileStripState()).toBe("closed"));
  });

  it("tracks mid-sentence `@` tokens via caret movement without doubling spaces, and arbitrates cleanly with `/` commands", async () => {
    const user = userEvent.setup();
    renderComposer();

    // `/` opens command suggestions; adding ` @` switches the single strip to file suggestions.
    await user.type(box(), "/compact");
    expect(await screen.findByRole("group", { name: "Agent commands" })).toBeInTheDocument();
    await user.type(box(), " @re");
    const list = await screen.findByRole("group", FILE_STRIP);
    expect(within(list).getByRole("button", { name: "@README.md" })).toBeInTheDocument();

    // Mid-sentence replacement before existing text never produces a double space.
    await user.clear(box());
    await user.type(box(), "compare @ and @doc");
    await waitFor(() =>
      expect(within(screen.getByRole("group", FILE_STRIP)).getByRole("button", { name: "@docs/" })).toBeInTheDocument(),
    );

    // Move caret back right after the first `@` (`index 9`).
    const textarea = box();
    textarea.setSelectionRange(9, 9);
    fireEvent.select(textarea);

    await waitFor(() =>
      expect(within(screen.getByRole("group", FILE_STRIP)).getByRole("button", { name: "@README.md" })).toBeInTheDocument(),
    );
    await user.click(within(screen.getByRole("group", FILE_STRIP)).getByRole("button", { name: "@README.md" }));
    expect(textarea).toHaveValue("compare @README.md and @doc");
    await waitFor(() => expect(textarea.selectionStart).toBe("compare @README.md ".length));
    await waitFor(() => expect(fileStripState()).toBe("closed"));
  });

  it("resolves paths relative to a subfolder `cwd` (and `../` within the Files root), and caches folder reads for 30s", async () => {
    const askedDirs: string[] = [];
    server.use(
      http.get(/\/api\/pane\/[^/]+\/files$/, ({ request }) => {
        const dir = new URL(request.url).searchParams.get("dir") ?? "";
        askedDirs.push(dir);
        const answer = fixtureFilesDir(dir);
        return answer === null
          ? HttpResponse.json(FIXTURE_FILES_UNKNOWN, { status: 404 })
          : HttpResponse.json(answer);
      }),
    );

    const user = userEvent.setup();
    renderComposer({ cwd: `${ROOT}/packages/api`, filesDir: "packages/api" });

    await user.type(box(), "@");
    const list = await screen.findByRole("group", FILE_STRIP);
    const labels = Array.from(list.querySelectorAll("button")).map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["@server/", "@notes.md"]);
    expect(askedDirs).toEqual(["packages/api"]);

    // Typing further characters in the same folder uses the 30s cache without another request.
    await user.type(box(), "no");
    expect(within(screen.getByRole("group", FILE_STRIP)).getByRole("button", { name: "@notes.md" })).toBeInTheDocument();
    expect(askedDirs).toEqual(["packages/api"]);

    // Climbing `../` stays inside the workspace root (`packages`), folded before hitting the bridge.
    await user.clear(box());
    await user.type(box(), "@../");
    await waitFor(() =>
      expect(within(screen.getByRole("group", FILE_STRIP)).getByRole("button", { name: "@../api/" })).toBeInTheDocument(),
    );
    expect(askedDirs).toEqual(["packages/api", "packages"]);

    // `@../../` reaches the workspace root (`""`), and `@../../../` climbs past it — sending no `..` to the bridge and closing quietly.
    await user.clear(box());
    await user.type(box(), "@../../../");
    await waitFor(() => expect(fileStripState()).not.toBe("open"));
    expect(askedDirs).toEqual(["packages/api", "packages", ""]);

    // When `filesDir` is omitted (before launchers `home` arrives or on a non-POSIX host), the first
    // read's `root` resolves `cwd` to `packages/api` automatically.
    cleanup();
    clearDraft(undefined, "w1:p1");
    __resetFileSuggestionsCache();
    askedDirs.length = 0;
    markLive("w1:p1");
    renderComposer({ cwd: `${ROOT}/packages/api` });
    await user.type(box(), "@");
    const fallbackList = await screen.findByRole("group", FILE_STRIP);
    expect(Array.from(fallbackList.querySelectorAll("button")).map((b) => b.getAttribute("aria-label"))).toEqual([
      "@server/",
      "@notes.md",
    ]);
    expect(askedDirs).toEqual(["", "packages/api"]);
  });

  it("stays quietly hidden on `no-folder` and 403 refusal without raising a status error", async () => {
    server.use(
      http.get(/\/api\/pane\/[^/]+\/files$/, () =>
        HttpResponse.json({ paneId: "w1:p1", available: false, reason: "no-folder" }),
      ),
    );
    const user = userEvent.setup();
    renderComposer({ cwd: "/home/you" });
    await user.type(box(), "@re");
    expect(screen.queryByRole("group", FILE_STRIP)).toBeNull();
    expect(document.querySelector('[data-slot="test-status"]')).toBeNull();
    cleanup();
    clearDraft(undefined, "w1:p1");

    __resetFileSuggestionsCache();
    server.use(
      http.get(/\/api\/pane\/[^/]+\/files$/, () => new HttpResponse("device not authorised", { status: 403 })),
    );
    markLive("w1:p1");
    renderComposer();
    await user.type(box(), "@re");
    expect(screen.queryByRole("group", FILE_STRIP)).toBeNull();
    expect(document.querySelector('[data-slot="test-status"]')).toBeNull();
  });

  it("suppresses `@` file suggestions on shell panes, Type mode, dialog cards, and blur", async () => {
    server.use(
      http.get(/\/api\/sent$/, () =>
        HttpResponse.json({ entries: [], more: false, off: false, machines: [] }),
      ),
    );
    const user = userEvent.setup();

    // Shell pane never opens `@` file suggestions.
    renderComposer({ isShell: true, agent: undefined, text: "$ " });
    await user.type(screen.getByRole("textbox"), "@re");
    expect(screen.queryByRole("group", FILE_STRIP)).toBeNull();
    cleanup();
    clearDraft(undefined, "w1:p1");

    // Dialog card suppresses `@` file suggestions.
    markLive("w1:p1");
    renderComposer({ dialogCard: true });
    await user.type(box(), "@re");
    expect(screen.queryByRole("group", FILE_STRIP)).toBeNull();
    cleanup();
    clearDraft(undefined, "w1:p1");

    // Type into terminal suppresses `@` file suggestions.
    markLive("w1:p1");
    renderComposer();
    await user.click(screen.getByRole("button", { name: /^type into terminal$/i }));
    await user.type(screen.getByRole("textbox"), "@re");
    expect(screen.queryByRole("group", FILE_STRIP)).toBeNull();
    cleanup();
    clearDraft(undefined, "w1:p1");

    // Blur closes an open strip.
    markLive("w1:p1");
    renderComposer();
    await user.type(box(), "@re");
    expect(await screen.findByRole("group", FILE_STRIP)).toBeInTheDocument();
    fireEvent.blur(box());
    await waitFor(() => expect(fileStripState()).toBe("closed"));
  });
});
