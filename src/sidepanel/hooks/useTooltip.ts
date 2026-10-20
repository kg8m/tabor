import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

// Short enough to feel responsive (much faster than the browser’s own
// `title` delay) while still filtering out a pointer merely passing through.
const SHOW_DELAY_MS = 200;

// Space between the trigger and the tooltip, so the tooltip reads as
// belonging to the trigger rather than as a continuation of it.
const TRIGGER_GAP = 4;

/**
 * The screen position to anchor a tooltip at.
 */
export interface TooltipAnchor {
  x: number;
  y: number;
  // The trigger’s top edge, to flip the tooltip above it when there’s no
  // room below (see `useViewportClampedPosition`’s `Anchor`).
  flipY: number;
  placement: TooltipPlacement;
}

/**
 * Which side of the trigger a tooltip opens on when there’s room for it
 * there (see `useViewportClampedPosition`’s `Anchor`).
 */
export type TooltipPlacement = "below" | "above";

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
 * trigger’s own ref (rather than creating one) so it can share it with
 * whatever else already measures that element—e.g. `useOverflowDetection`—
 * without needing a merged-ref helper.
 *
 * `placement` picks which side the tooltip prefers. Tab rows pass `"above"`:
 * a row’s ancestors and descendants matter equally, but with the rows above
 * covered, the hovered row’s own indentation still shows it has ancestors,
 * while with the rows below covered, only its small collapse toggle (or
 * dot) hints at descendants—too subtle to notice out of the corner of an
 * eye.
 *
 * `anchor` is the trigger’s own bounding rect (bottom-left corner, plus its
 * top edge for opening above it), each pushed `TRIGGER_GAP` away, captured
 * only once the delay elapses—not tracked live—matching `NoteEditor`’s and
 * `ContextMenu`’s “position once, clamp on mount” approach rather than
 * following the trigger continuously.
 */
export function useTooltip(
  reference: RefObject<HTMLElement | null>,
  placement: TooltipPlacement = "below",
): TooltipControls {
  const [isVisible, setIsVisible] = useState(false);
  const [anchor, setAnchor] = useState<TooltipAnchor>({
    x: 0,
    y: 0,
    flipY: 0,
    placement,
  });
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
      setAnchor({
        x: rect.left,
        y: rect.bottom + TRIGGER_GAP,
        flipY: rect.top - TRIGGER_GAP,
        placement,
      });
      setIsVisible(true);
    }, SHOW_DELAY_MS);
  };

  const onMouseLeave = (): void => {
    clearTimeout(timeoutReference.current);
    setIsVisible(false);
  };

  // A scroll moves the trigger out from under a `position: fixed` tooltip
  // anchored to its old rect—same staleness `NoteEditor`/`ContextMenu` guard
  // against—so it’s hidden rather than left pointing at the wrong row.
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

  // In Chrome (unlike Vivaldi), the trigger’s `mouseleave` doesn’t reliably
  // fire when the pointer leaves the side panel altogether—into the page’s
  // content area or another application—so the tooltip would stay on screen
  // until the trigger is hovered again. Hence also hide it when the pointer leaves the document,
  // when the window loses focus, and, as a last resort for a leave that
  // never arrived at all, when the pointer is next seen over anything other
  // than the trigger.
  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const hide = (): void => {
      setIsVisible(false);
    };

    const handleMouseOut = (event: MouseEvent): void => {
      if (event.relatedTarget === null) {
        hide();
      }
    };

    const handleMouseOver = (event: MouseEvent): void => {
      if (
        !(event.target instanceof Node) ||
        !reference.current?.contains(event.target)
      ) {
        hide();
      }
    };

    document.addEventListener("mouseout", handleMouseOut);
    document.addEventListener("mouseover", handleMouseOver);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("mouseout", handleMouseOut);
      document.removeEventListener("mouseover", handleMouseOver);
      window.removeEventListener("blur", hide);
    };
  }, [isVisible, reference]);

  useEffect(() => {
    return () => clearTimeout(timeoutReference.current);
  }, []);

  return { isVisible, anchor, onMouseEnter, onMouseLeave };
}
