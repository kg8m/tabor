import { useRef, useState } from "react";
import type { TaborMessage } from "../../shared/messages";
import { closeTabs } from "../close-tabs";
import { useDismissOnOutsideActivity } from "../hooks/useDismissOnOutsideActivity";
import type { NoteEditorAnchor } from "../hooks/useNoteEditor";
import { useViewportClampedPosition } from "../hooks/useViewportClampedPosition";
import {
  CloseIcon,
  MoveIntoWindowIcon,
  MoveToWindowIcon,
  NewWindowIcon,
  NoteIcon,
  PauseIcon,
  PinIcon,
  ReloadIcon,
} from "./icons";

/**
 * One entry in the “move to window” picker—see `describeWindow`. Kept as
 * separate `title`/`suffix` fields (rather than one combined string) so the
 * title alone can shrink and ellipsize while the “and N other tabs” count
 * stays fully visible—CSS ellipsis on a single combined string would
 * truncate from the end and cut the count off instead.
 */
interface WindowOption {
  id: number;
  title: string;
  suffix: string;
}

/**
 * Labels a window the way Chrome’s own “Move tab to another window” menu
 * does: its active tab’s title, plus how many other tabs it has.
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
  /**
   * Every tab id in the current window (pinned and unpinned), used to derive
   * “Suspend other tab(s)”’s target set.
   */
  allTabIds: number[];
  /**
   * Every unpinned tab id in the current window, used to derive “Suspend
   * other unpinned tab(s)”’s target set.
   */
  unpinnedTabIds: number[];
  isEveryTargetPinned: boolean;
  // Whether at least one of `targetIds` is pinned—used to decide whether
  // “Unpin” is shown at all, independent of `isEveryTargetPinned` (which
  // instead gates “Pin” and “Close”). A selection mixing pinned and
  // unpinned tabs shows both items.
  isAnyTargetPinned: boolean;
  activeTabId: number | undefined;
  // Only meaningful (non-`undefined`) when `targetIds.length === 1`, per
  // spec—the note item itself is hidden for a multi-tab selection.
  targetNote: string | null | undefined;
  onOpenNoteEditor: (anchor: NoteEditorAnchor) => void;
  onClose: () => void;
}

/**
 * A fixed-position menu anchored at the right-click point. Closing on an
 * outside click is done by checking the click’s target against `menuReference`
 * rather than by stopping propagation on the menu’s own items: that way a
 * click on e.g. “Suspend” still reaches its own `onClick` normally, and only
 * this component decides when to close (right after running the action).
 *
 * “Close” and the “Suspend other …” items ask for confirmation as an
 * in-menu step (swapping the main menu for a Cancel/confirm pair) rather
 * than via `window.confirm`: Chrome silently blocks `alert`/`confirm`/
 * `prompt` from extension surfaces like this side panel, so a real
 * `confirm()` call here would always resolve to `false` without ever
 * actually prompting anyone.
 */
export function ContextMenu({
  x,
  y,
  windowId,
  targetIds,
  treeIds,
  allTabIds,
  unpinnedTabIds,
  isEveryTargetPinned,
  isAnyTargetPinned,
  activeTabId,
  targetNote,
  onOpenNoteEditor,
  onClose,
}: ContextMenuProps) {
  // Discarding the active tab is a no-op—Chrome has to reload it right away
  // to keep displaying it—so it’s excluded from a batch suspend the same way
  // the per-row suspend button hides for it. Unlike that button, the whole
  // action isn’t hidden just because the active tab happens to be one of
  // several targets: the others are still worth suspending.
  const suspendableIds = targetIds.filter((id) => id !== activeTabId);
  const suspendableTreeIds = treeIds.filter((id) => id !== activeTabId);
  // Every tab in the window except the right-clicked/selected target(s) and
  // the active tab—unlike `suspendableTreeIds`, this deliberately reaches
  // beyond the targets’ own subtree to every other tab in the window.
  const otherSuspendableIds = allTabIds.filter(
    (id) => !targetIds.includes(id) && id !== activeTabId,
  );
  // Same as `otherSuspendableIds`, but scoped to unpinned tabs only, for
  // “Suspend other unpinned tab(s)”.
  const otherSuspendableUnpinnedIds = unpinnedTabIds.filter(
    (id) => !targetIds.includes(id) && id !== activeTabId,
  );
  const hasDescendants = treeIds.length > targetIds.length;
  const menuReference = useRef<HTMLDivElement>(null);
  // `"targets"` confirms closing just the right-clicked tab(s); `"tree"`
  // confirms closing them together with all of their descendants. Tracked as
  // which id list to close (rather than two separate booleans) since only
  // one confirmation can be in progress at a time.
  const [closeConfirmation, setCloseConfirmation] = useState<
    "targets" | "tree" | null
  >(null);
  // `"all"` confirms suspending every other tab; `"unpinned"` confirms
  // suspending every other unpinned tab. Kept separate from
  // `closeConfirmation` since suspend and close confirmations are never in
  // progress at the same time, but sharing one state variable would force an
  // unrelated union type onto both actions.
  const [suspendOthersConfirmation, setSuspendOthersConfirmation] = useState<
    "all" | "unpinned" | null
  >(null);
  // Which id list and wording the suspend-others confirmation step is
  // currently showing for. Meaningless while `suspendOthersConfirmation` is
  // `null`, i.e. before that step is ever shown.
  const suspendOthersTargetIds =
    suspendOthersConfirmation === "unpinned"
      ? otherSuspendableUnpinnedIds
      : otherSuspendableIds;
  const suspendOthersNoun =
    suspendOthersConfirmation === "unpinned" ? "unpinned tab" : "tab";
  // The “move to window” picker, once its window list has been fetched;
  // `null` while the main menu (or the close confirmation) is showing.
  const [windowPicker, setWindowPicker] = useState<{
    scope: "targets" | "tree";
    windows: WindowOption[];
  } | null>(null);

  // Also reruns when the close confirmation, suspend-others confirmation, or
  // window picker swaps in (a different size), since that can newly push the
  // bottom/right edge out of view.
  const position = useViewportClampedPosition(menuReference, { x, y }, [
    closeConfirmation,
    suspendOthersConfirmation,
    windowPicker,
  ]);

  useDismissOnOutsideActivity(menuReference, onClose);

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

  const handleConfirmSuspendOthers = (): void => {
    for (const id of suspendOthersTargetIds) {
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

  // Pinning/unpinning is left to Chrome’s native `chrome.tabs.update`, same
  // as Reload/Suspend above—`chrome.tabs.onUpdated` already reconciles the
  // tree afterward (`reorderFromPinnedChange`, `src/background/index.ts`),
  // so there’s no need to route this through a `TaborMessage` first.
  const handlePin = (): void => {
    for (const id of targetIds) {
      void chrome.tabs.update(id, { pinned: true });
    }
    onClose();
  };

  const handleUnpin = (): void => {
    for (const id of targetIds) {
      void chrome.tabs.update(id, { pinned: false });
    }
    onClose();
  };

  // Anchored at the menu’s own (already viewport-clamped) position, same as
  // a row’s own note button anchors off of its own position.
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
      // (`src/background/index.ts`) for why: given an array, Chrome doesn’t
      // reliably land every id in the destination window, which silently
      // drops it from `noteTreeMoveAttached`’s batch and leaves the whole
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
    void closeTabs(windowId, idsToClose);
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
          suspendOthersConfirmation === null ? (
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
              {!isEveryTargetPinned && (
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu__item"
                  onClick={handlePin}
                >
                  <PinIcon />
                  Pin
                </button>
              )}
              {isAnyTargetPinned && (
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu__item"
                  onClick={handleUnpin}
                >
                  <PinIcon />
                  Unpin
                </button>
              )}
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
              {otherSuspendableIds.length > 0 && (
                <button
                  type="button"
                  role="menuitem"
                  className="context-menu__item"
                  onClick={() => setSuspendOthersConfirmation("all")}
                >
                  <PauseIcon />
                  Suspend other tab(s)
                </button>
              )}
              {/* Hidden when identical to “Suspend other tab(s)” above, i.e.
                  the window has no pinned tabs to exclude in the first
                  place. */}
              {otherSuspendableUnpinnedIds.length > 0 &&
                otherSuspendableUnpinnedIds.length !==
                  otherSuspendableIds.length && (
                  <button
                    type="button"
                    role="menuitem"
                    className="context-menu__item"
                    onClick={() => setSuspendOthersConfirmation("unpinned")}
                  >
                    <PauseIcon />
                    Suspend other unpinned tab(s)
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
                {`Suspend ${suspendOthersTargetIds.length} other ${suspendOthersNoun}${suspendOthersTargetIds.length === 1 ? "" : "s"}?`}
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
                  onClick={handleConfirmSuspendOthers}
                >
                  Suspend
                </button>
              </div>
            </div>
          )
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
