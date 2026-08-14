import type { DragEvent, MouseEvent } from "react";
import type { TaborMessage } from "../../shared/messages";
import type { DropPosition } from "../../shared/tree/drop";
import type { TabNode } from "../../shared/tree/types";
import { ChevronIcon, CloseIcon, PauseIcon, PinIcon } from "./icons";

interface TabNodeViewProps {
  node: TabNode;
  hasChildren?: boolean;
  selected: boolean;
  onClick: (event: MouseEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
  isActive: boolean;
  // Omitted for rows that don't take part in drag-and-drop (pinned tabs,
  // which per spec have no parent/child relationships to reorder into).
  dropIndicatorPosition?: DropPosition | null;
  onDragStart?: (event: DragEvent) => void;
  onDragOver?: (event: DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (event: DragEvent) => void;
  onDragEnd?: () => void;
}

export function TabNodeView({
  node,
  hasChildren = false,
  selected,
  onClick,
  onContextMenu,
  isActive,
  dropIndicatorPosition = null,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: TabNodeViewProps) {
  const handleClose = (event: MouseEvent) => {
    event.stopPropagation();
    void chrome.tabs.remove(node.id);
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

  const className = [
    "tab-node",
    node.suspended && "tab-node--suspended",
    selected && "tab-node--selected",
    isActive && "tab-node--active",
    dropIndicatorPosition && `tab-node--drop-${dropIndicatorPosition}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      data-tab-id={node.id}
      draggable={onDragStart !== undefined}
      onClick={handleClick}
      onContextMenu={onContextMenu}
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
        <span className="tab-node__toggle" />
      )}
      {node.loading ? (
        <span className="tab-node__favicon tab-node__spinner" />
      ) : node.favIconUrl === undefined ? (
        <span className="tab-node__favicon" />
      ) : (
        <img className="tab-node__favicon" src={node.favIconUrl} alt="" />
      )}
      <span className="tab-node__title">{node.title}</span>
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
      </div>
    </div>
  );
}
