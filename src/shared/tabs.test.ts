import { describe, expect, it } from "vitest";
import {
  getCachedFaviconUrl,
  isTabSuspended,
  isTaborOwnTab,
  normalizeFavIconUrl,
  toActualTab,
} from "./tabs";

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

describe("getCachedFaviconUrl", () => {
  // `chrome.runtime.getURL` is stubbed in `src/vitest.setup.ts` to return the
  // given path as is.
  it("points the `_favicon` API at the page URL with the given size", () => {
    expect(getCachedFaviconUrl("chrome://extensions/", 16)).toBe(
      "/_favicon/?pageUrl=chrome%3A%2F%2Fextensions%2F&size=16",
    );
  });

  it("encodes characters in the page URL that are special in a query string", () => {
    expect(
      getCachedFaviconUrl("https://example.com/search?q=a&b=c#top", 16),
    ).toBe(
      "/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fsearch%3Fq%3Da%26b%3Dc%23top&size=16",
    );
  });
});

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
    // The side panel is an extension page and isn’t allowed to load
    // `file://` resources, so rendering one as an `<img src>` would just log
    // a console error.
    expect(
      normalizeFavIconUrl("file:///Users/example/project/favicon.ico"),
    ).toBeUndefined();
  });
});

describe("isTabSuspended", () => {
  it("treats a discarded tab as suspended", () => {
    expect(isTabSuspended(tab({ discarded: true }))).toBe(true);
  });

  it("treats an unloaded-but-not-discarded tab as suspended", () => {
    // A tab Chrome just recreated from session restore or a window reopen
    // and hasn’t loaded yet (never clicked)—`discarded` alone can’t tell
    // this apart from an ordinary tab, but `status` can.
    expect(isTabSuspended(tab({ discarded: false, status: "unloaded" }))).toBe(
      true,
    );
  });

  it("treats an ordinary loaded tab as not suspended", () => {
    expect(isTabSuspended(tab({ discarded: false, status: "complete" }))).toBe(
      false,
    );
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

  it("reflects an audible tab", () => {
    const actual = toActualTab(tab({ audible: true }));

    expect(actual.audible).toBe(true);
  });

  it("treats a missing audible as false", () => {
    const actual = toActualTab(tab());

    expect(actual.audible).toBe(false);
  });
});

describe("isTaborOwnTab", () => {
  it("matches the side panel’s own URL", () => {
    const own = tab({ url: chrome.runtime.getURL("src/sidepanel/index.html") });
    expect(isTaborOwnTab(own)).toBe(true);
  });

  it("does not match an ordinary tab", () => {
    expect(isTaborOwnTab(tab())).toBe(false);
  });
});
