import { describe, expect, it } from "vitest";
import { extractNumericSuffix } from "./storage-keys";

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
