import { useState, type MouseEvent } from "react";

/**
 * Where the open context menu is anchored, and which tabs it acts on.
 */
export interface ContextMenuState {
  x: number;
  y: number;
  targetIds: number[];
}

/**
 * The context menu state and controls returned by `useContextMenu`.
 */
export interface ContextMenuControls {
  menu: ContextMenuState | null;
  openMenu: (
    nodeId: number,
    event: MouseEvent,
    selectedIds: Set<number>,
  ) => void;
  closeMenu: () => void;
}

/**
 * The right-clicked row's context menu. Its target is the current
 * multi-selection when the right-clicked row is part of it, or just the
 * right-clicked row otherwise—so right-clicking a tab that isn't part of
 * whatever's currently selected elsewhere still acts on that tab alone,
 * rather than on the unrelated leftover selection.
 */
export function useContextMenu(): ContextMenuControls {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const openMenu = (
    nodeId: number,
    event: MouseEvent,
    selectedIds: Set<number>,
  ): void => {
    event.preventDefault();
    const targetIds = selectedIds.has(nodeId) ? [...selectedIds] : [nodeId];
    setMenu({ x: event.clientX, y: event.clientY, targetIds });
  };

  const closeMenu = (): void => {
    setMenu(null);
  };

  return { menu, openMenu, closeMenu };
}
