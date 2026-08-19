import type { TabNode } from "./types";

export function createNode(
  overrides: Partial<TabNode> & { id: number },
): TabNode {
  return {
    url: `https://example.com/${overrides.id}`,
    title: `Tab ${overrides.id}`,
    favIconUrl: undefined,
    parentId: null,
    childIds: [],
    pinned: false,
    suspended: false,
    loading: false,
    audible: false,
    collapsed: false,
    note: null,
    ...overrides,
  };
}
