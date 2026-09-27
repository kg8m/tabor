/**
 * Every `chrome.storage` key (or key prefix) Tabor uses, kept in one place so
 * the full set and each entry's retention policy can be seen at a glance.
 * The modules that actually read/write each entry build their own concrete
 * keys from these; the helpers at the bottom cover what they share (parsing
 * a key's suffix, loading every entry under a prefix).
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
 * the periodic alarm and thinned out on the same alarm (see
 * `takeBackupSnapshot` and `selectBackupTimestampsToKeep`).
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

/**
 * Parses a key suffix, returning `undefined` if it isn't well-formed.
 */
export type SuffixParser<T> = (suffix: string) => T | undefined;

const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/;

/**
 * `value` as a number if it's made up only of digits (e.g. a window id or
 * timestamp in a key suffix)—`undefined` otherwise, so a malformed or
 * foreign key is skipped rather than being read back as `NaN` (or as `0`,
 * which is what `Number("")` gives).
 */
export function parseNonNegativeInteger(value: string): number | undefined {
  return NON_NEGATIVE_INTEGER_PATTERN.test(value) ? Number(value) : undefined;
}

/**
 * The part after `prefix` in `key`, parsed by `parse`—or `undefined` if
 * `key` doesn't start with `prefix` or the rest isn't well-formed.
 */
export function extractSuffix<T>(
  key: string,
  prefix: string,
  parse: SuffixParser<T>,
): T | undefined {
  return key.startsWith(prefix) ? parse(key.slice(prefix.length)) : undefined;
}

/**
 * Every well-formed key under `prefix` in `storageArea`, mapped from its
 * parsed suffix to its full key.
 *
 * Uses `getKeys()` rather than `get(null)`, so callers that only need keys
 * (or ids/timestamps) don't read every stored value—including every backup
 * snapshot's full tree—just to throw them away.
 */
export async function loadKeysBySuffix<T>(
  prefix: string,
  parse: SuffixParser<T>,
  storageArea: chrome.storage.StorageArea = chrome.storage.local,
): Promise<Map<T, string>> {
  const keys = await storageArea.getKeys();
  const keysBySuffix = new Map<T, string>();

  for (const key of keys) {
    const suffix = extractSuffix(key, prefix, parse);
    if (suffix !== undefined) {
      keysBySuffix.set(suffix, key);
    }
  }

  return keysBySuffix;
}

/**
 * Every well-formed entry under `prefix` in `storageArea`, mapped from its
 * parsed suffix to its stored value. Reads only those entries' values, not
 * everything in storage (see `loadKeysBySuffix`).
 */
export async function loadValuesBySuffix<T>(
  prefix: string,
  parse: SuffixParser<T>,
  storageArea: chrome.storage.StorageArea = chrome.storage.local,
): Promise<Map<T, unknown>> {
  const keysBySuffix = await loadKeysBySuffix(prefix, parse, storageArea);
  const valuesBySuffix = new Map<T, unknown>();
  if (keysBySuffix.size === 0) {
    return valuesBySuffix;
  }

  const stored = await storageArea.get(keysBySuffix.values().toArray());
  for (const [suffix, key] of keysBySuffix) {
    if (Object.hasOwn(stored, key)) {
      valuesBySuffix.set(suffix, stored[key]);
    }
  }

  return valuesBySuffix;
}

// The shape each of Tabor's `chrome.storage.local` prefixes expects its
// whole suffix to have.
const SUFFIX_PARSERS_BY_PREFIX: [string, SuffixParser<unknown>][] = [
  [TREE_KEY_PREFIX, parseNonNegativeInteger],
  [PENDING_TREE_REMOVAL_KEY_PREFIX, parseNonNegativeInteger],
  [BACKUP_KEY_PREFIX, parseNonNegativeInteger],
];

/**
 * The keys among `keys` that sit under one of Tabor's `chrome.storage.local`
 * prefixes but don't fit its shape (see `SUFFIX_PARSERS_BY_PREFIX`), or
 * `DEBUG_LOG_KEY_PREFIX` keys without a leading numeric timestamp. Every
 * reader skips these, and nothing ever writes them, so they're pure clutter
 * that would otherwise stay in storage forever. Keys outside those prefixes
 * are left alone.
 */
export function selectMalformedKeys(keys: string[]): string[] {
  return keys.filter((key) => {
    const entry = SUFFIX_PARSERS_BY_PREFIX.find(([prefix]) =>
      key.startsWith(prefix),
    );
    if (entry !== undefined) {
      const [prefix, parse] = entry;
      return extractSuffix(key, prefix, parse) === undefined;
    }
    if (key.startsWith(DEBUG_LOG_KEY_PREFIX)) {
      return !/^\d+(?:-|$)/.test(key.slice(DEBUG_LOG_KEY_PREFIX.length));
    }
    return false;
  });
}
