import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TooltipAnchor } from "../hooks/useTooltip";

// Keeps the tooltip from touching the panel's edge once clamped into view.
const VIEWPORT_MARGIN = 4;

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
  // Rendered on its own line below `text`, e.g. a tab's URL below its title.
  secondaryText?: string;
  anchor: TooltipAnchor;
}

/**
 * A hover tooltip, portaled to `document.body` and positioned `fixed` off of
 * `anchor` (the trigger element's own bottom-left corner)—same reasoning as
 * `NoteEditor`'s own portal (a row can carry `opacity`, e.g.
 * `.tab-node--suspended`, which would wash out an in-place popover
 * regardless of its own `position`) and the same viewport-clamping approach
 * (needs the tooltip's own rendered size, so it runs after mount).
 */
export function Tooltip({ text, secondaryText, anchor }: TooltipProps) {
  const elementReference = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: anchor.y, left: anchor.x });

  useLayoutEffect(() => {
    const element = elementReference.current;
    if (!element) {
      return;
    }

    const { width, height } = element.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
    setPosition({
      left: Math.max(VIEWPORT_MARGIN, Math.min(anchor.x, maxLeft)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(anchor.y, maxTop)),
    });
  }, [anchor.x, anchor.y]);

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
    </div>,
    document.body,
  );
}
