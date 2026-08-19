import type { MouseEvent } from "react";
import type { NoteEditorAnchor, NoteEditorState } from "../hooks/useNoteEditor";
import { getPinnedNodes } from "../../shared/tree/queries";
import type { TreeState } from "../../shared/tree/types";
import { TabNodeView } from "./TabNodeView";

interface PinnedTabsViewProps {
  tree: TreeState;
  windowId: number | undefined;
  selectedIds: Set<number>;
  contextMenuTargetIds: Set<number>;
  onNodeClick: (id: number, event: MouseEvent) => void;
  onNodeContextMenu: (id: number, event: MouseEvent) => void;
  activeTabId: number | undefined;
  noteEditor: NoteEditorState | null;
  onOpenNoteEditor: (id: number, anchor: NoteEditorAnchor) => void;
  onCloseNoteEditor: () => void;
}

/**
 * Pinned tabs, shown above the regular tree in their own flat list—no
 * collapse toggle or drag-and-drop, since per spec they have no parent/child
 * relationships to fold or reorder into.
 */
export function PinnedTabsView({
  tree,
  windowId,
  selectedIds,
  contextMenuTargetIds,
  onNodeClick,
  onNodeContextMenu,
  activeTabId,
  noteEditor,
  onOpenNoteEditor,
  onCloseNoteEditor,
}: PinnedTabsViewProps) {
  const pinnedNodes = getPinnedNodes(tree);
  if (pinnedNodes.length === 0) {
    return null;
  }

  return (
    <ul className="pinned-tabs">
      {pinnedNodes.map((node) => (
        <li key={node.id} className="pinned-tabs__item">
          <TabNodeView
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
          />
        </li>
      ))}
    </ul>
  );
}
