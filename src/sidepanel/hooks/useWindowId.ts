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
      if (!isCancelled && window.id !== undefined) {
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
