import type { MouseEvent } from "react";
import type { DragAndDrop } from "../hooks/useDragAndDrop";
import type { NoteEditorAnchor, NoteEditorState } from "../hooks/useNoteEditor";
import {
  getChildren,
  getUnpinnedRootNodes,
  getVisibleOrder,
} from "../../shared/tree/queries";
import type { TreeState } from "../../shared/tree/types";
import { TabNodeView } from "./TabNodeView";

interface TreeViewProps {
  tree: TreeState;
  windowId: number | undefined;
  selectedIds: Set<number>;
  contextMenuTargetIds: Set<number>;
  onNodeClick: (id: number, event: MouseEvent) => void;
  onNodeContextMenu: (id: number, event: MouseEvent) => void;
  dragAndDrop: DragAndDrop;
  activeTabId: number | undefined;
  noteEditor: NoteEditorState | null;
  onOpenNoteEditor: (id: number, anchor: NoteEditorAnchor) => void;
  onCloseNoteEditor: () => void;
}

export function TreeView({
  tree,
  windowId,
  selectedIds,
  contextMenuTargetIds,
  onNodeClick,
  onNodeContextMenu,
  dragAndDrop,
  activeTabId,
  noteEditor,
  onOpenNoteEditor,
  onCloseNoteEditor,
}: TreeViewProps) {
  // The last visible (unpinned) row, so a drop in the empty space below it—
  // e.g. when there are too few tabs to fill the panel—resolves to "move to
  // the end" instead of being silently ignored.
  // `.filter(…).at(-1)` rather than `.findLast(…)`: the latter needs an
  // ES2023 lib, one newer than this project's ES2022 target.
  /* eslint-disable unicorn/prefer-array-find */
  const lastVisibleId =
    getVisibleOrder(tree)
      .filter((node) => !node.pinned)
      .at(-1)?.id ?? null;
  /* eslint-enable unicorn/prefer-array-find */

  return (
    <ul
      className="tree-view"
      onDragOver={(event) =>
        dragAndDrop.onContainerDragOver(lastVisibleId, event)
      }
      onDrop={(event) => dragAndDrop.onContainerDrop(lastVisibleId, event)}
    >
      {getUnpinnedRootNodes(tree).map((node) => (
        <TreeNode
          key={node.id}
          tree={tree}
          windowId={windowId}
          nodeId={node.id}
          ancestorIds={new Set()}
          selectedIds={selectedIds}
          contextMenuTargetIds={contextMenuTargetIds}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          dragAndDrop={dragAndDrop}
          activeTabId={activeTabId}
          noteEditor={noteEditor}
          onOpenNoteEditor={onOpenNoteEditor}
          onCloseNoteEditor={onCloseNoteEditor}
        />
      ))}
    </ul>
  );
}

interface TreeNodeProps {
  tree: TreeState;
  windowId: number | undefined;
  nodeId: number;
  ancestorIds: Set<number>;
  selectedIds: Set<number>;
  contextMenuTargetIds: Set<number>;
  onNodeClick: (id: number, event: MouseEvent) => void;
  onNodeContextMenu: (id: number, event: MouseEvent) => void;
  dragAndDrop: DragAndDrop;
  activeTabId: number | undefined;
  noteEditor: NoteEditorState | null;
  onOpenNoteEditor: (id: number, anchor: NoteEditorAnchor) => void;
  onCloseNoteEditor: () => void;
}

function TreeNode({
  tree,
  windowId,
  nodeId,
  ancestorIds,
  selectedIds,
  contextMenuTargetIds,
  onNodeClick,
  onNodeContextMenu,
  dragAndDrop,
  activeTabId,
  noteEditor,
  onOpenNoteEditor,
  onCloseNoteEditor,
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
        windowId={windowId}
        hasChildren={children.length > 0}
        selected={selectedIds.has(nodeId)}
        isContextMenuTarget={contextMenuTargetIds.has(nodeId)}
        onClick={(event) => onNodeClick(nodeId, event)}
        onContextMenu={(event) => onNodeContextMenu(nodeId, event)}
        editingNoteAnchor={
          noteEditor?.tabId === nodeId ? noteEditor.anchor : null
        }
        onOpenNoteEditor={(anchor) => onOpenNoteEditor(nodeId, anchor)}
        onCloseNoteEditor={onCloseNoteEditor}
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
      {children.length > 0 && (
        <div
          className={
            "tree-view__children-outer" +
            (node.collapsed ? " tree-view__children-outer--collapsed" : "")
          }
        >
          <ul className="tree-view__children">
            {children.map((child) => (
              <TreeNode
                key={child.id}
                tree={tree}
                windowId={windowId}
                nodeId={child.id}
                ancestorIds={childAncestorIds}
                selectedIds={selectedIds}
                contextMenuTargetIds={contextMenuTargetIds}
                onNodeClick={onNodeClick}
                onNodeContextMenu={onNodeContextMenu}
                dragAndDrop={dragAndDrop}
                activeTabId={activeTabId}
                noteEditor={noteEditor}
                onOpenNoteEditor={onOpenNoteEditor}
                onCloseNoteEditor={onCloseNoteEditor}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
