import { useState, type DragEvent } from "react";
import type { TaborMessage } from "../../shared/messages";
import { resolveDropPosition, type DropPosition } from "../../shared/tree/drop";
import { isSelfOrDescendant } from "../../shared/tree/queries";
import type { TreeState } from "../../shared/tree/types";

const DRAG_DATA_TYPE = "application/x-tabor-tab-id";

/**
 * Where the currently dragged tab would land if dropped right now, or
 * `null` if nowhere valid.
 *
 * A "node" indicator marks a specific row's top/bottom/middle, per
 * `resolveDropPosition`. An "end" indicator instead represents the empty
 * space below the whole tree (see `onContainerDragOver`)—it isn't anchored
 * to any one row, since a drop there always makes the dragged tab a new
 * top-level tab regardless of which row happens to render last.
 */
export type DropIndicator =
  { kind: "node"; targetId: number; position: DropPosition } | { kind: "end" };

/**
 * The drag-and-drop state and handlers returned by `useDragAndDrop`.
 */
export interface DragAndDrop {
  dropIndicator: DropIndicator | null;
  onDragStart: (id: number, event: DragEvent) => void;
  onDragOver: (id: number, event: DragEvent) => void;
  onDragLeave: (id: number) => void;
  onDrop: (id: number, event: DragEvent) => void;
  onDragEnd: () => void;
  // For the empty space below the tree (e.g. when there are too few tabs to
  // fill the panel): dropping there always means "become a new last
  // top-level tab", regardless of where within that space the pointer
  // lands. `lastRootId` (the last top-level/unpinned-root tab) is both the
  // move target and what's compared against the dragged tab to no-op when
  // it's already there.
  onContainerDragOver: (lastRootId: number | null, event: DragEvent) => void;
  onContainerDrop: (lastRootId: number | null, event: DragEvent) => void;
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
export function useDragAndDrop(
  selectedIds: Set<number>,
  tree: TreeState,
): DragAndDrop {
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
    // Always stop this from bubbling into the container's own onDragOver
    // (see `onContainerDragOver`)—a hover over any row, valid drop target or
    // not (e.g. hovering the very row being dragged), should never be
    // reinterpreted as the "empty space below the tree" gesture.
    event.stopPropagation();

    // Also covers `draggedId === id`: dropping a node onto itself or one of
    // its own descendants would create a cycle, which `moveNode` already
    // refuses—reject it here too so the indicator never implies a drop that
    // wouldn't actually do anything.
    if (draggedId === null || isSelfOrDescendant(tree, draggedId, id)) {
      setDropIndicator(null);
      return;
    }

    // Allow dropping here, and only here—browsers otherwise reject the drop.
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    // A pinned tab can never have children, so its drop never resolves to
    // "child"—the middle half of the row falls back to before/after instead.
    const canBeChild = tree.nodes[draggedId]?.pinned !== true;
    const rect = event.currentTarget.getBoundingClientRect();
    const position = resolveDropPosition(
      event.clientY - rect.top,
      rect.height,
      canBeChild,
    );
    setDropIndicator({ kind: "node", targetId: id, position });
  };

  const onDragLeave = (id: number): void => {
    setDropIndicator((current) =>
      current?.kind === "node" && current.targetId === id ? null : current,
    );
  };

  const sendMoveMessage = (targetId: number, position: DropPosition): void => {
    if (draggedId === null) {
      return;
    }

    // Excludes a selected tab whose pinned state doesn't match the dragged
    // one's: `moveNode` refuses such a move anyway (see its own guard), so
    // dropping it here would just leave that tab behind rather than moving
    // it—no different from how a descendant of another selected node is
    // already left out of `moveNodes`.
    const tabIds =
      selectedIds.has(draggedId) && selectedIds.size > 1
        ? [...selectedIds].filter(
            (id) => tree.nodes[id]?.pinned === tree.nodes[draggedId]?.pinned,
          )
        : [draggedId];

    const message: TaborMessage = {
      type: "moveNode",
      tabIds,
      target: { targetId, position },
    };
    void chrome.runtime.sendMessage(message);
  };

  const onDrop = (id: number, event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();

    if (
      draggedId !== null &&
      dropIndicator?.kind === "node" &&
      dropIndicator.targetId === id
    ) {
      sendMoveMessage(id, dropIndicator.position);
    }

    setDraggedId(null);
    setDropIndicator(null);
  };

  const onDragEnd = (): void => {
    setDraggedId(null);
    setDropIndicator(null);
  };

  const onContainerDragOver = (
    lastRootId: number | null,
    event: DragEvent,
  ): void => {
    if (draggedId === null || lastRootId === null || draggedId === lastRootId) {
      setDropIndicator(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropIndicator({ kind: "end" });
  };

  const onContainerDrop = (
    lastRootId: number | null,
    event: DragEvent,
  ): void => {
    event.preventDefault();

    if (
      draggedId !== null &&
      lastRootId !== null &&
      dropIndicator?.kind === "end"
    ) {
      sendMoveMessage(lastRootId, "after");
    }

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
    onContainerDragOver,
    onContainerDrop,
  };
}
