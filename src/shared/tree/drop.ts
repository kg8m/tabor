/**
 * Where a drag-and-drop drop lands relative to the target row—see
 * `resolveDropPosition`.
 */
export type DropPosition = "before" | "after" | "child";

/**
 * Resolve where a drag-and-drop drop should land within a target row, given
 * how far down the pointer is (`offsetY`) within the row's height.
 *
 * The top and bottom quarters of the row mean "reorder as a sibling before/
 * after this node"; the middle half means "make this node a child of the
 * target".
 */
export function resolveDropPosition(
  offsetY: number,
  height: number,
): DropPosition {
  if (height <= 0) {
    return "child";
  }

  const ratio = offsetY / height;
  if (ratio < 0.25) {
    return "before";
  }
  if (ratio > 0.75) {
    return "after";
  }
  return "child";
}
