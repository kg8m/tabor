import {
  BACKUP_KEY_PREFIX,
  loadKeysByNumericSuffix,
  loadValuesByNumericSuffix,
} from "../storage-keys";
import { normalizeTree } from "./normalize";
import type { TreeState } from "./types";

/**
 * One point-in-time backup: every window's tree as it stood at `timestamp`.
 */
export interface BackupSnapshot {
  timestamp: number;
  windows: Record<number, TreeState>;
}

function getBackupStorageKey(timestamp: number): string {
  return `${BACKUP_KEY_PREFIX}${timestamp}`;
}

/**
 * Persist a full-state snapshot, keyed by `timestamp` (see
 * `selectBackupTimestampsToKeep` for how backups are later thinned out).
 */
export async function saveBackup(
  timestamp: number,
  windows: Record<number, TreeState>,
): Promise<void> {
  await chrome.storage.local.set({
    [getBackupStorageKey(timestamp)]: windows,
  });
}

function normalizeWindows(
  windows: Record<number, TreeState>,
): Record<number, TreeState> {
  const normalized: Record<number, TreeState> = {};
  for (const [windowId, tree] of Object.entries(windows)) {
    normalized[Number(windowId)] = normalizeTree(tree);
  }
  return normalized;
}

/**
 * Load the snapshot saved at `timestamp`, or `undefined` if none exists
 * (e.g. it's already been thinned out).
 */
export async function loadBackup(
  timestamp: number,
): Promise<Record<number, TreeState> | undefined> {
  const key = getBackupStorageKey(timestamp);
  const result = await chrome.storage.local.get(key);
  const windows = result[key] as Record<number, TreeState> | undefined;
  return windows === undefined ? undefined : normalizeWindows(windows);
}

/**
 * Load every backup snapshot currently in storage, in no particular order.
 */
export async function loadAllBackups(): Promise<BackupSnapshot[]> {
  const stored = await loadValuesByNumericSuffix(BACKUP_KEY_PREFIX);
  const backups: BackupSnapshot[] = [];

  for (const [timestamp, value] of stored) {
    backups.push({
      timestamp,
      windows: normalizeWindows(value as Record<number, TreeState>),
    });
  }

  return backups;
}

/**
 * The timestamp of every backup currently in storage, in no particular
 * order—without reading the snapshots themselves, for callers that only
 * need to decide which to keep (see `selectBackupTimestampsToKeep`).
 */
export async function loadBackupTimestamps(): Promise<number[]> {
  const keysByTimestamp = await loadKeysByNumericSuffix(BACKUP_KEY_PREFIX);
  return keysByTimestamp.keys().toArray();
}

/**
 * Delete the backups saved at the given timestamps.
 */
export async function removeBackups(timestamps: number[]): Promise<void> {
  await chrome.storage.local.remove(
    timestamps.map((timestamp) => getBackupStorageKey(timestamp)),
  );
}

// The first two edges are fixed (matching the backup interval); every edge
// after that is the sum of the previous two, so the gap between kept backups
// keeps widening the further back in time you go (5, 10, 15, 25, 40, 65,
// 105, ...). Expressed in minutes since that's the unit backups are actually
// spaced in.
const FIRST_BUCKET_EDGE_MINUTES = 5;
const SECOND_BUCKET_EDGE_MINUTES = 10;

// Beyond this age, a bucket-thinned backup is dropped entirely instead of
// being kept forever—unless too few backups would then be left (see
// MIN_KEEP_COUNT below).
const MAX_AGE_MINUTES = 30 * 24 * 60;

// If there are more than this many backups to begin with,
// selectBackupTimestampsToKeep never lets the kept set drop below this many:
// when bucket-thinning plus the MAX_AGE_MINUTES cutoff would leave fewer, it
// tops up with the bucket survivors closest to the MAX_AGE_MINUTES
// cutoff—never with a bucket's ordinary rejects, which stay thinned—e.g.
// after a long idle stretch, where every backup that survived thinning
// before going idle is now older than MAX_AGE_MINUTES.
const MIN_KEEP_COUNT = 20;

function generateBucketRangesMinutes(
  maxAgeMinutes: number,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [
    [FIRST_BUCKET_EDGE_MINUTES, SECOND_BUCKET_EDGE_MINUTES],
  ];

  let lower = FIRST_BUCKET_EDGE_MINUTES;
  let upper = SECOND_BUCKET_EDGE_MINUTES;
  while (upper <= maxAgeMinutes) {
    const next = lower + upper;
    ranges.push([upper, next]);
    lower = upper;
    upper = next;
  }

  return ranges;
}

/**
 * Decides which backup timestamps survive thinning, given the current time.
 *
 * If there are MIN_KEEP_COUNT or fewer backups to begin with, none of this
 * applies—there's nothing worth thinning, so everything is kept.
 *
 * Otherwise: anything younger than the first bucket edge is always kept in
 * full (in normal operation there's at most one such backup anyway, since
 * they're taken on the same interval as the first edge). Everything older is
 * grouped into buckets whose age range doubles-ish in width the further
 * back they start (see `generateBucketRangesMinutes`), keeping only the
 * oldest backup in each bucket—the one that can stand in for the widest
 * span of time before the next kept backup.
 *
 * Bucket survivors older than MAX_AGE_MINUTES are then dropped. If that
 * leaves fewer than MIN_KEEP_COUNT backups, the shortfall is topped up with
 * the bucket survivors closest to the MAX_AGE_MINUTES cutoff—reaching past
 * MAX_AGE_MINUTES if it must, e.g. after a long idle stretch where every
 * survivor is now older than that cutoff. This never reaches into a
 * bucket's ordinary rejects (the ones dropped in favor of their bucket's
 * survivor): otherwise a bucket still within MAX_AGE_MINUTES would get
 * padded back out with the closely-spaced backups it just thinned.
 */
export function selectBackupTimestampsToKeep(
  timestamps: number[],
  now: number,
): number[] {
  if (timestamps.length <= MIN_KEEP_COUNT) {
    return timestamps;
  }

  const entries = timestamps.map((timestamp) => ({
    timestamp,
    ageMinutes: (now - timestamp) / 60_000,
  }));

  const bucketed = new Set<number>();

  for (const entry of entries) {
    if (entry.ageMinutes < FIRST_BUCKET_EDGE_MINUTES) {
      bucketed.add(entry.timestamp);
    }
  }

  const maxAge = Math.max(...entries.map((entry) => entry.ageMinutes));
  for (const [lower, upper] of generateBucketRangesMinutes(maxAge)) {
    let oldest: (typeof entries)[number] | undefined;

    for (const entry of entries) {
      if (
        entry.ageMinutes >= lower &&
        entry.ageMinutes < upper &&
        (oldest === undefined || entry.ageMinutes > oldest.ageMinutes)
      ) {
        oldest = entry;
      }
    }

    if (oldest !== undefined) {
      bucketed.add(oldest.timestamp);
    }
  }

  const kept = new Set(
    entries
      .filter((entry) => bucketed.has(entry.timestamp))
      .filter((entry) => entry.ageMinutes <= MAX_AGE_MINUTES)
      .map((entry) => entry.timestamp),
  );

  const shortfall = MIN_KEEP_COUNT - kept.size;
  if (shortfall > 0) {
    // Only bucket survivors that aged out past MAX_AGE_MINUTES are eligible
    // here—never a bucket's ordinary rejects, or a bucket still within
    // MAX_AGE_MINUTES would get padded back out with the closely-spaced
    // backups it just thinned.
    const agedOutSurvivors = entries
      .filter(
        (entry) => bucketed.has(entry.timestamp) && !kept.has(entry.timestamp),
      )
      .toSorted((a, b) => a.ageMinutes - b.ageMinutes)
      .slice(0, shortfall);

    for (const entry of agedOutSurvivors) {
      kept.add(entry.timestamp);
    }
  }

  return [...kept];
}
