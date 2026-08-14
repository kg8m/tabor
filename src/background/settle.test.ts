import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  waitForTabCreationToFullySettle,
  waitForTabCreationToSettle,
} from "./settle";

const chromeMock: { listeners: (() => void)[] } = { listeners: [] };

beforeEach(() => {
  vi.useFakeTimers();
  chromeMock.listeners = [];
  vi.stubGlobal("chrome", {
    tabs: {
      onCreated: {
        addListener: (listener: () => void) => {
          chromeMock.listeners.push(listener);
        },
        removeListener: (listener: () => void) => {
          chromeMock.listeners = chromeMock.listeners.filter(
            (each) => each !== listener,
          );
        },
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("waitForTabCreationToSettle", () => {
  it("resolves once the quiet period passes with no tab creation", async () => {
    let isResolved = false;
    void (async () => {
      await waitForTabCreationToSettle({ quietMs: 100, maxWaitMs: 1000 });
      isResolved = true;
    })();

    await vi.advanceTimersByTimeAsync(99);
    expect(isResolved).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    expect(isResolved).toBe(true);
  });

  it("restarts the quiet period every time a tab is created", async () => {
    let isResolved = false;
    void (async () => {
      await waitForTabCreationToSettle({ quietMs: 100, maxWaitMs: 1000 });
      isResolved = true;
    })();

    await vi.advanceTimersByTimeAsync(80);
    for (const listener of chromeMock.listeners) {
      listener();
    }

    await vi.advanceTimersByTimeAsync(80);
    expect(isResolved).toBe(false);

    await vi.advanceTimersByTimeAsync(30);
    expect(isResolved).toBe(true);
  });

  it("gives up after maxWaitMs even if tabs keep arriving", async () => {
    let isResolved = false;
    void (async () => {
      await waitForTabCreationToSettle({ quietMs: 100, maxWaitMs: 250 });
      isResolved = true;
    })();

    for (let elapsed = 0; elapsed < 240; elapsed += 60) {
      await vi.advanceTimersByTimeAsync(60);
      for (const listener of chromeMock.listeners) {
        listener();
      }
    }
    expect(isResolved).toBe(false);

    await vi.advanceTimersByTimeAsync(20);
    expect(isResolved).toBe(true);
  });

  it("removes its onCreated listener once settled", async () => {
    await Promise.all([
      waitForTabCreationToSettle({ quietMs: 10, maxWaitMs: 1000 }),
      vi.advanceTimersByTimeAsync(10),
    ]);

    expect(chromeMock.listeners).toHaveLength(0);
  });
});

describe("waitForTabCreationToFullySettle", () => {
  it("keeps re-settling through multiple bursts before resolving", async () => {
    let isResolved = false;
    void (async () => {
      await waitForTabCreationToFullySettle({ quietMs: 50, maxWaitMs: 1000 });
      isResolved = true;
    })();

    // First burst: the first round observes a tab, so once it quiets it
    // should loop into a second round rather than resolving.
    await vi.advanceTimersByTimeAsync(0);
    for (const listener of chromeMock.listeners) {
      listener();
    }
    await vi.advanceTimersByTimeAsync(60);
    expect(isResolved).toBe(false);

    // Second burst, arriving during that second round: same story again.
    for (const listener of chromeMock.listeners) {
      listener();
    }
    await vi.advanceTimersByTimeAsync(60);
    expect(isResolved).toBe(false);

    // Truly quiet this time: the round that observes nothing ends the loop.
    await vi.advanceTimersByTimeAsync(60);
    expect(isResolved).toBe(true);
  });
});
