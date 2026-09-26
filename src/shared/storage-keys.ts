/**
 * Every `chrome.storage` key (or key prefix) Tabor uses, kept in one place so
 * the full set and each entry's retention policy can be seen at a glance.
 * The modules that actually read/write each entry build their own concrete
 * keys from these.
 *
 * Changing any value here orphans whatever is already stored under the old
 * one, so a rename needs a migration.
 */

// ---- chrome.storage.local ----

/**
 * `tabor:tree:<windowId>` → `StoredTree`. Written on every tree change (see
 * `shared/tree/storage.ts`). Not removed when its window closes, so it can be
 * matched back up after a browser restart; `initializeAllWindows` removes it
 * once superseded by a match under a new window id, right away if it went
 * unmatched and has no parent/child structure, or otherwise after
 * `PENDING_REMOVAL_GRACE_MS` of staying unmatched.
 */
export const TREE_KEY_PREFIX = "tabor:tree:";

/**
 * `tabor:pendingTreeRemoval:<windowId>` → timestamp it was first marked at.
 * Marks a saved tree that went unmatched on startup (see
 * `markPendingRemoval`); cleared when it matches again or when the tree
 * itself is removed.
 *
 * Deliberately not nested under `TREE_KEY_PREFIX` (e.g.
 * "tabor:tree:pending..."): `loadAllTrees` matches any key starting with
 * that prefix, so a mark key nested under it would get picked up there too.
 */
export const PENDING_TREE_REMOVAL_KEY_PREFIX = "tabor:pendingTreeRemoval:";

/**
 * `tabor:backup:<timestamp>` → every window's tree at that time. Written by
 * the periodic backup alarm and thinned out on the same alarm (see
 * `selectBackupTimestampsToKeep` in `shared/tree/backup.ts`).
 */
export const BACKUP_KEY_PREFIX = "tabor:backup:";

/**
 * TODO(debug): `tabor:debug:<timestamp>-<suffix>` → one debug log entry,
 * from temporary instrumentation in `background/index.ts` and
 * `shared/tree/storage.ts`. Removed after `DEBUG_LOG_RETENTION_MS` by
 * `pruneOldDebugLogs`, which relies on the leading timestamp.
 */
export const DEBUG_LOG_KEY_PREFIX = "tabor:debug:";

// ---- chrome.storage.session ----
// Cleared on every real browser restart, but survives the service worker
// being killed and restarted for going idle.

/**
 * `true` once this browser session's startup reconciliation
 * (`initializeAllWindows`) has run.
 */
export const SESSION_RECONCILED_KEY = "tabor:session:reconciled";

/**
 * `true` while every normal window is gone (set by `windows.onRemoved`,
 * cleared once a normal window reopens).
 */
export const NORMAL_WINDOWS_GAP_KEY = "tabor:session:normalWindowsGapPending";

/**
 * `tabor:session:activeTab:<windowId>` → active tab id, read back after an
 * idle-wake restart (see `background/active-tab-storage.ts`). Not removed
 * when its window closes; each entry is a single number and the whole area
 * is cleared on restart anyway.
 */
export const ACTIVE_TAB_KEY_PREFIX = "tabor:session:activeTab:";
