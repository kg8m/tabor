import { useEffect, useState, type MouseEvent } from "react";
import { BackupHistoryPanel } from "./components/BackupHistoryPanel";
import { ContextMenu } from "./components/ContextMenu";
import { HistoryIcon } from "./components/icons";
import { PinnedTabsView } from "./components/PinnedTabsView";
import { TreeView } from "./components/TreeView";
import { useActiveTabId } from "./hooks/useActiveTabId";
import { useContextMenu } from "./hooks/useContextMenu";
import { useDragAndDrop } from "./hooks/useDragAndDrop";
import { useNoteEditor } from "./hooks/useNoteEditor";
import { useScrollActiveIntoView } from "./hooks/useScrollActiveIntoView";
import { useSelection } from "./hooks/useSelection";
import { useWindowId } from "./hooks/useWindowId";
import { useWindowTree } from "./hooks/useWindowTree";
import { getDescendantIds } from "../shared/tree/queries";

export function App() {
  const windowId = useWindowId();
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const { tree, isLoading } = useWindowTree(windowId);
  const activeTabId = useActiveTabId(windowId);
  const { selectedIds, handleNodeClick, clearSelection } = useSelection(
    tree,
    activeTabId,
  );
  const dragAndDrop = useDragAndDrop(selectedIds);
  const { menu, openMenu, closeMenu } = useContextMenu();
  const { editor: noteEditor, openEditor, closeEditor } = useNoteEditor();
  const contextMenuTargetIds = menu
    ? new Set(menu.targetIds)
    : new Set<number>();
  // The context menu's own note item only applies to a single-tab
  // selection, so this is `undefined` for a multi-selection.
  const contextMenuSingleTargetId =
    menu?.targetIds.length === 1 ? menu.targetIds[0] : undefined;
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
    <div className="app-shell">
      <header className="app-header">
        <button
          type="button"
          className="app-header__history-button"
          aria-label="Backup history"
          onClick={() => setIsHistoryOpen(true)}
        >
          <HistoryIcon />
        </button>
      </header>
      <div className="app" onClick={handleBackgroundClick}>
        {isLoading ? (
          <div className="app__loading">
            <span className="app__loading-spinner" />
            <p className="app__loading-text">Loading tabs…</p>
          </div>
        ) : (
          <>
            <PinnedTabsView
              tree={tree}
              windowId={windowId}
              selectedIds={selectedIds}
              contextMenuTargetIds={contextMenuTargetIds}
              onNodeClick={handleNodeClick}
              onNodeContextMenu={(id, event) =>
                openMenu(id, event, selectedIds)
              }
              activeTabId={activeTabId}
              noteEditor={noteEditor}
              onOpenNoteEditor={openEditor}
              onCloseNoteEditor={closeEditor}
            />
            <TreeView
              tree={tree}
              windowId={windowId}
              selectedIds={selectedIds}
              contextMenuTargetIds={contextMenuTargetIds}
              onNodeClick={handleNodeClick}
              onNodeContextMenu={(id, event) =>
                openMenu(id, event, selectedIds)
              }
              dragAndDrop={dragAndDrop}
              activeTabId={activeTabId}
              noteEditor={noteEditor}
              onOpenNoteEditor={openEditor}
              onCloseNoteEditor={closeEditor}
            />
          </>
        )}
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            windowId={windowId}
            targetIds={menu.targetIds}
            treeIds={[
              ...new Set(
                menu.targetIds.flatMap((id) => [
                  id,
                  ...getDescendantIds(tree, id),
                ]),
              ),
            ]}
            isEveryTargetPinned={menu.targetIds.every(
              (id) => tree.nodes[id]?.pinned,
            )}
            activeTabId={activeTabId}
            targetNote={
              contextMenuSingleTargetId === undefined
                ? undefined
                : tree.nodes[contextMenuSingleTargetId]?.note
            }
            onOpenNoteEditor={(anchor) => {
              if (contextMenuSingleTargetId !== undefined) {
                openEditor(contextMenuSingleTargetId, anchor);
              }
            }}
            onClose={closeMenu}
          />
        )}
      </div>
      {isHistoryOpen && (
        <BackupHistoryPanel
          windowId={windowId}
          onClose={() => setIsHistoryOpen(false)}
        />
      )}
    </div>
  );
}
