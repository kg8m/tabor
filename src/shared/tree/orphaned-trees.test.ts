import { describe, expect, it } from "vitest";
import { selectOrphanedTreeIds } from "./orphaned-trees";

describe("selectOrphanedTreeIds", () => {
  it("selects saved tree ids that no open window holds", () => {
    expect(selectOrphanedTreeIds(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });

  it("selects nothing when every saved tree is held", () => {
    expect(selectOrphanedTreeIds(["a", "b"], ["a", "b", "c"])).toEqual([]);
  });

  it("selects every saved tree id when no window holds any", () => {
    expect(selectOrphanedTreeIds(["a", "b"], [])).toEqual(["a", "b"]);
  });
});
