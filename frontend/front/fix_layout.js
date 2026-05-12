const fs = require('fs');
const content = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');

// Replace group coordinates/sizes
let updated = content
  .replace(/style: \{ width: 1400, height: 1150 \},/g, 'style: { width: 1040, height: 800 },')
  .replace(/position: \{ x: 50, y: 50 \},/g, 'position: { x: 30, y: 30 },') // g_strategy
  
  .replace(/position: \{ x: 40, y: 50 \},(\n\s*data: \{ label: "초기)/g, 'position: { x: 20, y: 50 },$1')
  .replace(/style: \{ width: 1320, height: 220 \},/g, 'style: { width: 980, height: 170 },')
  
  .replace(/position: \{ x: 40, y: 310 \},(\n\s*data: \{ label: "1시간)/g, 'position: { x: 20, y: 230 },$1')
  
  .replace(/position: \{ x: 40, y: 570 \},(\n\s*data: \{ label: "상시)/g, 'position: { x: 20, y: 410 },$1')
  
  .replace(/position: \{ x: 40, y: 830 \},(\n\s*data: \{ label: "수동)/g, 'position: { x: 20, y: 590 },$1')

// Replace node Internal X positions
updated = updated
  .replace(/position: \{ x: 300, y: 60 \},/g, 'position: { x: 240, y: 50 },')
  .replace(/position: \{ x: 300, y: 40 \},/g, 'position: { x: 240, y: 30 },')
  .replace(/position: \{ x: 650, y: 40 \},/g, 'position: { x: 500, y: 30 },')
  .replace(/position: \{ x: 950, y: 40 \},/g, 'position: { x: 740, y: 30 },')
  .replace(/position: \{ x: 20, y: 60 \},/g, 'position: { x: 20, y: 50 },')

fs.writeFileSync('components/node-editor/NodeEditor.tsx', updated);
console.log("Layout fixed!");
