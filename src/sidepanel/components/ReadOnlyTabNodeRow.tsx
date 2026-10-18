import { useRef } from "react";
import type { TabNode } from "../../shared/tree/types";
import { useTooltip } from "../hooks/useTooltip";
import { NoteIcon } from "./icons";
import { TabNodeContent } from "./TabNodeContent";
import { Tooltip } from "./Tooltip";

interface ReadOnlyTabNodeRowProps {
  node: TabNode;
  hasChildren: boolean;
}

/**
 * A single tab row in a saved tree’s preview (see `TreePreview`): the same
 * `TabNodeContent` and hover tooltip as the live tree’s `TabNodeRow`, minus
 * anything interactive. A note-having row shows a non-clickable note icon
 * where `TabNodeRow` shows its note button.
 */
export function ReadOnlyTabNodeRow({
  node,
  hasChildren,
}: ReadOnlyTabNodeRowProps) {
  const rowReference = useRef<HTMLDivElement>(null);
  const rowTooltip = useTooltip(rowReference, "above");

  const className = [
    "tab-node",
    "tab-node--readonly",
    node.suspended && "tab-node--suspended",
    node.note !== null && "tab-node--has-note",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={rowReference}
      className={className}
      onMouseEnter={rowTooltip.onMouseEnter}
      onMouseLeave={rowTooltip.onMouseLeave}
    >
      {/* Loading and audible were only true as of when the tree was saved,
          so they’re left out rather than shown as if still current. Every
          node is shown expanded (see `TreePreview`), so its chevron says so
          too, whatever its saved collapsed state. */}
      <TabNodeContent
        node={{ ...node, loading: false, audible: false, collapsed: false }}
        hasChildren={hasChildren}
      />
      {node.note !== null && (
        <span
          className="tab-node__note-indicator"
          role="img"
          aria-label="Has note"
        >
          <NoteIcon />
        </span>
      )}
      {rowTooltip.isVisible && (
        <Tooltip
          text={node.title}
          secondaryText={node.url}
          noteText={node.note ?? undefined}
          anchor={rowTooltip.anchor}
        />
      )}
    </div>
  );
}
