import { useEffect } from "react";
import type { TreeState } from "../../shared/tree/types";

/**
 * Scrolls the active tab’s row into view whenever the active tab changes,
 * so switching to a tab that’s currently scrolled out of view (or merely
 * close to the edge—see `.tab-node`’s `scroll-margin-block`) brings it
 * clearly on screen. A no-op if the row already has enough clearance.
 */
export function useScrollActiveIntoView(
  activeTabId: number | undefined,
  tree: TreeState,
): void {
  const isActiveNodeInTree =
    activeTabId !== undefined && tree.nodes[activeTabId] !== undefined;

  useEffect(() => {
    if (activeTabId === undefined || !isActiveNodeInTree) {
      return;
    }

    const element = document.querySelector(
      `[data-tab-id="${CSS.escape(String(activeTabId))}"]`,
    );
    // Read at the time of scrolling rather than once, so changing the OS
    // setting takes effect without reopening the side panel.
    const shouldReduceMotion = matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    element?.scrollIntoView({
      block: "nearest",
      behavior: shouldReduceMotion ? "instant" : "smooth",
    });
    // Re-run not just when the active tab id changes, but also when its row
    // actually appears in the tree: e.g. right after Ctrl+T, the browser
    // can fire onActivated for the new tab before the side panel’s tree
    // (synced separately via chrome.storage) has caught up and rendered
    // its row yet.
  }, [activeTabId, isActiveNodeInTree]);
}
