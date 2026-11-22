import type { DragEvent, MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { TaborMessage } from "../../shared/messages";
import type { DropPosition } from "../../shared/tree/drop";
import type { TabNode } from "../../shared/tree/types";
import { useRef } from "react";
import { closeTabs } from "../close-tabs";
import type { NoteEditorAnchor } from "../hooks/useNoteEditor";
import { useTooltip } from "../hooks/useTooltip";
import { CloseIcon, NoteIcon, PauseIcon } from "./icons";
import { NoteEditor } from "./NoteEditor";
import { TabNodeContent } from "./TabNodeContent";
import { Tooltip } from "./Tooltip";

interface TabNodeRowProps {
  node: TabNode;
  windowId: number | undefined;
  hasChildren?: boolean;
  // See `TabNodeContent`.
  hiddenDescendantCount?: number;
  selected: boolean;
  onClick: (event: MouseEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
  isActive: boolean;
  isContextMenuTarget: boolean;
  // Non-null only for the one row whose note editor is currently open,
  // carrying where to anchor it (see `NoteEditor`).
  editingNoteAnchor: NoteEditorAnchor | null;
  onOpenNoteEditor: (anchor: NoteEditorAnchor) => void;
  onCloseNoteEditor: () => void;
  // Omitted for rows that don’t take part in drag-and-drop (pinned tabs,
  // which per spec have no parent/child relationships to reorder into).
  dropIndicatorPosition?: DropPosition | null;
  onDragStart?: (event: DragEvent) => void;
  onDragOver?: (event: DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (event: DragEvent) => void;
  onDragEnd?: () => void;
}

/**
 * A single tab row in the tree: `TabNodeContent`’s favicon/title/note and
 * collapse toggle, plus the drag-and-drop handlers, hover tooltip, note
 * editor, and pause/close/note buttons shown per its state.
 */
export function TabNodeRow({
  node,
  windowId,
  hasChildren = false,
  hiddenDescendantCount,
  selected,
  onClick,
  onContextMenu,
  isActive,
  isContextMenuTarget,
  editingNoteAnchor,
  onOpenNoteEditor,
  onCloseNoteEditor,
  dropIndicatorPosition = null,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: TabNodeRowProps) {
  const rowReference = useRef<HTMLDivElement>(null);
  const faviconReference = useRef<HTMLElement>(null);
  // Shown only on hovering the favicon, so moving the pointer across rows
  // doesn’t keep popping tooltips up over the rows above, but positioned off
  // of the whole row, so it doesn’t cover the row itself.
  const rowTooltip = useTooltip(faviconReference, "above", rowReference);

  const handleClose = (event: MouseEvent) => {
    event.stopPropagation();
    void closeTabs(windowId, [node.id]);
  };

  // `chrome.tabs.discard` fires an onUpdated event with the tab’s new
  // discarded state, which `handleTabUpdated` already reflects into the
  // tree—no need to route this through a message like `toggleCollapsed`.
  //
  // The button itself is hidden for the active tab (see `isActive` below):
  // Chrome won’t actually free memory there since it has to reload the tab
  // right away to keep displaying it, so it’d just look like a page reload.
  const handleSuspend = (event: MouseEvent) => {
    event.stopPropagation();
    void chrome.tabs.discard(node.id);
  };

  const handleToggleCollapsed = (event: MouseEvent) => {
    event.stopPropagation();
    const message: TaborMessage = { type: "toggleCollapsed", tabId: node.id };
    void chrome.runtime.sendMessage(message);
  };

  // A plain click also switches to the tab, matching how clicking a tab in
  // the native tab bar behaves; Ctrl/Cmd/Shift-click only adjust the
  // selection.
  const handleClick = (event: MouseEvent) => {
    onClick(event);
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
      void chrome.tabs.update(node.id, { active: true });
    }
  };

  // Not while this row’s note editor is open: the tooltip would otherwise
  // pop up over the editor, or the moment it closes.
  const handleFaviconMouseEnter = () => {
    if (editingNoteAnchor) {
      return;
    }

    rowTooltip.onMouseEnter();
  };

  // Without this, a right-click while still hovering the row leaves the
  // tooltip’s `isVisible` stuck `true` (only `mouseleave` clears it), and its
  // `document.body` portal—appended after `#root` in the DOM—then paints
  // above the context menu despite both sharing the same z-index.
  const handleContextMenu = (event: MouseEvent) => {
    rowTooltip.onMouseLeave();
    onContextMenu(event);
  };

  // Once a drag starts, the browser stops firing ordinary mouse events
  // (`mouseleave` included) on the dragged element until the drag ends—so a
  // tooltip already showing from a pre-drag hover would otherwise stay
  // stuck on screen for the whole drag, covering the drop indicators.
  const handleDragStart = (event: DragEvent) => {
    rowTooltip.onMouseLeave();
    onDragStart?.(event);
  };

  const handleOpenNoteEditor = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    rowTooltip.onMouseLeave();
    const rect = event.currentTarget.getBoundingClientRect();
    onOpenNoteEditor({ x: rect.left, y: rect.bottom });
  };

  const className = [
    "tab-node",
    node.suspended && "tab-node--suspended",
    selected && "tab-node--selected",
    isActive && "tab-node--active",
    isContextMenuTarget && "tab-node--context-target",
    node.note !== null && "tab-node--has-note",
    dropIndicatorPosition && `tab-node--drop-${dropIndicatorPosition}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={rowReference}
      className={className}
      data-tab-id={node.id}
      draggable={onDragStart !== undefined}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <TabNodeContent
        node={node}
        hasChildren={hasChildren}
        onToggleCollapsed={handleToggleCollapsed}
        hiddenDescendantCount={hiddenDescendantCount}
        faviconReference={(element) => {
          faviconReference.current = element;
        }}
        onFaviconMouseEnter={handleFaviconMouseEnter}
        onFaviconMouseLeave={rowTooltip.onMouseLeave}
      />
      {/* Suppressed while this row’s note editor is open, so it never shows
          up on top of the editor. */}
      {rowTooltip.isVisible && !editingNoteAnchor && (
        <Tooltip
          text={node.title}
          secondaryText={node.url}
          noteText={node.note ?? undefined}
          anchor={rowTooltip.anchor}
        />
      )}
      {editingNoteAnchor &&
        // Portaled to `document.body` rather than rendered in place: this
        // row can carry `opacity` (e.g. `.tab-node--suspended`), which would
        // otherwise wash out the popover too, `position: fixed` or not—
        // opacity applies to a whole subtree’s compositing, independent of
        // how any of its descendants are positioned.
        createPortal(
          <NoteEditor
            tabId={node.id}
            anchor={editingNoteAnchor}
            initialNote={node.note}
            onClose={onCloseNoteEditor}
          />,
          document.body,
        )}
      <div className="tab-node__actions">
        {!node.suspended && !isActive && (
          <button
            type="button"
            className="tab-node__suspend"
            aria-label="Suspend tab"
            draggable={false}
            onClick={handleSuspend}
          >
            <PauseIcon />
          </button>
        )}
        <button
          type="button"
          className="tab-node__close"
          aria-label="Close tab"
          draggable={false}
          onClick={handleClose}
        >
          <CloseIcon />
        </button>
        <button
          type="button"
          className={
            "tab-node__note-button" +
            (node.note === null ? "" : " tab-node__note-button--has-note")
          }
          aria-label={node.note === null ? "Add note" : "Edit note"}
          draggable={false}
          onClick={handleOpenNoteEditor}
        >
          <NoteIcon />
        </button>
      </div>
    </div>
  );
}
