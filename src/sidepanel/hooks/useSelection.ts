import { useState, type MouseEvent } from "react";
import { getVisibleOrder } from "../../shared/tree/queries";
import type { TreeState } from "../../shared/tree/types";

export interface Selection {
  selectedIds: Set<number>;
  handleNodeClick: (id: number, event: MouseEvent) => void;
  clearSelection: () => void;
}

/**
 * Tracks which nodes are selected via Ctrl/Cmd-click (toggle) and
 * Shift-click (range, resolved against the order nodes are actually shown
 * in—skipping the descendants of collapsed nodes).
 *
 * A plain click on the already-active tab replaces the selection with just
 * that node; a plain click on any other tab only switches to it (the
 * caller's job) and leaves the selection untouched, since its purpose there
 * is navigation, not selection. That switch then clears the selection anyway
 * once `activeTabId` catches up—see the render-time check below.
 *
 * Cmd (metaKey) is checked alongside Ctrl because on macOS, Chromium
 * browsers turn a Ctrl-click into a context-menu open rather than
 * delivering it as a click event, so Ctrl-click alone wouldn't work there.
 */
export function useSelection(
  tree: TreeState,
  activeTabId: number | undefined,
): Selection {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [anchorId, setAnchorId] = useState<number | null>(null);
  const [previousActiveTabId, setPreviousActiveTabId] = useState(activeTabId);

  // Whatever switched the active tab—this component's own click handling,
  // a native tab-strip click, a keyboard shortcut, or the active tab being
  // reassigned after a close—a stale selection left over from before the
  // switch reads as the active tab at a glance, so drop it. Adjusted during
  // render (React's recommended way to reset state on a prop change) rather
  // than in an effect, to avoid an extra commit.
  if (activeTabId !== previousActiveTabId) {
    setPreviousActiveTabId(activeTabId);
    setSelectedIds(new Set());
    setAnchorId(null);
  }

  const handleNodeClick = (id: number, event: MouseEvent): void => {
    if (anchorId !== null && event.shiftKey) {
      const visibleOrder = getVisibleOrder(tree).map((node) => node.id);
      const anchorIndex = visibleOrder.indexOf(anchorId);
      const clickedIndex = visibleOrder.indexOf(id);
      if (anchorIndex === -1 || clickedIndex === -1) {
        setSelectedIds(new Set([id]));
        setAnchorId(id);
        return;
      }

      const start = Math.min(anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex, clickedIndex);
      setSelectedIds(new Set(visibleOrder.slice(start, end + 1)));
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      setAnchorId(id);
      return;
    }

    if (id !== activeTabId) {
      return;
    }

    setSelectedIds(new Set([id]));
    setAnchorId(id);
  };

  const clearSelection = (): void => {
    setSelectedIds(new Set());
    setAnchorId(null);
  };

  return { selectedIds, handleNodeClick, clearSelection };
}
