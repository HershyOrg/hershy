const fs = require('fs');

let editor = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');

const target = `    const focusedNode = result.find(n => n.id === focusState.focusedNodeId);
    
    return result.map((node) => {
      const isFocused = 
        node.id === focusState.focusedNodeId || 
        node.parentId === focusState.focusedNodeId ||
        (focusedNode && node.id === focusedNode.parentId);`;

const replacement = `    const focusedNode = result.find(n => n.id === focusState.focusedNodeId);
    
    return result.map((node) => {
      const isFocused = node.id === focusState.focusedNodeId;`;

editor = editor.replace(target, replacement);

fs.writeFileSync('components/node-editor/NodeEditor.tsx', editor);
console.log("Exact targeting fixed.");
