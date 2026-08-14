import { useState, type DragEvent } from "react";
import type { TaborMessage } from "../../shared/messages";
import { resolveDropPosition, type DropPosition } from "../../shared/tree/drop";

const DRAG_DATA_TYPE = "application/x-tabor-tab-id";

export interface DropIndicator {
  targetId: number;
  position: DropPosition;
}

export interface DragAndDrop {
  dropIndicator: DropIndicator | null;
  onDragStart: (id: number, event: DragEvent) => void;
  onDragOver: (id: number, event: DragEvent) => void;
  onDragLeave: (id: number) => void;
  onDrop: (id: number, event: DragEvent) => void;
  onDragEnd: () => void;
}

/**
 * Drag one tab row onto another to reorder it as a sibling (dropped near the
 * target's top/bottom edge) or make it the target's child (dropped near the
 * middle). Dragging a node that's part of the current multi-selection moves
 * the whole selection together; dragging an unselected node moves just that
 * one, regardless of what else happens to be selected.
 *
 * The dragged tab's id is tracked in state rather than read back from
 * `DataTransfer` during `dragover`, since browsers don't expose the dragged
 * data until the actual `drop`.
 */
export function useDragAndDrop(selectedIds: Set<number>): DragAndDrop {
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(
    null,
  );

  const onDragStart = (id: number, event: DragEvent): void => {
    setDraggedId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_DATA_TYPE, String(id));
  };

  const onDragOver = (id: number, event: DragEvent): void => {
    if (draggedId === null || draggedId === id) {
      return;
    }

    // Allow dropping here, and only here—browsers otherwise reject the drop.
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    const rect = event.currentTarget.getBoundingClientRect();
    const position = resolveDropPosition(event.clientY - rect.top, rect.height);
    setDropIndicator({ targetId: id, position });
  };

  const onDragLeave = (id: number): void => {
    setDropIndicator((current) => (current?.targetId === id ? null : current));
  };

  const onDrop = (id: number, event: DragEvent): void => {
    event.preventDefault();

    if (draggedId !== null && dropIndicator?.targetId === id) {
      const tabIds =
        selectedIds.has(draggedId) && selectedIds.size > 1
          ? [...selectedIds]
          : [draggedId];

      const message: TaborMessage = {
        type: "moveNode",
        tabIds,
        target: { targetId: id, position: dropIndicator.position },
      };
      void chrome.runtime.sendMessage(message);
    }

    setDraggedId(null);
    setDropIndicator(null);
  };

  const onDragEnd = (): void => {
    setDraggedId(null);
    setDropIndicator(null);
  };

  return {
    dropIndicator,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd,
  };
}
