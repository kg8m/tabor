import type { MouseEvent } from "react";
import { getCachedFaviconUrl } from "../../shared/tabs";
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
  // Omitted for a read-only row (see `ReadOnlyTabNodeRow`), whose chevron
  // then only shows `node.collapsed` rather than toggling it.
  onToggleCollapsed?: (event: MouseEvent) => void;
  // How many tabs a collapsed row hides beneath it, shown as a badge over
  // its chevron. Omitted when there’s nothing hidden to count (an expanded
  // row, or a read-only one, which is always shown expanded).
  hiddenDescendantCount?: number;
}

// Caps the badge’s width, so it doesn’t spill any further over the favicon
// next to it.
const MAX_SHOWN_HIDDEN_DESCENDANT_COUNT = 99;

/**
 * The parts of a `.tab-node` row shared by the live tree’s `TabNodeRow` and
 * a saved tree preview’s `ReadOnlyTabNodeRow`: the collapse toggle (or
 * pin/leaf marker), favicon, title, audible indicator, and note text. Laid
 * out as direct flex children of whichever `.tab-node` element renders it.
 */
export function TabNodeContent({
  node,
  hasChildren,
  onToggleCollapsed,
  hiddenDescendantCount,
}: TabNodeContentProps) {
  const { ref: titleReference, isOverflowing: isTitleOverflowing } =
    useOverflowDetection<HTMLSpanElement>(node.title);
  const { ref: noteReference, isOverflowing: isNoteOverflowing } =
    useOverflowDetection<HTMLSpanElement>(node.note ?? "");

  return (
    <>
      {hasChildren ? (
        onToggleCollapsed ? (
          <button
            type="button"
            className="tab-node__toggle"
            aria-label={
              node.collapsed
                ? hiddenDescendantCount === undefined
                  ? "Expand"
                  : `Expand (${hiddenDescendantCount} hidden tabs)`
                : "Collapse"
            }
            draggable={false}
            onClick={onToggleCollapsed}
          >
            <ChevronIcon collapsed={node.collapsed} />
            {hiddenDescendantCount !== undefined && (
              <span className="tab-node__hidden-count" aria-hidden="true">
                {hiddenDescendantCount > MAX_SHOWN_HIDDEN_DESCENDANT_COUNT
                  ? `${MAX_SHOWN_HIDDEN_DESCENDANT_COUNT}+`
                  : hiddenDescendantCount}
              </span>
            )}
          </button>
        ) : (
          <span
            className="tab-node__toggle tab-node__chevron"
            role="img"
            aria-label={node.collapsed ? "Collapsed" : "Expanded"}
          >
            <ChevronIcon collapsed={node.collapsed} />
          </span>
        )
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
      ) : node.url ? (
        // No usable `favIconUrl` (e.g. a `chrome://` or `file://` page): fall
        // back to the browser’s own cached favicon for the page.
        <img
          className="tab-node__favicon"
          src={getCachedFaviconUrl(node.url, 16)}
          alt=""
        />
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
