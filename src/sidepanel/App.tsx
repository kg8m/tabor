import { TreeView } from "./components/TreeView";
import { useSelection } from "./hooks/useSelection";
import { useWindowTree } from "./hooks/useWindowTree";

export function App() {
  const tree = useWindowTree();
  const { selectedIds, handleNodeClick } = useSelection(tree);

  return (
    <TreeView
      tree={tree}
      selectedIds={selectedIds}
      onNodeClick={handleNodeClick}
    />
  );
}
