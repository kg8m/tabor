import { describe, expect, it } from "vitest";
import { selectBackupTimestampsToKeep } from "./backup";

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

function timestampAgeMinutesAgo(minutes: number): number {
  return NOW - minutes * MINUTE;
}

// Below MIN_KEEP_COUNT total backups, selectBackupTimestampsToKeep skips
// thinning entirely and keeps everything—which would defeat the per-bucket
// thinning tests below before they even reach the logic they mean to
// exercise. Padding the input with enough always-kept (sub-5-minute) filler
// pushes the total past MIN_KEEP_COUNT so thinning actually runs.
function fillerTimestamps(count: number): number[] {
  return Array.from({ length: count }, (_, index) =>
    timestampAgeMinutesAgo(index * 0.01),
  );
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
    const filler = fillerTimestamps(19); // 19 filler + 1 bucket winner = 20

    const kept = selectBackupTimestampsToKeep([older, newer, ...filler], NOW);

    expect(kept).not.toContain(newer);
    expect(kept).toContain(older);
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
    const filler = fillerTimestamps(13); // 13 filler + 2 recent + 5 bucket winners = 20

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
        ...filler,
      ],
      NOW,
    );

    expect(kept).toEqual(
      expect.arrayContaining([
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

  it("keeps every backup when there are fewer than MIN_KEEP_COUNT of them, even ones plain bucket thinning would drop", () => {
    const newer = timestampAgeMinutesAgo(6);
    const older = timestampAgeMinutesAgo(8);

    const kept = selectBackupTimestampsToKeep([older, newer], NOW);

    expect(new Set(kept)).toEqual(new Set([older, newer]));
  });

  it("keeps a long-idle sparse history in full, since it never exceeds MIN_KEEP_COUNT", () => {
    // Simulates a long idle stretch: these 7 timestamps were already
    // thinned down to a sparse spread while backups were being taken
    // regularly (see the "one backup per bucket" test above), then nothing
    // ran for a long time. Viewed from far enough in the future, a plain
    // bucket-thinning pass over them would collapse almost all of them into
    // a single wide bucket—but since there are only 7 of them, the
    // MIN_KEEP_COUNT floor keeps all of them regardless of thinning.
    const recentA = timestampAgeMinutesAgo(1);
    const recentB = timestampAgeMinutesAgo(2);
    const bucket5to10Kept = timestampAgeMinutesAgo(8);
    const bucket10to15Kept = timestampAgeMinutesAgo(12);
    const bucket25to40Kept = timestampAgeMinutesAgo(33);
    const bucket40to65Kept = timestampAgeMinutesAgo(50);
    const veryOldKept = timestampAgeMinutesAgo(200);
    const alreadyThinned = [
      recentA,
      recentB,
      bucket5to10Kept,
      bucket10to15Kept,
      bucket25to40Kept,
      bucket40to65Kept,
      veryOldKept,
    ];
    const muchLaterNow = NOW + 100 * 24 * 60 * MINUTE;

    const kept = selectBackupTimestampsToKeep(alreadyThinned, muchLaterNow);

    expect(new Set(kept)).toEqual(new Set(alreadyThinned));
  });

  it("does not pad the shortfall out with a bucket's ordinary rejects, only with aged-out bucket survivors", () => {
    // 19 closely-spaced backups plus their bucket's one survivor push the
    // total past MIN_KEEP_COUNT, so thinning actually runs and drops the 19.
    // A single 40-day-old backup is the only other bucket survivor, and it's
    // aged past MAX_AGE_MINUTES. The shortfall this leaves (nowhere near
    // MIN_KEEP_COUNT) must be topped up only from that aged-out survivor—
    // never from the 19 ordinary rejects thinning already dropped, even
    // though that's the only way to actually reach MIN_KEEP_COUNT.
    const bucket5to10Kept = timestampAgeMinutesAgo(8);
    const ordinaryRejects = Array.from({ length: 19 }, (_, index) =>
      timestampAgeMinutesAgo(5 + (index + 1) * 0.01),
    );
    const agedOutSurvivor = timestampAgeMinutesAgo(40 * 24 * 60);

    const kept = selectBackupTimestampsToKeep(
      [bucket5to10Kept, ...ordinaryRejects, agedOutSurvivor],
      NOW,
    );

    expect(new Set(kept)).toEqual(
      new Set([bucket5to10Kept, agedOutSurvivor]),
    );
  });

  it("drops a bucket-survivor older than 30 days once at least 20 newer ones survive", () => {
    // 20 timestamps within the first bucket edge, always kept in full
    // regardless of thinning, plus one far older than 30 days that would
    // otherwise also survive thinning as its own bucket's representative.
    const recents = Array.from({ length: 20 }, (_, index) =>
      timestampAgeMinutesAgo(index * 0.2),
    );
    const beyondMaxAge = timestampAgeMinutesAgo(60 * 24 * 40); // 40 days

    const kept = selectBackupTimestampsToKeep([...recents, beyondMaxAge], NOW);

    expect(kept).not.toContain(beyondMaxAge);
  });

  it("keeps the newest 20 bucket-survivors even when all of them are older than 30 days", () => {
    // Ages (in minutes), one picked from inside each of 25 consecutive
    // buckets starting at the first bucket entirely past the 30-day cutoff,
    // so each of these 25 timestamps survives thinning as its own bucket's
    // representative, ordered oldest-bucket-edge-first (i.e. most recent
    // first).
    const bucketSurvivorAgesMinutes = [
      88_554, 143_284, 231_839, 375_124, 606_964, 982_089, 1_589_054, 2_571_144,
      4_160_199, 6_731_344, 10_891_544, 17_622_889, 28_514_434, 46_137_324,
      74_651_759, 120_789_084, 195_440_844, 316_229_929, 511_670_774,
      827_900_704, 1_339_571_479, 2_167_472_184, 3_507_043_664, 5_674_515_849,
      9_181_559_514,
    ];
    const timestamps = bucketSurvivorAgesMinutes.map((minutes) =>
      timestampAgeMinutesAgo(minutes),
    );

    const kept = selectBackupTimestampsToKeep(timestamps, NOW);

    expect(kept).toHaveLength(20);
    expect(new Set(kept)).toEqual(new Set(timestamps.slice(0, 20)));
  });
});
