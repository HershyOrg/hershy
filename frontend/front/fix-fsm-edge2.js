const fs = require('fs');

let fsmEdge = fs.readFileSync('components/node-editor/FSMEdge.tsx', 'utf8');

fsmEdge = fsmEdge.replace(/getSmoothStepPath\(\{ borderRadius: 20, offset: 40, \{/g, 'getSmoothStepPath({ borderRadius: 20, offset: 40, ');

fs.writeFileSync('components/node-editor/FSMEdge.tsx', fsmEdge);
console.log("FSMEdge typo fixed.");
