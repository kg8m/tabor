import type { MouseEvent } from "react";
import type { DragAndDrop } from "../hooks/useDragAndDrop";
import type { NoteEditorAnchor, NoteEditorState } from "../hooks/useNoteEditor";
import { getChildren, getUnpinnedRootNodes } from "../../shared/tree/queries";
import type { TreeState } from "../../shared/tree/types";
import { TabNodeRow } from "./TabNodeRow";

interface TabTreeProps {
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

/**
 * Renders every unpinned root node (and its descendants) as the tree,
 * delegating each row's own rendering to `TabNodeRow`.
 */
export function TabTree({
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
}: TabTreeProps) {
  const unpinnedRootNodes = getUnpinnedRootNodes(tree);
  // The last top-level (unpinned root) tab, so a drop in the empty space
  // below the tree—e.g. when there are too few tabs to fill the panel—
  // always resolves to "become a new last top-level tab" instead of being
  // silently ignored.
  const lastRootId = unpinnedRootNodes.at(-1)?.id ?? null;

  return (
    <ul
      className="tab-tree"
      onDragOver={(event) => dragAndDrop.onContainerDragOver(lastRootId, event)}
      onDrop={(event) => dragAndDrop.onContainerDrop(lastRootId, event)}
    >
      {unpinnedRootNodes.map((node) => (
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
      {dragAndDrop.dropIndicator?.kind === "end" && (
        <li className="tab-tree__end-indicator" aria-hidden="true" />
      )}
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
    <li className="tab-tree__item">
      <TabNodeRow
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
          dropIndicator?.kind === "node" && dropIndicator.targetId === nodeId
            ? dropIndicator.position
            : null
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
            "tab-tree__children-outer" +
            (node.collapsed ? " tab-tree__children-outer--collapsed" : "")
          }
        >
          <ul className="tab-tree__children">
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
