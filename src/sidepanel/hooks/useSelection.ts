import { useState, type MouseEvent } from "react";
import { getVisibleOrder } from "../../shared/tree/queries";
import type { TreeState } from "../../shared/tree/types";

export interface Selection {
  selectedIds: Set<number>;
  handleNodeClick: (id: number, event: MouseEvent) => void;
}

/**
 * Tracks which nodes are selected via Ctrl/Cmd-click (toggle) and
 * Shift-click (range, resolved against the order nodes are actually shown
 * in—skipping the descendants of collapsed nodes). A plain click replaces
 * the selection with just the clicked node.
 *
 * Cmd (metaKey) is checked alongside Ctrl because on macOS, Chromium
 * browsers turn a Ctrl-click into a context-menu open rather than
 * delivering it as a click event, so Ctrl-click alone wouldn't work there.
 */
export function useSelection(tree: TreeState): Selection {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [anchorId, setAnchorId] = useState<number | null>(null);

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

    setSelectedIds(new Set([id]));
    setAnchorId(id);
  };

  return { selectedIds, handleNodeClick };
}
