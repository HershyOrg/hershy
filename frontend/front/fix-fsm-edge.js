const fs = require('fs');

let fsmEdge = fs.readFileSync('components/node-editor/FSMEdge.tsx', 'utf8');

fsmEdge = fsmEdge.replace(/getBezierPath/g, 'getSmoothStepPath');
fsmEdge = fsmEdge.replace(/getSmoothStepPath\(/g, 'getSmoothStepPath({ borderRadius: 20, offset: 40, ');

fs.writeFileSync('components/node-editor/FSMEdge.tsx', fsmEdge);
console.log("FSMEdge updated to smoothstep.");
