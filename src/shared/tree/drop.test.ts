import { describe, expect, it } from "vitest";
import { resolveDropPosition } from "./drop";

describe("resolveDropPosition", () => {
  it("resolves the top quarter to before", () => {
    expect(resolveDropPosition(0, 100)).toBe("before");
    expect(resolveDropPosition(24, 100)).toBe("before");
  });

  it("resolves the bottom quarter to after", () => {
    expect(resolveDropPosition(76, 100)).toBe("after");
    expect(resolveDropPosition(100, 100)).toBe("after");
  });

  it("resolves the middle half to child", () => {
    expect(resolveDropPosition(25, 100)).toBe("child");
    expect(resolveDropPosition(50, 100)).toBe("child");
    expect(resolveDropPosition(75, 100)).toBe("child");
  });

  it("scales with the given height rather than assuming pixels out of 100", () => {
    expect(resolveDropPosition(4, 20)).toBe("before");
    expect(resolveDropPosition(10, 20)).toBe("child");
    expect(resolveDropPosition(16, 20)).toBe("after");
  });

  it("falls back to child for a non-positive height", () => {
    expect(resolveDropPosition(0, 0)).toBe("child");
    expect(resolveDropPosition(0, -10)).toBe("child");
  });
});
