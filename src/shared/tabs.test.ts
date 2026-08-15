import { describe, expect, it } from "vitest";
import { isTaborOwnTab, normalizeFavIconUrl, toActualTab } from "./tabs";

function tab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    url: "https://example.com",
    title: "Example",
    pinned: false,
    status: "complete",
    discarded: false,
    ...overrides,
  } as chrome.tabs.Tab;
}

describe("normalizeFavIconUrl", () => {
  it("passes through an ordinary URL", () => {
    expect(normalizeFavIconUrl("https://example.com/favicon.ico")).toBe(
      "https://example.com/favicon.ico",
    );
  });

  it("treats an empty string as no favicon", () => {
    expect(normalizeFavIconUrl("")).toBeUndefined();
  });

  it("treats undefined as no favicon", () => {
    expect(normalizeFavIconUrl(undefined)).toBeUndefined();
  });

  it("treats a file:// favicon as no favicon", () => {
    // The side panel is an extension page and isn't allowed to load
    // `file://` resources, so rendering one as an `<img src>` would just log
    // a console error.
    expect(
      normalizeFavIconUrl("file:///Users/example/project/favicon.ico"),
    ).toBeUndefined();
  });
});

describe("toActualTab", () => {
  it("drops a file:// favicon", () => {
    const actual = toActualTab(
      tab({
        url: "file:///Users/example/project/index.html",
        favIconUrl: "file:///Users/example/project/favicon.ico",
      }),
    );

    expect(actual.favIconUrl).toBeUndefined();
  });

  it("keeps an ordinary favicon", () => {
    const actual = toActualTab(
      tab({ favIconUrl: "https://example.com/favicon.ico" }),
    );

    expect(actual.favIconUrl).toBe("https://example.com/favicon.ico");
  });
});

describe("isTaborOwnTab", () => {
  it("matches the side panel's own URL", () => {
    const own = tab({ url: chrome.runtime.getURL("src/sidepanel/index.html") });
    expect(isTaborOwnTab(own)).toBe(true);
  });

  it("does not match an ordinary tab", () => {
    expect(isTaborOwnTab(tab())).toBe(false);
  });
});
