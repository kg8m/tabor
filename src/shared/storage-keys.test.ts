import { describe, expect, it } from "vitest";
import {
  extractSuffix,
  parseNonNegativeInteger,
  selectMalformedKeys,
} from "./storage-keys";

describe("parseNonNegativeInteger", () => {
  it("parses a string of digits", () => {
    expect(parseNonNegativeInteger("42")).toBe(42);
  });

  it("rejects a non-numeric or partly numeric string", () => {
    expect(parseNonNegativeInteger("abc")).toBeUndefined();
    expect(parseNonNegativeInteger("1x")).toBeUndefined();
  });

  it("rejects an empty string rather than parsing it as 0", () => {
    expect(parseNonNegativeInteger("")).toBeUndefined();
  });
});

describe("extractSuffix", () => {
  it("returns the suffix after the prefix, parsed", () => {
    expect(
      extractSuffix(
        "tabor:backup:42",
        "tabor:backup:",
        parseNonNegativeInteger,
      ),
    ).toBe(42);
  });

  it("returns undefined for a key with a different prefix", () => {
    expect(
      extractSuffix("tabor:tree:42", "tabor:backup:", parseNonNegativeInteger),
    ).toBeUndefined();
  });

  it("returns undefined for a suffix the parser rejects", () => {
    expect(
      extractSuffix(
        "tabor:backup:abc",
        "tabor:backup:",
        parseNonNegativeInteger,
      ),
    ).toBeUndefined();
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
