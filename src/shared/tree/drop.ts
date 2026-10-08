/**
 * Where a drag-and-drop drop lands relative to the target row—see
 * `resolveDropPosition`.
 */
export type DropPosition = "before" | "after" | "child";

/**
 * Resolve where a drag-and-drop drop should land within a target row, given
 * how far down the pointer is (`offsetY`) within the row’s height.
 *
 * The top and bottom quarters of the row mean “reorder as a sibling before/
 * after this node”; the middle half means “make this node a child of the
 * target”—unless `canBeChild` is `false` (e.g. dragging a pinned tab, which
 * per spec can never have children), in which case the middle half instead
 * falls back to whichever of before/after the pointer is closer to.
 */
export function resolveDropPosition(
  offsetY: number,
  height: number,
  canBeChild = true,
): DropPosition {
  if (height <= 0) {
    return canBeChild ? "child" : "before";
  }

  const ratio = offsetY / height;
  if (ratio < 0.25) {
    return "before";
  }
  if (ratio > 0.75) {
    return "after";
  }
  if (!canBeChild) {
    return ratio < 0.5 ? "before" : "after";
  }
  return "child";
}
