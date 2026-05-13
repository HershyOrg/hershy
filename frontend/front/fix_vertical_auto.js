const fs = require('fs');

const content = fs.readFileSync('components/node-editor/layout.ts', 'utf8');

// Change default auto layout to TB instead of LR
let updated = content.replace(/direction = "LR"/g, 'direction = "TB"');

fs.writeFileSync('components/node-editor/layout.ts', updated);

const editorContent = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');
let updatedEditor = editorContent.replace(/getLayoutedElements\(nodes, edges, "LR"\)/g, 'getLayoutedElements(nodes, edges, "TB")');
fs.writeFileSync('components/node-editor/NodeEditor.tsx', updatedEditor);

console.log("Updated to TB Layout");
