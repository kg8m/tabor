import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SubmitEvent,
} from "react";
import type { TaborMessage } from "../../shared/messages";
import type { NoteEditorAnchor } from "../hooks/useNoteEditor";

// Keeps the popover from touching the panel's edge once clamped into view.
const VIEWPORT_MARGIN = 4;

interface NoteEditorProps {
  tabId: number;
  anchor: NoteEditorAnchor;
  initialNote: string | null;
  onClose: () => void;
}

/**
 * A single-line popover for adding/editing a tab's note. `position: fixed`
 * off of `anchor` (its triggering button's own position), same as
 * `ContextMenu` off of its click point—rather than `position: absolute`
 * nested inside the tab row—so it isn't at the mercy of that row's own
 * stacking context, which sits at the same level as every other row and so
 * couldn't reliably render above the very next one down.
 *
 * Saving (or clearing the field) sends `updateNote` and closes; an outside
 * click discards whatever's typed instead of saving it.
 */
export function NoteEditor({
  tabId,
  anchor,
  initialNote,
  onClose,
}: NoteEditorProps) {
  const [value, setValue] = useState(initialNote ?? "");
  const formReference = useRef<HTMLFormElement>(null);
  const [position, setPosition] = useState({ top: anchor.y, left: anchor.x });

  // Clamps the anchor point so the popover never renders past the panel's
  // own edge, the same way `ContextMenu` does—see there for why this needs
  // the popover's own rendered size and so runs after mount.
  useLayoutEffect(() => {
    const element = formReference.current;
    if (!element) {
      return;
    }

    const { width, height } = element.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
    setPosition({
      left: Math.max(VIEWPORT_MARGIN, Math.min(anchor.x, maxLeft)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(anchor.y, maxTop)),
    });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (!formReference.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    // Scrolling would leave the popover—rendered at a fixed viewport
    // position—behind while the row it targets moves underneath it, so
    // there'd be no way to tell which tab it still applies to (same
    // reasoning as `ContextMenu`'s own scroll handler). `scroll` events
    // don't bubble, but the capturing phase still reaches `document` for a
    // scroll on any descendant, which is what listening with
    // `capture: true` here relies on.
    const handleScroll = (): void => {
      onClose();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", handleScroll, { capture: true });
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", handleScroll, { capture: true });
    };
  }, [onClose]);

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
