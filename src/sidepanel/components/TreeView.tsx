import { getChildren, getRootNodes } from "../../shared/tree/queries";
import type { TreeState } from "../../shared/tree/types";
import { TabNodeView } from "./TabNodeView";

interface TreeViewProps {
  tree: TreeState;
}

export function TreeView({ tree }: TreeViewProps) {
  return (
    <ul className="tree-view">
      {getRootNodes(tree).map((node) => (
        <TreeNode
          key={node.id}
          tree={tree}
          nodeId={node.id}
          ancestorIds={new Set()}
        />
      ))}
    </ul>
  );
}

interface TreeNodeProps {
  tree: TreeState;
  nodeId: number;
  ancestorIds: Set<number>;
}

function TreeNode({ tree, nodeId, ancestorIds }: TreeNodeProps) {
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
      <TabNodeView node={node} />
      {children.length > 0 && (
        <ul className="tree-view__children">
          {children.map((child) => (
            <TreeNode
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
