import type { RefObject } from "react";
import { useLayoutEffect, useState } from "react";

// Keeps the clamped element from touching the panel’s edge once positioned.
const VIEWPORT_MARGIN = 4;

/**
 * A screen position to anchor a `position: fixed` element at.
 */
export interface Anchor {
  x: number;
  y: number;
  // Where the element’s bottom edge goes instead when it doesn’t fit below
  // `y`—e.g. a tooltip trigger’s own top edge, so the tooltip flips above
  // the trigger rather than being clamped up over it (and the pointer on it).
  flipY?: number;
}

/**
 * The clamped position returned by `useViewportClampedPosition`.
 */
export interface ClampedPosition {
  top: number;
  left: number;
}

/**
 * Clamps `anchor` so a `position: fixed` element anchored there—a tooltip, a
 * context menu, or a popover—never renders past the viewport’s edge. Shared
 * by `Tooltip`, `ContextMenu`, and `NoteEditor`.
 *
 * Needs the element’s own rendered size, so this runs after mount rather
 * than being computed from the anchor point alone; `useLayoutEffect`
 * (rather than `useEffect`) applies the correction before the browser
 * paints, so there’s no visible jump.
 *
 * `extraDependencies` lets a caller re-run the clamp when something other
 * than the anchor itself can change the element’s rendered size—e.g.
 * `ContextMenu` swapping its close confirmation or window picker in over the
 * main menu.
 */
export function useViewportClampedPosition(
  reference: RefObject<HTMLElement | null>,
  anchor: Anchor,
  extraDependencies: readonly unknown[] = [],
): ClampedPosition {
  const [position, setPosition] = useState<ClampedPosition>({
    top: anchor.y,
    left: anchor.x,
  });

  useLayoutEffect(() => {
    const element = reference.current;
    if (!element) {
      return;
    }

    const { width, height } = element.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
    const top =
      anchor.flipY !== undefined && anchor.y > maxTop
        ? anchor.flipY - height
        : anchor.y;
    // Reading layout back from the DOM and feeding it into state is exactly
    // what `useLayoutEffect` is for (unlike deriving state from props/other
    // state, which is what `react-hooks/set-state-in-effect` otherwise
    // guards against)—there’s no prop this position could be computed from
    // directly, since it depends on the element’s own rendered size.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPosition({
      left: Math.max(VIEWPORT_MARGIN, Math.min(anchor.x, maxLeft)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop)),
    });
    // `extraDependencies` is caller-provided and can’t be statically checked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference, anchor.x, anchor.y, anchor.flipY, ...extraDependencies]);

  return position;
}
