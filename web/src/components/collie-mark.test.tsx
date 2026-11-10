import { render, screen } from "@testing-library/react";

import { collieMark, markIsLive, markPaper, markState } from "@/test/collie-mark";

import { CollieMark } from "./collie-mark";

// The Gaddi mark's own drawing, beside the contract every mark meets (mark-conformance.test.tsx
// runs that over the registry) and what any screen does with it.
describe("CollieMark", () => {
  it("is still at rest and live while loading, and says so on its root", () => {
    const { container, rerender } = render(<CollieMark />);
    expect(markState(container)).toBe("rest");
    expect(markIsLive(container)).toBe(false);
    rerender(<CollieMark state="loading" />);
    expect(markState(container)).toBe("loading");
    expect(markIsLive(container)).toBe(true);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("blooms in COLOUR too, not only by moving", () => {
    // Under `prefers-reduced-motion` the trot stops dead, so if the outline did not also take the
    // live accent colour, `loading` would say nothing at all to a reduced-motion reader.
    const { container, rerender } = render(<CollieMark />);
    const resting = collieMark(container)?.style.getPropertyValue("--cm-a1") ?? "";
    expect(resting).not.toBe("");
    rerender(<CollieMark state="loading" />);
    expect(collieMark(container)?.style.getPropertyValue("--cm-a1")).not.toBe(resting);
  });

  it("forwards className to the element", () => {
    const { container } = render(<CollieMark className="transition-opacity" />);
    expect(collieMark(container)?.getAttribute("class")).toContain("transition-opacity");
  });

  it("keeps the caller's paper on the element, never the built-in default", () => {
    const { container } = render(<CollieMark paper="var(--muted)" />);
    expect(markPaper(container)).toBe("var(--muted)");
  });

  it("carries every per-instance difference on the element, so two marks never fight", () => {
    // A <style> inside an inline SVG is DOCUMENT-scoped: if the rules themselves differed per
    // instance, a resting mark and a loading one on the same page would overwrite each other.
    const { container } = render(
      <div>
        <CollieMark />
        <CollieMark state="loading" />
      </div>,
    );
    const marks = [...container.querySelectorAll<SVGSVGElement>("svg")];
    expect(marks.map((m) => m.getAttribute("data-state"))).toStrictEqual(["rest", "loading"]);
    const sheets = [...container.querySelectorAll("svg > style")].map((s) => s.textContent);
    expect(sheets[0]).toBe(sheets[1]);
  });

  it("is decorative unless given a title, and an image when it has one", () => {
    const { rerender } = render(<CollieMark />);
    expect(screen.queryByRole("img")).toBeNull();
    rerender(<CollieMark title="Gaddi" />);
    expect(screen.getByRole("img", { name: "Gaddi" })).toBeInTheDocument();
  });

  it("crops to the header weight's own viewBox, not the full mark's", () => {
    const { container, rerender } = render(<CollieMark />);
    const fullViewBox = collieMark(container)?.getAttribute("viewBox");
    rerender(<CollieMark weight="header" />);
    expect(collieMark(container)?.getAttribute("viewBox")).not.toBe(fullViewBox);
  });
});
