import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNode } from "../shared/tree/test-helpers";
import type { TreeState } from "../shared/tree/types";
import {
  clearPendingClose,
  noteTabRemoved,
  registerPendingClose,
  settlePendingClose,
} from "./pending-close";
import { deleteWindow, setActiveTabId, setTree } from "./store";

const WINDOW_ID = 1;

// A (parent) -> B, C (children, B before C)
const A = createNode({ id: 1, childIds: [2, 3] });
const B = createNode({ id: 2, parentId: 1 });
const C = createNode({ id: 3, parentId: 1 });
const TREE: TreeState = { nodes: { 1: A, 2: B, 3: C }, rootIds: [1] };

const chromeMock: { update: ReturnType<typeof vi.fn> } = { update: vi.fn() };

beforeEach(() => {
  vi.useFakeTimers();
  chromeMock.update = vi.fn();
  vi.stubGlobal("chrome", { tabs: { update: chromeMock.update } });
  setTree(WINDOW_ID, TREE);
});

afterEach(() => {
  clearPendingClose(WINDOW_ID);
  deleteWindow(WINDOW_ID);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("noteTabRemoved / settlePendingClose (native close, not registered)", () => {
  it("focuses the closed tab's sibling even when Chrome's own onActivated for its replacement already overwrote the active tab id", async () => {
    // B is active, then Chrome fires `tabs.onActivated` for its own
    // replacement pick (A) before `tabs.onRemoved` for B arrives—this is
    // what actually happens when B is closed natively while active.
    setActiveTabId(WINDOW_ID, 2);
    setActiveTabId(WINDOW_ID, 1);

    noteTabRemoved(WINDOW_ID, 2);
    settlePendingClose(WINDOW_ID);
    await vi.runAllTimersAsync();

    expect(chromeMock.update).toHaveBeenCalledWith(3, { active: true });
  });

  it("does not correct focus when the tab active at close time wasn't the one closed", async () => {
    setActiveTabId(WINDOW_ID, 1);

    noteTabRemoved(WINDOW_ID, 2);
    settlePendingClose(WINDOW_ID);
    await vi.runAllTimersAsync();

    expect(chromeMock.update).not.toHaveBeenCalled();
  });
});

describe("registerPendingClose (Tabor-initiated close)", () => {
  it("focuses the closed tab's sibling using the active id captured at registration time", async () => {
    setActiveTabId(WINDOW_ID, 2);

    registerPendingClose(WINDOW_ID, [2]);
    noteTabRemoved(WINDOW_ID, 2);
    settlePendingClose(WINDOW_ID);
    await vi.runAllTimersAsync();

    expect(chromeMock.update).toHaveBeenCalledWith(3, { active: true });
  });
});
