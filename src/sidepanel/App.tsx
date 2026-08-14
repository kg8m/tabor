import { TreeView } from "./components/TreeView";
import { useWindowTree } from "./hooks/useWindowTree";

export function App() {
  const tree = useWindowTree();
  return <TreeView tree={tree} />;
}
