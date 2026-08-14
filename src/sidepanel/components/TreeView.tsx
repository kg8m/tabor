import type { MouseEvent } from "react";
import { getChildren, getRootNodes } from "../../shared/tree/queries";
import type { TreeState } from "../../shared/tree/types";
import { TabNodeView } from "./TabNodeView";

interface TreeViewProps {
  tree: TreeState;
  selectedIds: Set<number>;
  onNodeClick: (id: number, event: MouseEvent) => void;
}

export function TreeView({ tree, selectedIds, onNodeClick }: TreeViewProps) {
  return (
    <ul className="tree-view">
      {getRootNodes(tree).map((node) => (
        <TreeNode
          key={node.id}
          tree={tree}
          nodeId={node.id}
          ancestorIds={new Set()}
          selectedIds={selectedIds}
          onNodeClick={onNodeClick}
        />
      ))}
    </ul>
  );
}

interface TreeNodeProps {
  tree: TreeState;
  nodeId: number;
  ancestorIds: Set<number>;
  selectedIds: Set<number>;
  onNodeClick: (id: number, event: MouseEvent) => void;
}

function TreeNode({
  tree,
  nodeId,
  ancestorIds,
  selectedIds,
  onNodeClick,
}: TreeNodeProps) {
  const node = tree.nodes[nodeId];
  // If the tree data were ever corrupted into a cycle, a node could end up
  // among its own descendants; bail out instead of recursing forever.
  if (node === undefined || ancestorIds.has(nodeId)) {
    return null;
  }

  const childAncestorIds = new Set(ancestorIds);
  childAncestorIds.add(nodeId);

  const children = getChildren(tree, nodeId);

  return (
    <li className="tree-view__item">
      <TabNodeView
        node={node}
        hasChildren={children.length > 0}
        selected={selectedIds.has(nodeId)}
        onClick={(event) => onNodeClick(nodeId, event)}
      />
      {children.length > 0 && !node.collapsed && (
        <ul className="tree-view__children">
          {children.map((child) => (
            <TreeNode
              key={child.id}
              tree={tree}
              nodeId={child.id}
              ancestorIds={childAncestorIds}
              selectedIds={selectedIds}
              onNodeClick={onNodeClick}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
