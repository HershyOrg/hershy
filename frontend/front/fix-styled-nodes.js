const fs = require('fs');

let editor = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');

const oldRegex = /    return result\.map\(\(node\) => \{\n      const isFocused = node\.id === focusState\.focusedNodeId;\n      const isConnected = focusState\.connectedNodeIds\.includes\(node\.id\);/;

const replacement = `    return result.map((node) => {
      const isFocused = node.id === focusState.focusedNodeId || node.parentId === focusState.focusedNodeId;
      const isConnected = focusState.connectedNodeIds.includes(node.id);`;

editor = editor.replace(oldRegex, replacement);

fs.writeFileSync('components/node-editor/NodeEditor.tsx', editor);
console.log("Styled nodes logic updated to include children in focus.");
