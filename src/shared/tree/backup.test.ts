import { describe, expect, it } from "vitest";
import { selectBackupTimestampsToKeep } from "./backup";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

function timestampAgeMinutesAgo(minutes: number): number {
  return NOW - minutes * MINUTE;
}

describe("selectBackupTimestampsToKeep", () => {
  it("keeps nothing when there are no backups", () => {
    expect(selectBackupTimestampsToKeep([], NOW)).toEqual([]);
  });

  it("keeps every backup younger than the first bucket edge", () => {
    const timestamps = [
      timestampAgeMinutesAgo(0),
      timestampAgeMinutesAgo(1),
      timestampAgeMinutesAgo(4.9),
    ];

    const kept = selectBackupTimestampsToKeep(timestamps, NOW);

    expect(new Set(kept)).toEqual(new Set(timestamps));
  });

  it("keeps only the oldest backup within a single older bucket", () => {
    const newer = timestampAgeMinutesAgo(6);
    const older = timestampAgeMinutesAgo(8);

    const kept = selectBackupTimestampsToKeep([older, newer], NOW);

    expect(kept).toEqual([older]);
  });

  it("keeps one backup per bucket, thinning the rest, as buckets widen with age", () => {
    const recentA = timestampAgeMinutesAgo(1);
    const recentB = timestampAgeMinutesAgo(2);
    const bucket5to10Dropped = timestampAgeMinutesAgo(6);
    const bucket5to10Kept = timestampAgeMinutesAgo(8);
    const bucket10to15Kept = timestampAgeMinutesAgo(12);
    const bucket25to40Dropped = timestampAgeMinutesAgo(30);
    const bucket25to40Kept = timestampAgeMinutesAgo(33);
    const bucket40to65Kept = timestampAgeMinutesAgo(50);
    const veryOldKept = timestampAgeMinutesAgo(200);

    const kept = selectBackupTimestampsToKeep(
      [
        recentA,
        recentB,
        bucket5to10Dropped,
        bucket5to10Kept,
        bucket10to15Kept,
        bucket25to40Dropped,
        bucket25to40Kept,
        bucket40to65Kept,
        veryOldKept,
      ],
      NOW,
    );

    expect(new Set(kept)).toEqual(
      new Set([
        recentA,
        recentB,
        bucket5to10Kept,
        bucket10to15Kept,
        bucket25to40Kept,
        bucket40to65Kept,
        veryOldKept,
      ]),
    );
    expect(kept).not.toContain(bucket5to10Dropped);
    expect(kept).not.toContain(bucket25to40Dropped);
  });
});
