import { describe, expect, it } from "vitest";
import { extractNumericSuffix, selectMalformedKeys } from "./storage-keys";

describe("extractNumericSuffix", () => {
  it("returns the numeric suffix after the prefix", () => {
    expect(extractNumericSuffix("tabor:tree:42", "tabor:tree:")).toBe(42);
  });

  it("returns undefined for a key with a different prefix", () => {
    expect(
      extractNumericSuffix("tabor:backup:42", "tabor:tree:"),
    ).toBeUndefined();
  });

  it("returns undefined for a non-numeric suffix", () => {
    expect(
      extractNumericSuffix("tabor:tree:abc", "tabor:tree:"),
    ).toBeUndefined();
    expect(
      extractNumericSuffix("tabor:tree:1x", "tabor:tree:"),
    ).toBeUndefined();
  });

  it("returns undefined for an empty suffix rather than 0", () => {
    expect(extractNumericSuffix("tabor:tree:", "tabor:tree:")).toBeUndefined();
  });
});

describe("selectMalformedKeys", () => {
  it("keeps well-formed keys under every prefix", () => {
    expect(
      selectMalformedKeys([
        "tabor:tree:1",
        "tabor:pendingTreeRemoval:1",
        "tabor:backup:1700000000000",
        "tabor:debug:1700000000000-0",
        "tabor:debug:1700000000000-emptySave-1",
      ]),
    ).toEqual([]);
  });

  it("selects keys whose suffix isn't numeric under a numeric-suffix prefix", () => {
    expect(
      selectMalformedKeys([
        "tabor:tree:abc",
        "tabor:tree:",
        "tabor:pendingTreeRemoval:1x",
        "tabor:backup:abc",
      ]),
    ).toEqual([
      "tabor:tree:abc",
      "tabor:tree:",
      "tabor:pendingTreeRemoval:1x",
      "tabor:backup:abc",
    ]);
  });

  it("selects debug log keys without a leading numeric timestamp", () => {
    expect(
      selectMalformedKeys([
        "tabor:debug:abc-0",
        "tabor:debug:",
        "tabor:debug:1x-0",
      ]),
    ).toEqual(["tabor:debug:abc-0", "tabor:debug:", "tabor:debug:1x-0"]);
  });

  it("leaves keys outside Tabor's local prefixes alone", () => {
    expect(
      selectMalformedKeys([
        "tabor:session:activeTab:abc",
        "tabor:unknown:abc",
        "other:tree:abc",
      ]),
    ).toEqual([]);
  });
});
