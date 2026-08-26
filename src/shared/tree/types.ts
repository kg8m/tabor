/**
 * A single tab as tracked in the tree—the persisted, cross-context
 * representation a `chrome.tabs.Tab` gets normalized into.
 */
export interface TabNode {
  id: number;
  url: string;
  title: string;
  favIconUrl: string | undefined;
  parentId: number | null;
  childIds: number[];
  pinned: boolean;
  suspended: boolean;
  loading: boolean;
  audible: boolean;
  collapsed: boolean;
  note: string | null;
}

/**
 * The full tree for one window: every node keyed by tab id, plus the ids of
 * its root-level nodes in display order.
 */
export interface TreeState {
  nodes: Record<number, TabNode>;
  rootIds: number[];
}
