import { afterEach, describe, expect, test } from "vitest";
import { __resetLocale, setLocale, whenLocaleReady } from "@/lib/i18n";
import { descriptionNow } from "@/lib/description-now";

afterEach(() => __resetLocale());

describe("descriptionNow", () => {
  test("a blocked description names its tool and target in the phone's language", () => {
    const d = { now: "在等你批准 Bash · bun test", source: "blocked", at: 1, parts: { tool: "Bash", target: "bun test" } } as const;
    expect(descriptionNow(d)).toBe("Waiting for your approval: Bash · bun test");
  });

  test("a blocked description without a tool is the bare sentence", () => {
    expect(descriptionNow({ now: "在等你批准", source: "blocked", at: 1, parts: {} })).toBe("Waiting for your approval");
  });

  test("a prompt keeps the operator's words and translates only the prefix", () => {
    const d = { now: "你：跑完測試再 commit", source: "prompt", at: 1, parts: { prompt: "跑完測試再 commit" } } as const;
    expect(descriptionNow(d)).toBe("You: 跑完測試再 commit");
  });

  test("zh-TW reads the same sentence the bridge composed", async () => {
    setLocale("zh-TW");
    await whenLocaleReady("zh-TW");
    const d = { now: "在等你批准 Bash · bun test", source: "blocked", at: 1, parts: { tool: "Bash", target: "bun test" } } as const;
    expect(descriptionNow(d)).toBe(d.now);
    expect(descriptionNow({ now: "你：hi", source: "prompt", at: 1, parts: { prompt: "hi" } })).toBe("你：hi");
  });

  test("a recap, or a bridge that sends no parts, reads as sent", () => {
    expect(descriptionNow({ now: "已讀取檔案", source: "recap", at: 1 })).toBe("已讀取檔案");
    expect(descriptionNow({ now: "在等你批准 Edit", source: "blocked", at: 1 })).toBe("在等你批准 Edit");
  });
});
