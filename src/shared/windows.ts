/**
 * The ids of every currently open window, of every type—not just
 * `chrome.windows.getAll()`’s default of normal and popup windows—so a
 * window of any other type (e.g. an installed PWA’s app window) is never
 * mistaken for a closed one.
 */
export async function queryOpenWindowIds(): Promise<number[]> {
  const windows = await chrome.windows.getAll({
    windowTypes: ["normal", "popup", "panel", "app", "devtools"],
  });
  return windows
    .map((window) => window.id)
    .filter((id): id is number => id !== undefined);
}
