import { useEffect, useState } from "react";

/**
 * The id of the window this side panel is attached to.
 */
export function useWindowId(): number | undefined {
  const [windowId, setWindowId] = useState<number>();

  useEffect(() => {
    let isCancelled = false;

    async function detectWindowId() {
      const window = await chrome.windows.getCurrent();
      // The side panel can momentarily have no window it's clearly attached
      // to (e.g. while being detached), in which case Chrome reports
      // `WINDOW_ID_NONE` (-1) instead of leaving `id` undefined. Treat that
      // the same as "not known yet" rather than passing it on as if it were
      // a real window—every consumer downstream (message sends, storage
      // keys) would otherwise treat it as one.
      if (
        !isCancelled &&
        window.id !== undefined &&
        window.id !== chrome.windows.WINDOW_ID_NONE
      ) {
        setWindowId(window.id);
      }
    }
    void detectWindowId();

    return () => {
      isCancelled = true;
    };
  }, []);

  return windowId;
}
