import { act, fireEvent, render, screen } from "@testing-library/react";

import { BottomSheet } from "@/components/ui/sheet";

import { ImageEditor } from "./image-editor";

// A real touch, not React's delegated one. The sheet reads `touches` off the native event.
function pull(target: Element, fromY: number, toY: number) {
  for (const [type, clientY] of [
    ["touchstart", fromY],
    ["touchmove", toY],
  ] as const) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: [{ clientY }] });
    target.dispatchEvent(event);
  }
}

function panelOf(dialog: HTMLElement) {
  // The backdrop button is also tabindex=-1 and comes first. The panel is the scrolling div.
  const panel = dialog.querySelector<HTMLElement>("div.overflow-y-auto");
  if (panel === null) throw new Error("sheet panel missing");
  return panel;
}

function loadEditorImage(dialog: HTMLElement, width = 200, height = 100) {
  const img = dialog.querySelector<HTMLImageElement>("[data-slot='image-editor-source']");
  if (img === null) throw new Error("editor source img missing");
  Object.defineProperty(img, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: height, configurable: true });
  fireEvent.load(img);
}

describe("ImageEditor sheet shell and native canvas tools", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:editor");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    // SAFETY: test stub provides a non-null 2D context for canvasAvailable and optional drawing calls.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the native canvas stage, tool switcher, and undo/redo/reset controls without third-party editor classes", () => {
    render(
      <ImageEditor
        file={new File(["x"], "shot.png", { type: "image/png" })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onFail={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Edit image" });
    expect(dialog.querySelector(".FIE_root")).toBeNull();
    expect(screen.getByRole("radio", { name: "Crop" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Draw" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "Circle" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "Arrow" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Use this image" })).toBeDisabled();

    loadEditorImage(dialog, 300, 150);
    expect(screen.getByRole("button", { name: "Use this image" })).toBeEnabled();
    const canvas = dialog.querySelector<HTMLCanvasElement>("[data-slot='image-editor-canvas']");
    expect(canvas).not.toBeNull();
    expect(canvas).not.toHaveClass("hidden");
  });

  it("supports drawing annotations, undoing, redoing, resetting, and exporting on confirm", () => {
    const pngDataUrl = `data:image/png;base64,${btoa("cropped-annotated-png")}`;
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(pngDataUrl);
    const onConfirm = vi.fn<(file: File) => void>();

    render(
      <ImageEditor
        file={new File(["raw"], "screen.png", { type: "image/png" })}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        onFail={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Edit image" });
    loadEditorImage(dialog, 200, 100);

    const canvas = dialog.querySelector<HTMLCanvasElement>("[data-slot='image-editor-canvas']");
    if (canvas === null) throw new Error("canvas missing");

    // Switch to Draw tool and draw a stroke.
    fireEvent.click(screen.getByRole("radio", { name: "Draw" }));
    expect(screen.getByRole("radio", { name: "Draw" })).toHaveAttribute("aria-checked", "true");

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 100, clientY: 60 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 100, clientY: 60 });

    const undoBtn = screen.getByRole("button", { name: "Undo" });
    const redoBtn = screen.getByRole("button", { name: "Redo" });
    const resetBtn = screen.getByRole("button", { name: "Reset" });
    expect(undoBtn).toBeEnabled();
    expect(resetBtn).toBeEnabled();

    fireEvent.click(undoBtn);
    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeEnabled();

    fireEvent.click(redoBtn);
    expect(undoBtn).toBeEnabled();

    fireEvent.click(resetBtn);
    expect(resetBtn).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Use this image" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const exportedFile = onConfirm.mock.calls[0]?.[0];
    expect(exportedFile?.name).toBe("screen.png");
    expect(exportedFile?.type).toBe("image/png");
    expect(exportedFile?.size).toBe("cropped-annotated-png".length);
  });

  it("reports a missing canvas on the first commit, and Cancel uses the latest callback", () => {
    const onFail = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const failed = render(
      <ImageEditor file={new File(["x"], "shot.png", { type: "image/png" })} onConfirm={vi.fn()} onCancel={vi.fn()} onFail={onFail} onReject={vi.fn()} />,
    );
    expect(onFail).toHaveBeenCalledWith("unavailable");
    failed.unmount();

    // SAFETY: canvasAvailable only checks non-null. This value is never drawn on.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    const first = vi.fn();
    const second = vi.fn();
    const file = new File(["x"], "shot.png", { type: "image/png" });
    const { rerender } = render(
      <ImageEditor file={file} onConfirm={vi.fn()} onCancel={first} onFail={vi.fn()} onReject={vi.fn()} />,
    );
    rerender(
      <ImageEditor file={file} onConfirm={vi.fn()} onCancel={second} onFail={vi.fn()} onReject={vi.fn()} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]!);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("is a BottomSheet portaled to the body, not a second dialog element", () => {
    render(
      <ImageEditor file={new File(["x"], "shot.png", { type: "image/png" })} onConfirm={vi.fn()} onCancel={vi.fn()} onFail={vi.fn()} onReject={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog", { name: "Edit image" });
    expect(dialog.tagName).not.toBe("DIALOG");
    expect(document.body.contains(dialog)).toBe(true);
    expect(document.querySelector("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this image" })).toBeInTheDocument();
  });

  it("a touchmove inside the editor reaches the window and does not drag or close the sheet", () => {
    const onCancel = vi.fn();
    const heard: Event[] = [];
    const hear = (event: Event) => {
      heard.push(event);
    };
    window.addEventListener("touchmove", hear);
    try {
      render(
        <ImageEditor file={new File(["x"], "shot.png", { type: "image/png" })} onConfirm={vi.fn()} onCancel={onCancel} onFail={vi.fn()} onReject={vi.fn()} />,
      );
      const dialog = screen.getByRole("dialog", { name: "Edit image" });
      const surface = dialog.querySelector(".collie-image-editor");
      if (surface === null) throw new Error("editor surface missing");
      act(() => {
        pull(surface, 10, 120);
      });
      expect(heard).toHaveLength(1);
      expect(panelOf(dialog).style.transform).not.toContain("translateY");
      expect(onCancel).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("touchmove", hear);
    }
  });

  it("a stroke on the editor surface does not drag the sheet, and the same pull on the sheet chrome still does", () => {
    render(
      <ImageEditor file={new File(["x"], "shot.png", { type: "image/png" })} onConfirm={vi.fn()} onCancel={vi.fn()} onFail={vi.fn()} onReject={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog", { name: "Edit image" });
    const panel = panelOf(dialog);
    const surface = dialog.querySelector(".collie-image-editor");
    if (surface === null) throw new Error("editor surface missing");

    act(() => {
      pull(surface, 10, 80);
    });
    expect(panel.style.transform).not.toContain("translateY");

    const chrome = dialog.querySelector("[data-slot='sheet-title-row']");
    if (chrome === null) throw new Error("sheet chrome missing");
    act(() => {
      pull(chrome, 10, 120);
    });
    expect(panel.style.transform).not.toContain("translateY");
  });

  it("a default BottomSheet still drag-dismisses from its title", () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} title="Plain">
        body
      </BottomSheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Plain" });
    const chrome = dialog.querySelector("[data-slot='sheet-title-row']");
    if (chrome === null) throw new Error("sheet chrome missing");
    act(() => {
      pull(chrome, 10, 80);
    });
    expect(panelOf(dialog).style.transform).toBe("translateY(70px)");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("React stopPropagation on a child does not keep the sheet from dragging", () => {
    function ReactStop() {
      return (
        <div
          data-slot="react-stop"
          onTouchStart={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          pen
        </div>
      );
    }
    render(
      <BottomSheet open onClose={vi.fn()} title="React stop">
        <ReactStop />
      </BottomSheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "React stop" });
    const target = dialog.querySelector("[data-slot='react-stop']");
    if (target === null) throw new Error("react stop target missing");
    act(() => {
      pull(target, 10, 80);
    });
    expect(panelOf(dialog).style.transform).toBe("translateY(70px)");
  });
});
