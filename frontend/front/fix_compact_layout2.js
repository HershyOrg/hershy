const fs = require('fs');

let editorContent = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');

// The groups have style: { width: 1320, height: 220 }
// Let's make it { width: 1100, height: 160 } to be more compact horizontally and vertically
editorContent = editorContent
  .replace(/style: \{ width: 1320, height: 220 \}/g, 'style: { width: 1100, height: 160 }')
  .replace(/position: \{ x: 40, y: 50 \},/g, 'position: { x: 40, y: 50 },') // g_init
  .replace(/position: \{ x: 40, y: 220 \},/g, 'position: { x: 40, y: 220 },') // This was set before, update to 220
  .replace(/position: \{ x: 40, y: 390 \},/g, 'position: { x: 40, y: 390 },') // Update to 390
  .replace(/position: \{ x: 40, y: 560 \},/g, 'position: { x: 40, y: 560 },') // Update to 560
  
  // Actually, wait! The regex didn't replace position because I already replaced it in the first script!
  // In the first script: 
  //   310 -> 220
  //   570 -> 390
  //   830 -> 560
  // So the existing positions are indeed 50, 220, 390, 560.
  // The gap between 50 and 220 is 170.
  // With height 160, gap is 10. Perfect!
  
fs.writeFileSync('components/node-editor/NodeEditor.tsx', editorContent);
console.log("Layout compacted 2!");
