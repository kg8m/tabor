import type { TreeState } from "./types";

const BACKUP_KEY_PREFIX = "tabor:backup:";

export interface BackupSnapshot {
  timestamp: number;
  windows: Record<number, TreeState>;
}

function getBackupStorageKey(timestamp: number): string {
  return `${BACKUP_KEY_PREFIX}${timestamp}`;
}

export async function saveBackup(
  timestamp: number,
  windows: Record<number, TreeState>,
): Promise<void> {
  await chrome.storage.local.set({
    [getBackupStorageKey(timestamp)]: windows,
  });
}

export async function loadBackup(
  timestamp: number,
): Promise<Record<number, TreeState> | undefined> {
  const key = getBackupStorageKey(timestamp);
  const result = await chrome.storage.local.get(key);
  return result[key] as Record<number, TreeState> | undefined;
}

export async function loadAllBackups(): Promise<BackupSnapshot[]> {
  const all = await chrome.storage.local.get(null);
  const backups: BackupSnapshot[] = [];

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(BACKUP_KEY_PREFIX)) {
      continue;
    }
    const timestamp = Number(key.slice(BACKUP_KEY_PREFIX.length));
    backups.push({ timestamp, windows: value as Record<number, TreeState> });
  }

  return backups;
}

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
 * Anything younger than the first bucket edge is always kept in full (in
 * normal operation there's at most one such backup anyway, since they're
 * taken on the same interval as the first edge). Everything older is
 * grouped into buckets whose age range doubles-ish in width the further
 * back they start (see `generateBucketRangesMinutes`), keeping only the
 * oldest backup in each bucket—the one that can stand in for the widest
 * span of time before the next kept backup.
 */
export function selectBackupTimestampsToKeep(
  timestamps: number[],
  now: number,
): number[] {
  const entries = timestamps.map((timestamp) => ({
    timestamp,
    ageMinutes: (now - timestamp) / 60_000,
  }));

  if (entries.length === 0) {
    return [];
  }

  const kept = new Set<number>();

  for (const entry of entries) {
    if (entry.ageMinutes < FIRST_BUCKET_EDGE_MINUTES) {
      kept.add(entry.timestamp);
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
      kept.add(oldest.timestamp);
    }
  }

  return [...kept];
}
