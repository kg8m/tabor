import { useState } from "react";

export interface NoteEditorAnchor {
  x: number;
  y: number;
}

export interface NoteEditorState {
  tabId: number;
  anchor: NoteEditorAnchor;
}

export interface NoteEditorControls {
  editor: NoteEditorState | null;
  openEditor: (tabId: number, anchor: NoteEditorAnchor) => void;
  closeEditor: () => void;
}

/**
 * Which tab's note-editing popover is currently open, if any, and where to
 * anchor it. Mirrors `useContextMenu`'s shape so it can be triggered both
 * from a tab row's own note button and from the context menu's "Add
 * note"/"Edit note" item; the anchor point (rather than a fixed spot within
 * the row) is why this carries `x`/`y` at all—see `NoteEditor`, which
 * renders `position: fixed` off of them the same way `ContextMenu` does off
 * of its own click point.
 */
export function useNoteEditor(): NoteEditorControls {
  const [editor, setEditor] = useState<NoteEditorState | null>(null);

  const openEditor = (tabId: number, anchor: NoteEditorAnchor): void => {
    setEditor({ tabId, anchor });
  };

  const closeEditor = (): void => {
    setEditor(null);
  };

  return { editor, openEditor, closeEditor };
}
