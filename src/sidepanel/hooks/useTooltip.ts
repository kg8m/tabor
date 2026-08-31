import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

// Short enough to feel responsive (much faster than the browser's own
// `title` delay) while still filtering out a pointer merely passing through.
const SHOW_DELAY_MS = 200;

/**
 * The screen position to anchor a tooltip at.
 */
export interface TooltipAnchor {
  x: number;
  y: number;
}

/**
 * The tooltip state and hover handlers returned by `useTooltip`.
 */
export interface TooltipControls {
  isVisible: boolean;
  anchor: TooltipAnchor;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

/**
 * Hover-triggered tooltip state for a single trigger element. Takes the
 * trigger's own ref (rather than creating one) so it can share it with
 * whatever else already measures that element—e.g. `useOverflowDetection`—
 * without needing a merged-ref helper.
 *
 * `anchor` is the trigger's own bounding rect (bottom-left corner), captured
 * only once the delay elapses—not tracked live—matching `NoteEditor`'s and
 * `ContextMenu`'s "position once, clamp on mount" approach rather than
 * following the trigger continuously.
 */
export function useTooltip(
  reference: RefObject<HTMLElement | null>,
): TooltipControls {
  const [isVisible, setIsVisible] = useState(false);
  const [anchor, setAnchor] = useState<TooltipAnchor>({ x: 0, y: 0 });
  const timeoutReference = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const onMouseEnter = (): void => {
    timeoutReference.current = setTimeout(() => {
      const element = reference.current;
      if (!element) {
        return;
      }

      const rect = element.getBoundingClientRect();
      setAnchor({ x: rect.left, y: rect.bottom });
      setIsVisible(true);
    }, SHOW_DELAY_MS);
  };

  const onMouseLeave = (): void => {
    clearTimeout(timeoutReference.current);
    setIsVisible(false);
  };

  // A scroll moves the trigger out from under a `position: fixed` tooltip
  // anchored to its old rect—same staleness `NoteEditor`/`ContextMenu` guard
  // against—so it's hidden rather than left pointing at the wrong row.
  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const handleScroll = (): void => {
      setIsVisible(false);
    };

    document.addEventListener("scroll", handleScroll, { capture: true });
    return () => {
      document.removeEventListener("scroll", handleScroll, { capture: true });
    };
  }, [isVisible]);

  useEffect(() => {
    return () => clearTimeout(timeoutReference.current);
  }, []);

  return { isVisible, anchor, onMouseEnter, onMouseLeave };
}
