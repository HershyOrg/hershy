const fs = require('fs');

let editor = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');

const regex = /      const isFocused = \n        node\.id === focusState\.focusedNodeId \|\|\n        node\.parentId === focusState\.focusedNodeId \|\|\n        \(focusedNode && node\.id === focusedNode\.parentId\);/g;

const replacement = `      const isFocused = node.id === focusState.focusedNodeId;`;

editor = editor.replace(regex, replacement);

fs.writeFileSync('components/node-editor/NodeEditor.tsx', editor);
console.log("Reverted focus logic to exact node only.");
