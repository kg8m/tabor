import type { SVGProps } from "react";

// Fixed-size SVGs instead of text/emoji glyphs (▼/▶, 📌, ⏸, ×): a glyph's
// rendered width depends on whatever font the system resolves for it, so
// layout math that depends on a button's width (see `.tab-node__title`'s
// hover padding in style.css) can't be pinned down reliably from CSS alone.

function IconBase(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    />
  );
}

/**
 * The expand/collapse toggle for a node with children; rotated per
 * `collapsed`.
 */
export function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <IconBase
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
    >
      <polyline points="3,6 8,11 13,6" />
    </IconBase>
  );
}

/**
 * Marks a pinned tab.
 */
export function PinIcon() {
  return (
    <IconBase width="12" height="12" fill="currentColor">
      <path d="M8 1C5.24 1 3 3.24 3 6c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5zm0 6.75A1.75 1.75 0 1 1 8 4.25a1.75 1.75 0 0 1 0 3.5z" />
    </IconBase>
  );
}

/**
 * Marks a suspended (discarded) tab.
 */
export function PauseIcon() {
  return (
    <IconBase width="12" height="12" fill="currentColor">
      <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
    </IconBase>
  );
}

/**
 * Opens the backup history panel.
 */
export function HistoryIcon() {
  return (
    <IconBase
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8.5" r="6" />
      <polyline points="8,5 8,8.5 10.5,10" />
      <polyline points="2.5,2 2.5,5 5.5,5" />
    </IconBase>
  );
}

/**
 * Shown in place of a tab's own favicon when it doesn't have one (e.g.
 * `chrome://` pages), rather than leaving that space blank: an empty tree
 * row otherwise reads as if there's nothing there at all.
 */
export function DefaultFaviconIcon() {
  return (
    <IconBase
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 2h6l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
      <path d="M10 2v3h3" />
    </IconBase>
  );
}

/**
 * Shown in the toggle slot for a tab that has neither children nor a pin, so
 * the slot never reads as merely empty—which, sitting directly under a
 * sibling's chevron/pin icon at the same x position, could otherwise look
 * like this row continues that icon (i.e. is its child) rather than being an
 * unrelated leaf at the same level.
 */
export function LeafIcon() {
  return (
    <IconBase width="6" height="6" fill="currentColor">
      <circle cx="8" cy="8" r="3" />
    </IconBase>
  );
}

/**
 * Marks a tab currently playing audio.
 */
export function AudibleIcon() {
  return (
    <IconBase
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" stroke="none" />
      <path d="M10.5 5.5a4 4 0 0 1 0 5" />
      <path d="M12.3 3.7a6.5 6.5 0 0 1 0 8.6" />
    </IconBase>
  );
}

/**
 * Opens or indicates a tab's note.
 */
export function NoteIcon() {
  return (
    <IconBase
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 1.5h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z" />
      <path d="M5 6h6M5 9h4" />
    </IconBase>
  );
}

/**
 * Reloads a tab.
 */
export function ReloadIcon() {
  return (
    <IconBase
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 8A5 5 0 1 1 11.5 4.5" />
      <polyline points="13,2 13,5.5 9.5,5.5" />
    </IconBase>
  );
}

/**
 * Moves a tab to another window—an open-cornered box with an arrow escaping
 * it, rather than a separate window glyph plus arrow: overlapping shapes
 * that small (12x12) read as clutter rather than two distinct parts.
 */
export function MoveToWindowIcon() {
  return (
    <IconBase
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.5 8v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1H8" />
      <path d="M9.5 1.5h5v5" />
      <path d="M14.3 1.7 7.5 8.5" />
    </IconBase>
  );
}

/**
 * Opens a brand new window—the same open-cornered box as `MoveToWindowIcon`,
 * cut a bit further open than that one so the plus sign has clear room
 * around it, with a plus sign centered in that space.
 */
export function NewWindowIcon() {
  return (
    <IconBase
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.5 9.5v4a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1H6.5" />
      <path d="M12 1.5v5" />
      <path d="M9.5 4h5" />
    </IconBase>
  );
}

/**
 * Moves a tab into an existing window—the same box as `NewWindowIcon` (cut
 * open further than `MoveToWindowIcon`'s, for clearance), with an arrowhead
 * in the corner instead of a plus. The two wings meet the shaft at the same
 * tip (not offset from it) and stay within the shaft's own 90°-ish approach
 * angle—otherwise the three lines fan out close to evenly and read as a "Y"
 * rather than an arrowhead.
 */
export function MoveIntoWindowIcon() {
  return (
    <IconBase
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.5 9.5v4a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1H6.5" />
      <path d="M14.5 1 9 6.5" />
      <path d="M9 1.5v5h5" />
    </IconBase>
  );
}

/**
 * Closes a tab.
 */
export function CloseIcon() {
  return (
    <IconBase
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </IconBase>
  );
}
