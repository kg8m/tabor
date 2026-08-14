import { PinnedTabsView } from "./components/PinnedTabsView";
import { TreeView } from "./components/TreeView";
import { useActiveTabId } from "./hooks/useActiveTabId";
import { useDragAndDrop } from "./hooks/useDragAndDrop";
import { useSelection } from "./hooks/useSelection";
import { useWindowId } from "./hooks/useWindowId";
import { useWindowTree } from "./hooks/useWindowTree";

export function App() {
  const windowId = useWindowId();
  const tree = useWindowTree(windowId);
  const activeTabId = useActiveTabId(windowId);
  const { selectedIds, handleNodeClick } = useSelection(tree);
  const dragAndDrop = useDragAndDrop(selectedIds);

  return (
    <>
      <PinnedTabsView
        tree={tree}
        selectedIds={selectedIds}
        onNodeClick={handleNodeClick}
        activeTabId={activeTabId}
      />
      <TreeView
        tree={tree}
        selectedIds={selectedIds}
        onNodeClick={handleNodeClick}
        dragAndDrop={dragAndDrop}
        activeTabId={activeTabId}
      />
    </>
  );
}
