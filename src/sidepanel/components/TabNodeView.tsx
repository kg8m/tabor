import type { MouseEvent } from "react";
import type { TaborMessage } from "../../shared/messages";
import type { TabNode } from "../../shared/tree/types";

interface TabNodeViewProps {
  node: TabNode;
  hasChildren: boolean;
  selected: boolean;
  onClick: (event: MouseEvent) => void;
}

export function TabNodeView({
  node,
  hasChildren,
  selected,
  onClick,
}: TabNodeViewProps) {
  const handleClose = (event: MouseEvent) => {
    event.stopPropagation();
    void chrome.tabs.remove(node.id);
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
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} onClick={handleClick}>
      {hasChildren ? (
        <button
          type="button"
          className="tab-node__toggle"
          aria-label={node.collapsed ? "Expand" : "Collapse"}
          onClick={handleToggleCollapsed}
        >
          {node.collapsed ? "▶" : "▼"}
        </button>
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
      <button
        type="button"
        className="tab-node__close"
        aria-label="Close tab"
        onClick={handleClose}
      >
        ×
      </button>
    </div>
  );
}
