import { ContextMenu } from "./components/ContextMenu";
import { PinnedTabsView } from "./components/PinnedTabsView";
import { TreeView } from "./components/TreeView";
import { useActiveTabId } from "./hooks/useActiveTabId";
import { useContextMenu } from "./hooks/useContextMenu";
import { useDragAndDrop } from "./hooks/useDragAndDrop";
import { useScrollActiveIntoView } from "./hooks/useScrollActiveIntoView";
import { useSelection } from "./hooks/useSelection";
import { useWindowId } from "./hooks/useWindowId";
import { useWindowTree } from "./hooks/useWindowTree";

export function App() {
  const windowId = useWindowId();
  const tree = useWindowTree(windowId);
  const activeTabId = useActiveTabId(windowId);
  const { selectedIds, handleNodeClick } = useSelection(tree);
  const dragAndDrop = useDragAndDrop(selectedIds);
  const { menu, openMenu, closeMenu } = useContextMenu();
  useScrollActiveIntoView(activeTabId, tree);

  return (
    <div className="app">
      <PinnedTabsView
        tree={tree}
        selectedIds={selectedIds}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={(id, event) => openMenu(id, event, selectedIds)}
        activeTabId={activeTabId}
      />
      <TreeView
        tree={tree}
        selectedIds={selectedIds}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={(id, event) => openMenu(id, event, selectedIds)}
        dragAndDrop={dragAndDrop}
        activeTabId={activeTabId}
      />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          targetIds={menu.targetIds}
          isEveryTargetPinned={menu.targetIds.every(
            (id) => tree.nodes[id]?.pinned,
          )}
          activeTabId={activeTabId}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
