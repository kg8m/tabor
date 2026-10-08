import type { MouseEvent } from "react";
import type { DragAndDrop } from "../hooks/useDragAndDrop";
import type { NoteEditorAnchor, NoteEditorState } from "../hooks/useNoteEditor";
import { getPinnedNodes } from "../../shared/tree/queries";
import type { TreeState } from "../../shared/tree/types";
import { TabNodeRow } from "./TabNodeRow";

interface PinnedTabListProps {
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
 * Pinned tabs, shown above the regular tree in their own flat list—no
 * collapse toggle, since per spec they have no parent/child relationships to
 * fold into, but still reorderable among themselves via drag-and-drop (see
 * `dragAndDrop`, a separate instance from the one `TabTree` uses so a drag
 * can never cross between the two areas).
 */
export function PinnedTabList({
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
}: PinnedTabListProps) {
  const pinnedNodes = getPinnedNodes(tree);
  if (pinnedNodes.length === 0) {
    return null;
  }

  // The last pinned tab, so a drop in the empty space below the list—e.g.
  // when there are too few pinned tabs to fill it—always resolves to
  // “become the new last pinned tab” instead of being silently ignored.
  const lastPinnedId = pinnedNodes.at(-1)?.id ?? null;
  const { dropIndicator } = dragAndDrop;

  return (
    <ul
      className="pinned-tab-list"
      onDragOver={(event) =>
        dragAndDrop.onContainerDragOver(lastPinnedId, event)
      }
      onDrop={(event) => dragAndDrop.onContainerDrop(lastPinnedId, event)}
    >
      {pinnedNodes.map((node) => (
        <li key={node.id} className="pinned-tab-list__item">
          <TabNodeRow
            node={node}
            windowId={windowId}
            selected={selectedIds.has(node.id)}
            isContextMenuTarget={contextMenuTargetIds.has(node.id)}
            onClick={(event) => onNodeClick(node.id, event)}
            onContextMenu={(event) => onNodeContextMenu(node.id, event)}
            isActive={node.id === activeTabId}
            editingNoteAnchor={
              noteEditor?.tabId === node.id ? noteEditor.anchor : null
            }
            onOpenNoteEditor={(anchor) => onOpenNoteEditor(node.id, anchor)}
            onCloseNoteEditor={onCloseNoteEditor}
            dropIndicatorPosition={
              dropIndicator?.kind === "node" &&
              dropIndicator.targetId === node.id
                ? dropIndicator.position
                : null
            }
            onDragStart={(event) => dragAndDrop.onDragStart(node.id, event)}
            onDragOver={(event) => dragAndDrop.onDragOver(node.id, event)}
            onDragLeave={() => dragAndDrop.onDragLeave(node.id)}
            onDrop={(event) => dragAndDrop.onDrop(node.id, event)}
            onDragEnd={dragAndDrop.onDragEnd}
          />
        </li>
      ))}
      {dropIndicator?.kind === "end" && (
        <li className="pinned-tab-list__end-indicator" aria-hidden="true" />
      )}
    </ul>
  );
}
