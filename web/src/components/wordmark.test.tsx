import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PRODUCT_NAME, Wordmark } from "@/components/wordmark";

describe("the wordmark", () => {
  it("keeps the fork name without the upstream suffix", () => {
    const { container } = render(<Wordmark />);
    expect(container.textContent).toBe(PRODUCT_NAME);
    expect(container.textContent).toBe("Gaddi");
    expect(container.querySelectorAll(".wordmark-ink")).toHaveLength(0);
    expect(container.firstElementChild?.className).toContain("tracking-[0.03em]");
  });
});
