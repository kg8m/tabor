import {
  getChildren,
  getPinnedNodes,
  getUnpinnedRootNodes,
} from "../../shared/tree/queries";
import type { TreeState } from "../../shared/tree/types";
import { ReadOnlyTabNodeRow } from "./ReadOnlyTabNodeRow";

/**
 * A read-only rendering of a saved tree (pinned tabs first, then the
 * unpinned hierarchy), for previewing one inside a `Subview` before acting
 * on it. Laid out the same as the live tree (`PinnedTabList`/`TabTree`),
 * minus anything interactive, and with every node expanded regardless of
 * its saved collapsed state.
 */
export function TreePreview({ tree }: { tree: TreeState }) {
  const pinnedNodes = getPinnedNodes(tree);
  const rootNodes = getUnpinnedRootNodes(tree);

  if (pinnedNodes.length === 0 && rootNodes.length === 0) {
    return <p className="subview__empty">No tabs in this window.</p>;
  }

  return (
    <>
      {pinnedNodes.length > 0 && (
        <ul className="pinned-tab-list">
          {pinnedNodes.map((node) => (
            <li key={node.id} className="pinned-tab-list__item">
              <ReadOnlyTabNodeRow node={node} hasChildren={false} />
            </li>
          ))}
        </ul>
      )}
      <ul className="tab-tree">
        {rootNodes.map((node) => (
          <TreePreviewNode
            key={node.id}
            tree={tree}
            nodeId={node.id}
            ancestorIds={new Set()}
          />
        ))}
      </ul>
    </>
  );
}

function TreePreviewNode({
  tree,
  nodeId,
  ancestorIds,
}: {
  tree: TreeState;
  nodeId: number;
  ancestorIds: Set<number>;
}) {
  const node = tree.nodes[nodeId];
  // Same cycle guard as `TabTree`'s own `TreeNode`.
  if (node === undefined || ancestorIds.has(nodeId)) {
    return null;
  }

  const childAncestorIds = new Set(ancestorIds);
  childAncestorIds.add(nodeId);

  const children = getChildren(tree, nodeId);

  return (
    <li className="tab-tree__item">
      <ReadOnlyTabNodeRow node={node} hasChildren={children.length > 0} />
      {children.length > 0 && (
        <ul className="tab-tree__children">
          {children.map((child) => (
            <TreePreviewNode
              key={child.id}
              tree={tree}
              nodeId={child.id}
              ancestorIds={childAncestorIds}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
