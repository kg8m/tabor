import {
  getChildren,
  getPinnedNodes,
  getUnpinnedRootNodes,
} from "../../shared/tree/queries";
import type { TreeState } from "../../shared/tree/types";
import { DefaultFaviconIcon } from "./icons";

/**
 * A read-only rendering of a saved tree (pinned tabs first, then the
 * unpinned hierarchy), for previewing one inside a `Subview` before acting
 * on it.
 */
export function TreePreview({ tree }: { tree: TreeState }) {
  const pinnedNodes = getPinnedNodes(tree);
  const rootNodes = getUnpinnedRootNodes(tree);

  if (pinnedNodes.length === 0 && rootNodes.length === 0) {
    return <p className="subview__empty">No tabs in this window.</p>;
  }

  return (
    <ul className="tree-preview">
      {[...pinnedNodes, ...rootNodes].map((node) => (
        <TreePreviewNode key={node.id} tree={tree} nodeId={node.id} />
      ))}
    </ul>
  );
}

function TreePreviewNode({
  tree,
  nodeId,
}: {
  tree: TreeState;
  nodeId: number;
}) {
  const node = tree.nodes[nodeId];
  if (node === undefined) {
    return null;
  }

  const children = getChildren(tree, nodeId);

  return (
    <li className="tree-preview__item">
      <div className="tree-preview__row">
        {node.favIconUrl ? (
          <img className="tree-preview__favicon" src={node.favIconUrl} alt="" />
        ) : (
          <span className="tree-preview__favicon tree-preview__favicon--default">
            <DefaultFaviconIcon />
          </span>
        )}
        <span className="tree-preview__title">{node.title}</span>
      </div>
      {children.length > 0 && (
        <ul className="tree-preview__children">
          {children.map((child) => (
            <TreePreviewNode key={child.id} tree={tree} nodeId={child.id} />
          ))}
        </ul>
      )}
    </li>
  );
}
