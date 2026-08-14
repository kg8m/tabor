import { describe, expect, it } from "vitest";
import { toSelfHealingUpdate, toTabUpdate } from "./tab-update";

function tab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    status: "complete",
    discarded: false,
    ...overrides,
  } as chrome.tabs.Tab;
}

describe("toTabUpdate", () => {
  it("sets loading from changeInfo.status when this event reports one", () => {
    const update = toTabUpdate(
      { status: "loading" },
      tab({ status: "loading" }),
    );

    expect(update.loading).toBe(true);
  });

  it("clears loading from changeInfo.status when this event reports completion", () => {
    const update = toTabUpdate(
      { status: "complete" },
      tab({ status: "complete" }),
    );

    expect(update.loading).toBe(false);
  });

  it("clears a stuck loading from the live tab.status when this event has no status of its own", () => {
    const update = toTabUpdate(
      { title: "New title" },
      tab({ status: "complete" }),
    );

    expect(update.loading).toBe(false);
  });

  it("does not set loading from a stale tab.status when this event has no status of its own", () => {
    // Some pages (observed on Google Drive) can leave `tab.status` reading
    // "loading" indefinitely; an unrelated event (e.g. a title change)
    // shouldn't latch onto that and force the spinner back on.
    const update = toTabUpdate(
      { title: "New title" },
      tab({ status: "loading" }),
    );

    expect(update.loading).toBeUndefined();
  });

  it("always reflects the live tab.discarded for suspended", () => {
    const update = toTabUpdate(
      { title: "New title" },
      tab({ discarded: true }),
    );

    expect(update.suspended).toBe(true);
  });

  it("only includes url/title/favIconUrl/pinned when changeInfo reports them", () => {
    const update = toTabUpdate({}, tab());

    expect(update).not.toHaveProperty("url");
    expect(update).not.toHaveProperty("title");
    expect(update).not.toHaveProperty("favIconUrl");
    expect(update).not.toHaveProperty("pinned");
  });

  it("includes url/title/favIconUrl/pinned when changeInfo reports them", () => {
    const update = toTabUpdate(
      {
        url: "https://example.com",
        title: "Example",
        favIconUrl: "https://example.com/favicon.ico",
        pinned: true,
      },
      tab(),
    );

    expect(update.url).toBe("https://example.com");
    expect(update.title).toBe("Example");
    expect(update.favIconUrl).toBe("https://example.com/favicon.ico");
    expect(update.pinned).toBe(true);
  });
});

describe("toSelfHealingUpdate", () => {
  it("clears loading when the tab is complete", () => {
    const update = toSelfHealingUpdate(tab({ status: "complete" }));

    expect(update.loading).toBe(false);
  });

  it("does not set loading when the tab reads as still loading", () => {
    // A tab reactivated right after closing one opened from it (or certain
    // pages like Google Drive) can have `tab.status` read "loading" long
    // past when it's actually done, with nothing further ever correcting
    // it—so this must never turn the spinner on, only ever off.
    const update = toSelfHealingUpdate(tab({ status: "loading" }));

    expect(update.loading).toBeUndefined();
  });

  it("always reflects the live tab.discarded for suspended", () => {
    const update = toSelfHealingUpdate(tab({ discarded: true }));

    expect(update.suspended).toBe(true);
  });
});
