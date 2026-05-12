const fs = require('fs');

let editor = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');

const regex = /    return result\.map\(\(node\) => \{\n      const isFocused = node\.id === focusState\.focusedNodeId \|\| node\.parentId === focusState\.focusedNodeId;/;

const replacement = `    // Find the currently focused node to know its parent
    const focusedNode = result.find(n => n.id === focusState.focusedNodeId);
    
    return result.map((node) => {
      const isFocused = 
        node.id === focusState.focusedNodeId || 
        node.parentId === focusState.focusedNodeId ||
        (focusedNode && node.id === focusedNode.parentId);`;

editor = editor.replace(regex, replacement);

fs.writeFileSync('components/node-editor/NodeEditor.tsx', editor);
console.log("Parent focus logic added.");
