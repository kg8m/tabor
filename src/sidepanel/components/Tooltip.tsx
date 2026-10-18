import { useRef } from "react";
import { createPortal } from "react-dom";
import type { TooltipAnchor } from "../hooks/useTooltip";
import { useViewportClampedPosition } from "../hooks/useViewportClampedPosition";
import { NoteIcon } from "./icons";

// A URL can run far longer than anything meant to be read in full (tracking
// params, encoded query strings); truncate rather than let the tooltip grow
// to match it.
const MAX_SECONDARY_TEXT_LENGTH = 100;

function truncate(text: string): string {
  return text.length > MAX_SECONDARY_TEXT_LENGTH
    ? `${text.slice(0, MAX_SECONDARY_TEXT_LENGTH)}…`
    : text;
}

interface TooltipProps {
  text: string;
  // Rendered on its own line below `text`, e.g. a tab’s URL below its title.
  secondaryText?: string;
  // Rendered below `secondaryText`, e.g. a tab’s note. Shown in full
  // (line breaks preserved) rather than truncated—unlike `secondaryText`,
  // this is content the user wrote themselves, not an incidental URL.
  noteText?: string;
  anchor: TooltipAnchor;
}

/**
 * A hover tooltip, portaled to `document.body` and positioned `fixed` off of
 * `anchor` (the trigger element’s own rect, below or above it per
 * `anchor.placement`)—same reasoning as
 * `NoteEditor`’s own portal (a row can carry `opacity`, e.g.
 * `.tab-node--suspended`, which would wash out an in-place popover
 * regardless of its own `position`).
 */
export function Tooltip({
  text,
  secondaryText,
  noteText,
  anchor,
}: TooltipProps) {
  const elementReference = useRef<HTMLDivElement>(null);
  const position = useViewportClampedPosition(elementReference, anchor);

  return createPortal(
    <div
      ref={elementReference}
      className="tooltip"
      role="tooltip"
      style={position}
    >
      <div className="tooltip__text">{text}</div>
      {secondaryText !== undefined && (
        <div className="tooltip__secondary">{truncate(secondaryText)}</div>
      )}
      {noteText !== undefined && (
        <div className="tooltip__note">
          <NoteIcon />
          <span>{noteText}</span>
        </div>
      )}
    </div>,
    document.body,
  );
}
