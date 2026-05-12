const fs = require('fs');

// 1. Update layout.ts for tighter padding and node/rank separation
let layoutContent = fs.readFileSync('components/node-editor/layout.ts', 'utf8');
layoutContent = layoutContent.replace(/ranksep: 80,/g, 'ranksep: 40,');
layoutContent = layoutContent.replace(/nodesep: 50,/g, 'nodesep: 20,');
layoutContent = layoutContent.replace(/const GROUP_MIN_HEIGHT = 200;/g, 'const GROUP_MIN_HEIGHT = 160;');
layoutContent = layoutContent.replace(/const paddingLeft = 40;/g, 'const paddingLeft = 30;');
layoutContent = layoutContent.replace(/const paddingTop = 80;/g, 'const paddingTop = 50;');
layoutContent = layoutContent.replace(/const paddingRight = 40;/g, 'const paddingRight = 30;');
layoutContent = layoutContent.replace(/const paddingBottom = 40;/g, 'const paddingBottom = 20;');
fs.writeFileSync('components/node-editor/layout.ts', layoutContent);

// 2. Update NodeEditor.tsx group positions to be tightly stacked
let editorContent = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');

// The groups have initial positions like y: 50, 310, 570, 830. 
// Let's make them y: 50, 230, 410, 590 or even tighter.
editorContent = editorContent
  .replace(/position: \{ x: 40, y: 310 \},/g, 'position: { x: 40, y: 220 },')
  .replace(/position: \{ x: 40, y: 570 \},/g, 'position: { x: 40, y: 390 },')
  .replace(/position: \{ x: 40, y: 830 \},/g, 'position: { x: 40, y: 560 },')
  // Reduce g_strategy container size
  .replace(/style: \{ width: 1400, height: 1150 \}/g, 'style: { width: 1200, height: 750 }');

fs.writeFileSync('components/node-editor/NodeEditor.tsx', editorContent);
console.log("Layout compacted!");
