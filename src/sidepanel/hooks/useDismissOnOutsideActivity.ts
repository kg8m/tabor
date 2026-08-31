import type { RefObject } from "react";
import { useEffect } from "react";

/**
 * Options for `useDismissOnOutsideActivity`.
 */
export interface DismissOnOutsideActivityOptions {
  // When true, a `scroll` event whose target is inside `reference` doesn't
  // trigger dismissal. `NoteEditor` needs this: once typed text overflows
  // its input's own width, Chrome scrolls the text to keep the caret
  // visible, which fires a `scroll` event of its own—not the panel scroll
  // this hook is meant to guard against.
  ignoreScrollWithin?: boolean;
}

/**
 * Closes a `position: fixed` popover—a context menu or a note editor—on an
 * outside click, an Escape keypress, or the panel scrolling underneath it.
 * Shared by `ContextMenu` and `NoteEditor`.
 *
 * Closing on outside click is done by checking the click's target against
 * `reference` rather than by stopping propagation on the popover's own
 * contents: that way a click on one of its own controls still reaches its
 * own `onClick` normally, and only this hook decides when to close.
 *
 * Scrolling closes the popover because it's rendered at a fixed viewport
 * position: whatever it's anchored to would move underneath it while it
 * stays put, so there'd be no way to tell what it still applies to.
 * `scroll` events don't bubble, but the capturing phase still reaches
 * `document` for a scroll on any descendant, which is what listening with
 * `capture: true` here relies on.
 */
export function useDismissOnOutsideActivity(
  reference: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: DismissOnOutsideActivityOptions = {},
): void {
  const { ignoreScrollWithin = false } = options;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (!reference.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const handleScroll = (event: Event): void => {
      if (
        ignoreScrollWithin &&
        reference.current?.contains(event.target as Node)
      ) {
        return;
      }
      onClose();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", handleScroll, { capture: true });
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", handleScroll, { capture: true });
    };
  }, [reference, onClose, ignoreScrollWithin]);
}
