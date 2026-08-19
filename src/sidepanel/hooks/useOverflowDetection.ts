import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

/**
 * Whether a `white-space: nowrap; overflow: hidden` element's content is
 * actually wider than the box it's rendered in—so a fade-out mask (or any
 * other truncation affordance) can be shown only when there's really
 * something to hide, rather than clipping into content that fits.
 * `content` isn't read inside the effect; it's there purely to force a
 * recheck when the text changes without the element's own box size
 * changing (e.g. a note-less title staying flex-grown to the same width
 * while its text gets shorter or longer).
 */
export function useOverflowDetection<T extends HTMLElement>(
  content: string,
): { ref: RefObject<T | null>; isOverflowing: boolean } {
  const reference = useRef<T>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const element = reference.current;
    if (!element) {
      return;
    }

    const checkOverflow = (): void => {
      setIsOverflowing(element.scrollWidth > element.clientWidth);
    };

    checkOverflow();

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [content]);

  return { ref: reference, isOverflowing };
}
