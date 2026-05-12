const fs = require('fs');

const content = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');

let updated = content;

// Resize Groups for Vertical Stacking
// Each group will be narrow and tall. e.g. width: 400, height: 750
// And we put the groups side-by-side, so they fit nicely horizontally, while their inner contents stack vertically.
updated = updated
  .replace(/style: \{ width: 1040, height: 800 \},/g, 'style: { width: 1450, height: 850 },') // g_strategy
  
  .replace(/position: \{ x: 20, y: 50 \},(\s*\n\s*data: \{ label: "초기)/g, 'position: { x: 30, y: 60 },$1')
  .replace(/style: \{ width: 980, height: 170 \},(\s*\n\s*},)/g, 'style: { width: 330, height: 750 },$1')
  
  .replace(/position: \{ x: 20, y: 230 \},(\s*\n\s*data: \{ label: "1시간)/g, 'position: { x: 380, y: 60 },$1')
  .replace(/style: \{ width: 980, height: 170 \},(\s*\n\s*},)/g, 'style: { width: 330, height: 750 },$1')
  
  .replace(/position: \{ x: 20, y: 410 \},(\s*\n\s*data: \{ label: "상시)/g, 'position: { x: 730, y: 60 },$1')
  .replace(/style: \{ width: 980, height: 170 \},(\s*\n\s*},)/g, 'style: { width: 330, height: 750 },$1')
  
  .replace(/position: \{ x: 20, y: 590 \},(\s*\n\s*data: \{ label: "수동)/g, 'position: { x: 1080, y: 60 },$1')
  .replace(/style: \{ width: 980, height: 170 \},(\s*\n\s*},)/g, 'style: { width: 330, height: 750 },$1')

// Re-position internal nodes to stack vertically
// Replace occurrences of specific internal coordinates with new vertical ones.
// Pattern: node 1 (x: 20 -> x: 40, y: 50), node 2 (x: 240 -> x: 40, y: 200), node 3 (x: 500 -> x: 40, y: 380), node 4 (x: 740 -> x: 40, y: 560)

updated = updated
  // Node 1
  .replace(/position: \{ x: 20, y: 50 \},/g, 'position: { x: 40, y: 50 },')
  // Node 2
  .replace(/position: \{ x: 240, y: 50 \},/g, 'position: { x: 40, y: 220 },')
  .replace(/position: \{ x: 240, y: 30 \},/g, 'position: { x: 40, y: 220 },') // n_em_execute
  // Node 3
  .replace(/position: \{ x: 500, y: 30 \},/g, 'position: { x: 40, y: 390 },')
  // Node 4
  .replace(/position: \{ x: 740, y: 30 \},/g, 'position: { x: 40, y: 560 },')

fs.writeFileSync('components/node-editor/NodeEditor.tsx', updated);
console.log("Vertical Layout fixed!");
