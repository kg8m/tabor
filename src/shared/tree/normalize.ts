import type { TabNode, TreeState } from "./types";

/**
 * Backfills defaults for `TabNode` fields added after trees may already have
 * been saved to `chrome.storage.local` without them. A tree saved before
 * `note` existed would otherwise come back with it `undefined`, which fails
 * the `=== null`/`!== null` checks meant to treat a missing note as "no
 * note" (an untouched `undefined` reads as "has a note" to `!== null`).
 */
export function normalizeTree(tree: TreeState): TreeState {
  const nodes: Record<number, TabNode> = {};
  for (const [id, node] of Object.entries(tree.nodes)) {
    nodes[Number(id)] = { ...node, note: node.note ?? null };
  }
  return { ...tree, nodes };
}
