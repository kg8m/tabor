import { TreeView } from "./components/TreeView";
import { useDragAndDrop } from "./hooks/useDragAndDrop";
import { useSelection } from "./hooks/useSelection";
import { useWindowTree } from "./hooks/useWindowTree";

export function App() {
  const tree = useWindowTree();
  const { selectedIds, handleNodeClick } = useSelection(tree);
  const dragAndDrop = useDragAndDrop();

  return (
    <TreeView
      tree={tree}
      selectedIds={selectedIds}
      onNodeClick={handleNodeClick}
      dragAndDrop={dragAndDrop}
    />
  );
}
