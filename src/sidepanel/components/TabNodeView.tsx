import type { TaborMessage } from "../../shared/messages";
import type { TabNode } from "../../shared/tree/types";

interface TabNodeViewProps {
  node: TabNode;
  hasChildren: boolean;
}

export function TabNodeView({ node, hasChildren }: TabNodeViewProps) {
  const handleClose = () => {
    void chrome.tabs.remove(node.id);
  };

  const handleToggleCollapsed = () => {
    const message: TaborMessage = { type: "toggleCollapsed", tabId: node.id };
    void chrome.runtime.sendMessage(message);
  };

  return (
    <div
      className={node.suspended ? "tab-node tab-node--suspended" : "tab-node"}
    >
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
