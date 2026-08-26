/**
 * Tuning knobs for `waitForTabCreationToSettle`/
 * `waitForTabCreationToFullySettle`.
 */
export interface SettleOptions {
  quietMs?: number;
  maxWaitMs?: number;
}

const DEFAULT_QUIET_MS = 800;
const DEFAULT_MAX_WAIT_MS = 8000;

/**
 * Chrome has no "session restore finished" event, so this waits for
 * `chrome.tabs.onCreated` to go quiet for a bit instead: querying tabs right
 * after `runtime.onStartup` can otherwise race session restore and return
 * before every previously open tab has been recreated. Those still-pending
 * tabs would then arrive moments later as ordinary `onCreated` events and get
 * mistaken for brand-new tabs (parented under whichever tab happens to be
 * active) instead of being included in the tree being restored for them.
 *
 * `maxWaitMs` bounds the wait for a window that never goes quiet, so this
 * degrades to roughly today's un-settled query timing rather than hanging.
 *
 * Resolves with how many `chrome.tabs.onCreated` events it observed while
 * waiting—0 means a full `quietMs` passed with nothing created at all,
 * which callers needing to know when creation has *truly* stopped (not just
 * paused) can use to decide whether to wait another round (see
 * `waitForTabCreationToFullySettle`).
 */
export function waitForTabCreationToSettle({
  quietMs = DEFAULT_QUIET_MS,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
}: SettleOptions = {}): Promise<number> {
  let tabCount = 0;

  return new Promise((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout>;

    const finish = (): void => {
      clearTimeout(quietTimer);
      clearTimeout(maxTimer);
      chrome.tabs.onCreated.removeListener(handleCreated);
      resolve(tabCount);
    };

    const handleCreated = (): void => {
      tabCount += 1;
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    };

    const maxTimer = setTimeout(finish, maxWaitMs);
    chrome.tabs.onCreated.addListener(handleCreated);
    quietTimer = setTimeout(finish, quietMs);
  });
}

/**
 * Like `waitForTabCreationToSettle`, but keeps re-settling as long as each
 * round observes at least one tab being created. A large session restore can
 * burst, pause, and burst again—e.g. finishing the active tab first before
 * continuing with the rest—going quiet for a full `quietMs` in between
 * without actually being done, which a single settle round can't tell apart
 * from genuine completion.
 */
export async function waitForTabCreationToFullySettle(
  options: SettleOptions = {},
): Promise<void> {
  let tabCount = await waitForTabCreationToSettle(options);
  while (tabCount > 0) {
    tabCount = await waitForTabCreationToSettle(options);
  }
}
