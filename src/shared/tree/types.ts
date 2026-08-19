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
  collapsed: boolean;
  note: string | null;
}

export interface TreeState {
  nodes: Record<number, TabNode>;
  rootIds: number[];
}
