import type { MouseEvent } from "react";
import type { TabNode } from "../../shared/tree/types";
import { useOverflowDetection } from "../hooks/useOverflowDetection";
import {
  AudibleIcon,
  ChevronIcon,
  DefaultFaviconIcon,
  LeafIcon,
  PinIcon,
} from "./icons";

interface TabNodeContentProps {
  node: TabNode;
  hasChildren: boolean;
  onToggleCollapsed: (event: MouseEvent) => void;
}

/**
 * The parts of a `.tab-node` row that don't depend on interacting with it
 * beyond the collapse toggle: the toggle (or pin/leaf marker), favicon,
 * title, audible indicator, and note text. Laid out as direct flex children
 * of whichever `.tab-node` element renders it (see `TabNodeView`).
 */
export function TabNodeContent({
  node,
  hasChildren,
  onToggleCollapsed,
}: TabNodeContentProps) {
  const { ref: titleReference, isOverflowing: isTitleOverflowing } =
    useOverflowDetection<HTMLSpanElement>(node.title);
  const { ref: noteReference, isOverflowing: isNoteOverflowing } =
    useOverflowDetection<HTMLSpanElement>(node.note ?? "");

  return (
    <>
      {hasChildren ? (
        <button
          type="button"
          className="tab-node__toggle"
          aria-label={node.collapsed ? "Expand" : "Collapse"}
          draggable={false}
          onClick={onToggleCollapsed}
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
    </>
  );
}
