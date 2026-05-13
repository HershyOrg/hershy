const fs = require('fs');
let content = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');

content = content.replace(
  'const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);',
  `const [nodes, setNodes, onNodesChange] = useNodesState(getLayoutedElements(initialNodes as any, initialEdges as any, "LR"));`
);
fs.writeFileSync('components/node-editor/NodeEditor.tsx', content);
console.log("Applied format on load 2.");
