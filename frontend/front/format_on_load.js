const fs = require('fs');
let content = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');

// Find where initialNodes are passed to useNodesState
const hookMatch = content.indexOf('const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);');
if (hookMatch !== -1) {
  content = content.replace(
    'const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);',
    `const initialFormattedNodes = getLayoutedElements(initialNodes, initialEdges, "LR");\n  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialFormattedNodes);`
  );
  fs.writeFileSync('components/node-editor/NodeEditor.tsx', content);
  console.log("Applied format on load.");
} else {
  console.log("Hook not found.");
}
