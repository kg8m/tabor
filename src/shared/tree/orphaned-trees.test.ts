import { describe, expect, it } from "vitest";
import { selectOrphanedWindowIds } from "./orphaned-trees";

describe("selectOrphanedWindowIds", () => {
  it("selects saved window ids that no open window has", () => {
    expect(selectOrphanedWindowIds([1, 2, 3], [2])).toEqual([1, 3]);
  });

  it("selects nothing when every saved window is open", () => {
    expect(selectOrphanedWindowIds([1, 2], [1, 2, 3])).toEqual([]);
  });

  it("selects every saved window id when no window is open", () => {
    expect(selectOrphanedWindowIds([1, 2], [])).toEqual([1, 2]);
  });
});
