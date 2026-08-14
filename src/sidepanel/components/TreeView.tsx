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
        <TreeNode key={node.id} tree={tree} nodeId={node.id} />
      ))}
    </ul>
  );
}

interface TreeNodeProps {
  tree: TreeState;
  nodeId: number;
}

function TreeNode({ tree, nodeId }: TreeNodeProps) {
  const node = tree.nodes[nodeId];
  if (node === undefined) {
    return null;
  }

  const children = getChildren(tree, nodeId);

  return (
    <li className="tree-view__item">
      <TabNodeView node={node} />
      {children.length > 0 && (
        <ul className="tree-view__children">
          {children.map((child) => (
            <TreeNode key={child.id} tree={tree} nodeId={child.id} />
          ))}
        </ul>
      )}
    </li>
  );
}
