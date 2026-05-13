const fs = require('fs');
let layout = fs.readFileSync('components/node-editor/layout.ts', 'utf8');

// Restore to a safer size that definitively wraps text without excessive horizontal spacing.
layout = layout.replace(/const NODE_WIDTH = 220;/g, 'const NODE_WIDTH = 280;');
layout = layout.replace(/const NODE_HEIGHT = 80;/g, 'const NODE_HEIGHT = 120;');

// Make sure dagre's graph parameters are properly compact but not overlapping
layout = layout.replace(/ranksep: 20,\n      nodesep: 10,/g, 'ranksep: 30,\n      nodesep: 20,');

fs.writeFileSync('components/node-editor/layout.ts', layout);
console.log("Safe layout default node metrics restored.");
