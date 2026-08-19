import { describe, expect, it } from "vitest";
import { normalizeTree } from "./normalize";
import { createNode } from "./test-helpers";
import type { TreeState } from "./types";

describe("normalizeTree", () => {
  it("backfills a missing note as null, e.g. a tree saved before note existed", () => {
    const a = createNode({ id: 1 });
    // Simulates data saved before `note` existed on `TabNode`.
    const legacyNode = { ...a, note: undefined } as unknown as typeof a;
    const tree: TreeState = { nodes: { 1: legacyNode }, rootIds: [1] };

    const result = normalizeTree(tree);

    expect(result.nodes[1]?.note).toBeNull();
  });

  it("leaves an existing note untouched", () => {
    const a = createNode({ id: 1, note: "Remember this" });
    const tree: TreeState = { nodes: { 1: a }, rootIds: [1] };

    const result = normalizeTree(tree);

    expect(result.nodes[1]?.note).toBe("Remember this");
  });
});
