const fs = require('fs');
let layout = fs.readFileSync('components/node-editor/layout.ts', 'utf8');

// Increase right padding to safely catch any unexpectedly long text nodes
layout = layout.replace(/const paddingRight = 30;/g, 'const paddingRight = 50;');

// Also make NODE_WIDTH 300 to be absolutely safe for long title nodes.
layout = layout.replace(/const NODE_WIDTH = 280;/g, 'const NODE_WIDTH = 300;');

fs.writeFileSync('components/node-editor/layout.ts', layout);
console.log("Node widths and padding adjusted to be safe.");
