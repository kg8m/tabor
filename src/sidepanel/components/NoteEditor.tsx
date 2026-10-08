import { useRef, useState, type SubmitEvent } from "react";
import type { TaborMessage } from "../../shared/messages";
import { useDismissOnOutsideActivity } from "../hooks/useDismissOnOutsideActivity";
import type { NoteEditorAnchor } from "../hooks/useNoteEditor";
import { useViewportClampedPosition } from "../hooks/useViewportClampedPosition";

interface NoteEditorProps {
  tabId: number;
  anchor: NoteEditorAnchor;
  initialNote: string | null;
  onClose: () => void;
}

/**
 * A single-line popover for adding/editing a tab’s note. `position: fixed`
 * off of `anchor` (its triggering button’s own position), same as
 * `ContextMenu` off of its click point—rather than `position: absolute`
 * nested inside the tab row—so it isn’t at the mercy of that row’s own
 * stacking context, which sits at the same level as every other row and so
 * couldn’t reliably render above the very next one down.
 *
 * Saving (or clearing the field) sends `updateNote` and closes; an outside
 * click discards whatever’s typed instead of saving it.
 */
export function NoteEditor({
  tabId,
  anchor,
  initialNote,
  onClose,
}: NoteEditorProps) {
  const [value, setValue] = useState(initialNote ?? "");
  const formReference = useRef<HTMLFormElement>(null);
  const position = useViewportClampedPosition(formReference, anchor);

  // Excludes the form’s own descendants from the scroll-closes-the-popover
  // behavior: once typed text overflows the input’s own width, the browser
  // scrolls its text to keep the caret visible, which fires a `scroll`
  // event of its own—not the panel scroll this is meant to guard against.
  useDismissOnOutsideActivity(formReference, onClose, {
    ignoreScrollWithin: true,
  });

  const handleSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const trimmed = value.trim();
    const message: TaborMessage = {
      type: "updateNote",
      tabId,
      note: trimmed === "" ? null : trimmed,
    };
    void chrome.runtime.sendMessage(message);
    onClose();
  };

  return (
    <form
      ref={formReference}
      className="note-editor"
      style={position}
      onClick={(event) => event.stopPropagation()}
      onSubmit={handleSubmit}
    >
      <input
        type="text"
        className="note-editor__input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Add a note…"
        autoFocus
      />
      <div className="note-editor__actions">
        <button type="button" className="note-editor__cancel" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="note-editor__save">
          Save
        </button>
      </div>
    </form>
  );
}
