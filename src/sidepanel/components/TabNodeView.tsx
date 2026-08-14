import type { TabNode } from "../../shared/tree/types";

interface TabNodeViewProps {
  node: TabNode;
}

export function TabNodeView({ node }: TabNodeViewProps) {
  const handleClose = () => {
    void chrome.tabs.remove(node.id);
  };

  return (
    <div
      className={node.suspended ? "tab-node tab-node--suspended" : "tab-node"}
    >
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
