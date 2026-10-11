import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { __resetOperatorCommands } from "@/lib/operator-config";
import { __resetHostClipboard } from "@/lib/host-clipboard";
import { HostClipboardButton, HostClipboardSheet } from "./host-clipboard";

// The host clipboard's way in and its sheet (ADR 9010).

function withClipboard(enabled: boolean) {
  server.use(
    http.get("/api/config", () =>
      HttpResponse.json(enabled ? { push: false, vapidPublicKey: "", hostClipboard: true } : { push: false, vapidPublicKey: "" }),
    ),
  );
}

function renderBoth() {
  render(
    <>
      <HostClipboardButton />
      <HostClipboardSheet />
    </>,
  );
}

beforeEach(() => {
  localStorage.clear();
  __resetOperatorCommands();
  __resetHostClipboard();
});

describe("host clipboard", () => {
  it("draws nothing on a host with no clipboard.toml, and reads nothing", async () => {
    withClipboard(false);
    let reads = 0;
    server.use(
      http.get("/api/host-clipboard/text", () => {
        reads += 1;
        return HttpResponse.json({ ok: true, text: "x", bytes: 1, version: "1" });
      }),
    );
    renderBoth();
    // Give the one-shot config read time to land, then confirm it changed nothing.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("button", { name: "Computer clipboard" })).toBeNull();
    expect(reads).toBe(0);
  });

  it("the button opens the sheet, which reads the text then and copies it", async () => {
    withClipboard(true);
    let reads = 0;
    server.use(
      http.get("/api/host-clipboard/text", () => {
        reads += 1;
        return HttpResponse.json({ ok: true, text: "請貼到設定欄", bytes: 18, version: "9" });
      }),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderBoth();
    const button = await screen.findByRole("button", { name: "Computer clipboard" });
    expect(reads).toBe(0);
    await userEvent.click(button);
    expect(await screen.findByText("請貼到設定欄")).toBeInTheDocument();
    expect(reads).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: "Copy to this phone" }));
    expect(writeText).toHaveBeenCalledWith("請貼到設定欄");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("says why when the configured command failed", async () => {
    withClipboard(true);
    server.use(
      http.get("/api/host-clipboard/text", () =>
        HttpResponse.json({ ok: false, kind: "failed", reason: "/usr/bin/pbpaste did not answer within 5s" }),
      ),
    );
    renderBoth();
    await userEvent.click(await screen.findByRole("button", { name: "Computer clipboard" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("/usr/bin/pbpaste did not answer within 5s"));
  });

  it("too large is said, not cut", async () => {
    withClipboard(true);
    server.use(http.get("/api/host-clipboard/text", () => HttpResponse.json({ ok: false, kind: "too-large", version: "3" })));
    renderBoth();
    await userEvent.click(await screen.findByRole("button", { name: "Computer clipboard" }));
    expect(await screen.findByText(/Over 256 KB/)).toBeInTheDocument();
  });
});
