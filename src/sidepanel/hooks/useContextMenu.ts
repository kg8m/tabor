import { useState, type MouseEvent } from "react";

export interface ContextMenuState {
  x: number;
  y: number;
  targetIds: number[];
}

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
