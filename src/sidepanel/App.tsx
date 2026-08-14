import { useEffect, type MouseEvent } from "react";
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
  const { selectedIds, handleNodeClick, clearSelection } = useSelection(tree);
  const dragAndDrop = useDragAndDrop(selectedIds);
  const { menu, openMenu, closeMenu } = useContextMenu();
  useScrollActiveIntoView(activeTabId, tree);

  // Escape only clears the selection when no context menu is open: the menu
  // has its own Escape handler to close itself, and letting both fire at
  // once would drop the selection out from under a menu the user might still
  // want to act on after backing out of an accidental right-click.
  useEffect(() => {
    if (menu) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        clearSelection();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu, clearSelection]);

  // Clears the selection on a click that doesn't land on any tab row—checked
  // via `closest` rather than target === currentTarget, so this also catches
  // clicks in the indentation/guide-line gutters between rows, not just the
  // empty space below the last one.
  const handleBackgroundClick = (event: MouseEvent): void => {
    if ((event.target as HTMLElement).closest(".tab-node")) {
      return;
    }
    clearSelection();
  };

  return (
    <div className="app" onClick={handleBackgroundClick}>
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
