import type { MouseEvent } from "react";
import type { DragAndDrop } from "../hooks/useDragAndDrop";
import { getChildren, getRootNodes } from "../../shared/tree/queries";
import type { TreeState } from "../../shared/tree/types";
import { TabNodeView } from "./TabNodeView";

interface TreeViewProps {
  tree: TreeState;
  selectedIds: Set<number>;
  onNodeClick: (id: number, event: MouseEvent) => void;
  dragAndDrop: DragAndDrop;
  activeTabId: number | undefined;
}

export function TreeView({
  tree,
  selectedIds,
  onNodeClick,
  dragAndDrop,
  activeTabId,
}: TreeViewProps) {
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
          dragAndDrop={dragAndDrop}
          activeTabId={activeTabId}
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
  dragAndDrop: DragAndDrop;
  activeTabId: number | undefined;
}

function TreeNode({
  tree,
  nodeId,
  ancestorIds,
  selectedIds,
  onNodeClick,
  dragAndDrop,
  activeTabId,
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
  const { dropIndicator } = dragAndDrop;

  return (
    <li className="tree-view__item">
      <TabNodeView
        node={node}
        hasChildren={children.length > 0}
        selected={selectedIds.has(nodeId)}
        onClick={(event) => onNodeClick(nodeId, event)}
        dropIndicatorPosition={
          dropIndicator?.targetId === nodeId ? dropIndicator.position : null
        }
        onDragStart={(event) => dragAndDrop.onDragStart(nodeId, event)}
        onDragOver={(event) => dragAndDrop.onDragOver(nodeId, event)}
        onDragLeave={() => dragAndDrop.onDragLeave(nodeId)}
        onDrop={(event) => dragAndDrop.onDrop(nodeId, event)}
        onDragEnd={dragAndDrop.onDragEnd}
        isActive={nodeId === activeTabId}
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
              dragAndDrop={dragAndDrop}
              activeTabId={activeTabId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
