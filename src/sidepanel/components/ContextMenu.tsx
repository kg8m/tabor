import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TaborMessage } from "../../shared/messages";
import type { NoteEditorAnchor } from "../hooks/useNoteEditor";
import {
  CloseIcon,
  MoveIntoWindowIcon,
  MoveToWindowIcon,
  NewWindowIcon,
  NoteIcon,
  PauseIcon,
  ReloadIcon,
} from "./icons";

/**
 * One entry in the "move to window" picker—see `describeWindow`. Kept as
 * separate `title`/`suffix` fields (rather than one combined string) so the
 * title alone can shrink and ellipsize while the "and N other tabs" count
 * stays fully visible—CSS ellipsis on a single combined string would
 * truncate from the end and cut the count off instead.
 */
interface WindowOption {
  id: number;
  title: string;
  suffix: string;
}

/**
 * Labels a window the way Chrome's own "Move tab to another window" menu
 * does: its active tab's title, plus how many other tabs it has.
 */
function describeWindow(
  win: chrome.windows.Window,
): Pick<WindowOption, "title" | "suffix"> {
  const activeTab = win.tabs?.find((tab) => tab.active);
  const title = activeTab?.title ?? "Untitled window";
  const otherTabCount = (win.tabs?.length ?? 1) - 1;
  if (otherTabCount <= 0) {
    return { title, suffix: "" };
  }

  return {
    title,
    suffix: ` and ${otherTabCount} other tab${otherTabCount === 1 ? "" : "s"}`,
  };
}

// Keeps the menu from touching the panel's edge once clamped into view.
const VIEWPORT_MARGIN = 4;

interface ContextMenuProps {
  x: number;
  y: number;
  windowId: number | undefined;
  targetIds: number[];
  /**
   * `targetIds` plus all of their descendants (deduplicated). Equal to
   * `targetIds` when none of the targets have children.
   */
  treeIds: number[];
  isEveryTargetPinned: boolean;
  activeTabId: number | undefined;
  // Only meaningful (non-`undefined`) when `targetIds.length === 1`, per
  // spec—the note item itself is hidden for a multi-tab selection.
  targetNote: string | null | undefined;
  onOpenNoteEditor: (anchor: NoteEditorAnchor) => void;
  onClose: () => void;
}

/**
 * A fixed-position menu anchored at the right-click point. Closing on an
 * outside click is done by checking the click's target against `menuReference`
 * rather than by stopping propagation on the menu's own items: that way a
 * click on e.g. "Suspend" still reaches its own `onClick` normally, and only
 * this component decides when to close (right after running the action).
 *
 * "Close" asks for confirmation as an in-menu step (swapping its buttons for
 * a Cancel/Close pair) rather than via `window.confirm`: Chrome silently
 * blocks `alert`/`confirm`/`prompt` from extension surfaces like this side
 * panel, so a real `confirm()` call here would always resolve to `false`
 * without ever actually prompting anyone.
 */
export function ContextMenu({
  x,
  y,
  windowId,
  targetIds,
  treeIds,
  isEveryTargetPinned,
  activeTabId,
  targetNote,
  onOpenNoteEditor,
  onClose,
}: ContextMenuProps) {
  // Discarding the active tab is a no-op—Chrome has to reload it right away
  // to keep displaying it—so it's excluded from a batch suspend the same way
  // the per-row suspend button hides for it. Unlike that button, the whole
  // action isn't hidden just because the active tab happens to be one of
  // several targets: the others are still worth suspending.
  const suspendableIds = targetIds.filter((id) => id !== activeTabId);
  const suspendableTreeIds = treeIds.filter((id) => id !== activeTabId);
  const hasDescendants = treeIds.length > targetIds.length;
  const menuReference = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: y, left: x });
  // `"targets"` confirms closing just the right-clicked tab(s); `"tree"`
  // confirms closing them together with all of their descendants. Tracked as
  // which id list to close (rather than two separate booleans) since only
  // one confirmation can be in progress at a time.
  const [closeConfirmation, setCloseConfirmation] = useState<
    "targets" | "tree" | null
  >(null);
  // The "move to window" picker, once its window list has been fetched;
  // `null` while the main menu (or the close confirmation) is showing.
  const [windowPicker, setWindowPicker] = useState<{
    scope: "targets" | "tree";
    windows: WindowOption[];
  } | null>(null);

  // Clamps the anchor point so the menu never renders past the panel's own
  // edge (it otherwise wouldn't be able to shrink to fit and would just get
  // clipped, right-clicks near the right/bottom edge). Needs the menu's own
  // rendered size, so this runs after mount rather than being computed from
  // the click position alone; useLayoutEffect (rather than useEffect) applies
  // the correction before the browser paints, so there's no visible jump.
  // Also reruns when the close confirmation or window picker swaps in (a
  // different size), since that can newly push the bottom/right edge out of
  // view.
  useLayoutEffect(() => {
    const element = menuReference.current;
    if (!element) {
      return;
    }

    const { width, height } = element.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
    setPosition({
      left: Math.max(VIEWPORT_MARGIN, Math.min(x, maxLeft)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(y, maxTop)),
    });
  }, [x, y, closeConfirmation, windowPicker]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (!menuReference.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    // Scrolling would leave the menu—rendered at a fixed viewport
    // position—behind while the row it targets moves underneath it, so
    // there'd be no way to tell which tab it still applies to. `scroll`
    // events don't bubble, but the capturing phase still reaches `document`
    // for a scroll on any descendant, which is what listening with
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

  const handleSuspend = (): void => {
    for (const id of suspendableIds) {
      void chrome.tabs.discard(id);
    }
    onClose();
  };

  const handleSuspendTree = (): void => {
    for (const id of suspendableTreeIds) {
      void chrome.tabs.discard(id);
    }
    onClose();
  };

  const handleReload = (): void => {
    for (const id of targetIds) {
      void chrome.tabs.reload(id);
    }
    onClose();
  };

  // Anchored at the menu's own (already viewport-clamped) position, same as
  // a row's own note button anchors off of its own position.
  const handleOpenNoteEditor = (): void => {
    onOpenNoteEditor({ x: position.left, y: position.top });
    onClose();
  };

  const handleOpenWindowPicker = (scope: "targets" | "tree"): void => {
    void (async () => {
      const allWindows = await chrome.windows.getAll({
        populate: true,
        windowTypes: ["normal"],
      });
      const windows = allWindows
        .filter(
          (candidate): candidate is chrome.windows.Window & { id: number } =>
            candidate.id !== undefined && candidate.id !== windowId,
        )
        .map((candidate) => ({
          id: candidate.id,
          ...describeWindow(candidate),
        }));
      setWindowPicker({ scope, windows });
    })();
  };

  const handleMoveToWindow = (targetWindowId: number | "new"): void => {
    if (windowPicker === null || windowId === undefined) {
      return;
    }

    const ids = windowPicker.scope === "tree" ? treeIds : targetIds;
    const [firstId, ...restIds] = ids;
    if (firstId === undefined) {
      return;
    }

    void (async () => {
      const message: TaborMessage = {
        type: "registerPendingTreeMove",
        windowId,
        tabIds: ids,
      };
      await chrome.runtime.sendMessage(message);

      // Moved one at a time, not as a single `chrome.tabs.move(ids, ...)`
      // batch—see the same call in `syncNativeOrder`
      // (`src/background/index.ts`) for why: given an array, Chrome doesn't
      // reliably land every id in the destination window, which silently
      // drops it from `noteTreeMoveAttached`'s batch and leaves the whole
      // move flattened once the safety timeout gives up on it.
      if (targetWindowId === "new") {
        const created = await chrome.windows.create({ tabId: firstId });
        if (created?.id !== undefined) {
          for (const id of restIds) {
            await chrome.tabs.move(id, { windowId: created.id, index: -1 });
          }
        }
      } else {
        for (const id of ids) {
          await chrome.tabs.move(id, { windowId: targetWindowId, index: -1 });
        }
      }
    })();
    onClose();
  };

  const handleConfirmClose = (): void => {
    const idsToClose = closeConfirmation === "tree" ? treeIds : targetIds;
    void (async () => {
      if (windowId !== undefined) {
        const message: TaborMessage = {
          type: "registerPendingClose",
          windowId,
          tabIds: idsToClose,
        };
        await chrome.runtime.sendMessage(message);
      }
      await chrome.tabs.remove(idsToClose);
    })();
    onClose();
  };

  return (
    <div
      ref={menuReference}
      className="context-menu"
      role="menu"
      style={position}
    >
      {windowPicker === null ? (
        closeConfirmation === null ? (
          <>
            <button
              type="button"
              role="menuitem"
              className="context-menu__item"
              onClick={handleReload}
            >
              <ReloadIcon />
              Reload
            </button>
            {suspendableIds.length > 0 && (
              <button
                type="button"
                role="menuitem"
                className="context-menu__item"
                onClick={handleSuspend}
              >
                <PauseIcon />
                Suspend
              </button>
            )}
            {hasDescendants && suspendableTreeIds.length > 0 && (
              <button
                type="button"
                role="menuitem"
                className="context-menu__item"
                onClick={handleSuspendTree}
              >
                <PauseIcon />
                Suspend tree
              </button>
            )}
            {!isEveryTargetPinned && (
              <button
                type="button"
                role="menuitem"
                className="context-menu__item"
                onClick={() => setCloseConfirmation("targets")}
              >
                <CloseIcon />
                Close
              </button>
            )}
            {hasDescendants && (
              <button
                type="button"
                role="menuitem"
                className="context-menu__item"
                onClick={() => setCloseConfirmation("tree")}
              >
                <CloseIcon />
                Close tree
              </button>
            )}
            {targetNote !== undefined && (
              <button
                type="button"
                role="menuitem"
                className="context-menu__item"
                onClick={handleOpenNoteEditor}
              >
                <NoteIcon />
                {targetNote === null ? "Add note" : "Edit note"}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="context-menu__item"
              onClick={() => handleOpenWindowPicker("targets")}
            >
              <MoveToWindowIcon />
              Move tab(s) to window
            </button>
            {hasDescendants && (
              <button
                type="button"
                role="menuitem"
                className="context-menu__item"
                onClick={() => handleOpenWindowPicker("tree")}
              >
                <MoveToWindowIcon />
                Move tree(s) to window
              </button>
            )}
          </>
        ) : (
          <div className="context-menu__confirm">
            <p className="context-menu__confirm-text">
              {closeConfirmation === "tree"
                ? `Close ${treeIds.length} tabs in this tree?`
                : targetIds.length > 1
                  ? `Close ${targetIds.length} tabs?`
                  : "Close this tab?"}
            </p>
            <div className="context-menu__confirm-actions">
              <button
                type="button"
                className="context-menu__item"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="context-menu__item"
                onClick={handleConfirmClose}
              >
                Close
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="context-menu__confirm context-menu__window-picker">
          <p className="context-menu__window-picker-header">Move to window</p>
          <div className="context-menu__window-list">
            <button
              type="button"
              role="menuitem"
              className="context-menu__item"
              onClick={() => handleMoveToWindow("new")}
            >
              <NewWindowIcon />
              New window
            </button>
            {windowPicker.windows.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitem"
                className="context-menu__item"
                onClick={() => handleMoveToWindow(option.id)}
              >
                <MoveIntoWindowIcon />
                <span className="context-menu__window-label">
                  <span className="context-menu__window-title">
                    {option.title}
                  </span>
                  {option.suffix !== "" && (
                    <span className="context-menu__window-suffix">
                      {option.suffix}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="context-menu__item context-menu__window-picker-cancel"
            onClick={() => setWindowPicker(null)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
