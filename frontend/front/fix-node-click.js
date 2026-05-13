const fs = require('fs');

let editor = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');

// 1. Update the destructuring of useFSM to include currentState
editor = editor.replace(
  'const { showFSMEdges, isAvailable } = useFSM();',
  'const { showFSMEdges, isAvailable, currentState } = useFSM();'
);

// 2. Refactor styledEdges to account for FSM executing state AND focusState
const styledEdgesRegex = /  const styledEdges = useMemo\(\(\) => \{\n    if \(\!focusState\.isActive\) return edges;\n\n    return edges\.map\(\(edge\) => \{\n      const isConnected = focusState\.connectedEdgeIds\.includes\(edge\.id\);\n\n      if \(isConnected\) \{\n        return \{\n          \.\.\.edge,\n          style: \{\n            \.\.\.edge\.style,\n            stroke: "#3b82f6",\n            strokeWidth: 3,\n            filter: "drop-shadow\(0 0 6px rgba\(59, 130, 246, 0\.8\)\)",\n          \},\n          animated: true,\n          data: \{ \.\.\.edge\.data, isHighlighted: true \},\n        \};\n      \}\n\n      return \{\n        \.\.\.edge,\n        style: \{\n          \.\.\.edge\.style,\n          stroke: "#9ca3af",\n          strokeWidth: 1,\n          opacity: 0\.2,\n        \},\n        data: \{ \.\.\.edge\.data, isHighlighted: false \},\n      \};\n    \}\);\n  \}, \[edges, focusState\]\);/;

const styledEdgesReplacement = `  const styledEdges = useMemo(() => {
    let executingEdgeIds = new Set<string>();
    let hasFsmActive = false;

    if (showFSMEdges) {
      const executingGroupIds = new Set<string>();
      nodes.forEach(n => {
        if (n.type === 'groupNode' && n.data?.executingStates?.includes(currentState)) {
          executingGroupIds.add(n.id);
        }
      });
      edges.forEach(edge => {
        // 현재 발동중인 노드가 시작점으로 연결된 간선
        if (executingGroupIds.has(edge.source)) {
          executingEdgeIds.add(edge.id);
        }
      });
      hasFsmActive = executingEdgeIds.size > 0;
    }

    if (!focusState.isActive && !hasFsmActive) return edges;

    return edges.map((edge) => {
      let isConnected = false;
      
      if (showFSMEdges) {
        isConnected = executingEdgeIds.has(edge.id);
      }
      
      // Also highlight if click focused regardless of FSM state
      if (!isConnected && focusState.isActive) {
        isConnected = focusState.connectedEdgeIds.includes(edge.id);
      }

      if (isConnected) {
        return {
          ...edge,
          style: {
            ...edge.style,
            stroke: "#3b82f6",
            strokeWidth: 3,
            filter: "drop-shadow(0 0 6px rgba(59, 130, 246, 0.8))",
          },
          animated: true,
          data: { ...edge.data, isHighlighted: true },
        };
      }

      return {
        ...edge,
        style: {
          ...edge.style,
          stroke: "#9ca3af",
          strokeWidth: 1,
          opacity: 0.2,
        },
        data: { ...edge.data, isHighlighted: false },
      };
    });
  }, [edges, focusState, showFSMEdges, currentState, nodes]);`;

editor = editor.replace(styledEdgesRegex, styledEdgesReplacement);

// 3. Add onNodeClick to handleNodeClick
const onNodeClickLogic = `  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      window.dispatchEvent(
        new CustomEvent("nodeFocus", { detail: { nodeId: node.id } })
      );
    },
    []
  );

  const handlePaneClick = useCallback(() => {
    setContextMenu(null);
    window.dispatchEvent(
      new CustomEvent("nodeFocus", { detail: { nodeId: null } })
    );
  }, []);`;

// Insert it somewhere around handleNodeDrag
editor = editor.replace(
  '  const handleNodeDrag = useCallback(',
  onNodeClickLogic + '\n\n  const handleNodeDrag = useCallback('
);

// 4. Update the ReactFlow component to use these events
editor = editor.replace(
  '        onPaneClick={() => setContextMenu(null)}',
  '        onPaneClick={handlePaneClick}\n        onNodeClick={handleNodeClick}'
);

fs.writeFileSync('components/node-editor/NodeEditor.tsx', editor);
console.log("Edge styling, FSM active edge logic, and onNodeClick added.");
