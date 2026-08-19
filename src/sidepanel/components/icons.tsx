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

export function PinIcon() {
  return (
    <IconBase width="12" height="12" fill="currentColor">
      <path d="M8 1C5.24 1 3 3.24 3 6c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5zm0 6.75A1.75 1.75 0 1 1 8 4.25a1.75 1.75 0 0 1 0 3.5z" />
    </IconBase>
  );
}

export function PauseIcon() {
  return (
    <IconBase width="12" height="12" fill="currentColor">
      <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
    </IconBase>
  );
}

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
      <path d="M3 2h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
      <path d="M5 6.5h6M5 9.5h4" />
    </IconBase>
  );
}

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
