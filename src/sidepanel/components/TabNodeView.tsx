import type { DragEvent, MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { TaborMessage } from "../../shared/messages";
import type { DropPosition } from "../../shared/tree/drop";
import type { TabNode } from "../../shared/tree/types";
import { useRef } from "react";
import { useOverflowDetection } from "../hooks/useOverflowDetection";
import type { NoteEditorAnchor } from "../hooks/useNoteEditor";
import { useTooltip } from "../hooks/useTooltip";
import {
  AudibleIcon,
  ChevronIcon,
  CloseIcon,
  DefaultFaviconIcon,
  LeafIcon,
  NoteIcon,
  PauseIcon,
  PinIcon,
} from "./icons";
import { NoteEditor } from "./NoteEditor";
import { Tooltip } from "./Tooltip";

interface TabNodeViewProps {
  node: TabNode;
  windowId: number | undefined;
  hasChildren?: boolean;
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
  // Omitted for rows that don't take part in drag-and-drop (pinned tabs,
  // which per spec have no parent/child relationships to reorder into).
  dropIndicatorPosition?: DropPosition | null;
  onDragStart?: (event: DragEvent) => void;
  onDragOver?: (event: DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (event: DragEvent) => void;
  onDragEnd?: () => void;
}

/**
 * A single tab row in the tree, with its favicon/title, drag-and-drop
 * handlers, and the pin/pause/audible/note/collapse affordances shown per
 * its state.
 */
export function TabNodeView({
  node,
  windowId,
  hasChildren = false,
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
}: TabNodeViewProps) {
  const { ref: titleReference, isOverflowing: isTitleOverflowing } =
    useOverflowDetection<HTMLSpanElement>(node.title);
  const { ref: noteReference, isOverflowing: isNoteOverflowing } =
    useOverflowDetection<HTMLSpanElement>(node.note ?? "");
  const rowReference = useRef<HTMLDivElement>(null);
  const rowTooltip = useTooltip(rowReference);
  const titleTooltip = useTooltip(titleReference);

  const handleClose = (event: MouseEvent) => {
    event.stopPropagation();
    void (async () => {
      if (windowId !== undefined) {
        const message: TaborMessage = {
          type: "registerPendingClose",
          windowId,
          tabIds: [node.id],
        };
        await chrome.runtime.sendMessage(message);
      }
      await chrome.tabs.remove(node.id);
    })();
  };

  // `chrome.tabs.discard` fires an onUpdated event with the tab's new
  // discarded state, which `handleTabUpdated` already reflects into the
  // tree—no need to route this through a message like `toggleCollapsed`.
  //
  // The button itself is hidden for the active tab (see `isActive` below):
  // Chrome won't actually free memory there since it has to reload the tab
  // right away to keep displaying it, so it'd just look like a page reload.
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

  const handleOpenNoteEditor = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
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
      onContextMenu={onContextMenu}
      onMouseEnter={node.note === null ? undefined : rowTooltip.onMouseEnter}
      onMouseLeave={node.note === null ? undefined : rowTooltip.onMouseLeave}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {hasChildren ? (
        <button
          type="button"
          className="tab-node__toggle"
          aria-label={node.collapsed ? "Expand" : "Collapse"}
          draggable={false}
          onClick={handleToggleCollapsed}
        >
          <ChevronIcon collapsed={node.collapsed} />
        </button>
      ) : node.pinned ? (
        <span
          className="tab-node__toggle tab-node__pin"
          role="img"
          aria-label="Pinned"
        >
          <PinIcon />
        </span>
      ) : (
        <span
          className="tab-node__toggle tab-node__leaf"
          role="img"
          aria-label="No children"
        >
          <LeafIcon />
        </span>
      )}
      {node.loading ? (
        <span className="tab-node__favicon tab-node__spinner" />
      ) : node.favIconUrl ? (
        <img className="tab-node__favicon" src={node.favIconUrl} alt="" />
      ) : (
        // Falsy rather than `=== undefined`: a tree saved before favIconUrl
        // started normalizing an empty string to `undefined` (see
        // `toActualTab`) can still have one on disk, which would otherwise
        // render as `<img src="">`.
        <span className="tab-node__favicon tab-node__favicon--default">
          <DefaultFaviconIcon />
        </span>
      )}
      <span
        ref={titleReference}
        className={
          isTitleOverflowing
            ? "tab-node__title tab-node__title--overflowing"
            : "tab-node__title"
        }
        onMouseEnter={titleTooltip.onMouseEnter}
        onMouseLeave={titleTooltip.onMouseLeave}
      >
        {node.title}
      </span>
      {node.audible && (
        <span
          className="tab-node__audible"
          role="img"
          aria-label="Playing audio"
        >
          <AudibleIcon />
        </span>
      )}
      {node.note === null ? (
        <span className="tab-node__note-spacer" aria-hidden="true" />
      ) : (
        <span
          ref={noteReference}
          className={
            isNoteOverflowing
              ? "tab-node__note-text tab-node__note-text--overflowing"
              : "tab-node__note-text"
          }
        >
          {node.note}
        </span>
      )}
      {node.note !== null && (
        <span className="tab-node__note-icon-spacer" aria-hidden="true" />
      )}
      {titleTooltip.isVisible && (
        <Tooltip
          text={node.title}
          secondaryText={node.url}
          anchor={titleTooltip.anchor}
        />
      )}
      {rowTooltip.isVisible && node.note !== null && (
        <Tooltip text={node.note} anchor={rowTooltip.anchor} />
      )}
      {editingNoteAnchor &&
        // Portaled to `document.body` rather than rendered in place: this
        // row can carry `opacity` (e.g. `.tab-node--suspended`), which would
        // otherwise wash out the popover too, `position: fixed` or not—
        // opacity applies to a whole subtree's compositing, independent of
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
