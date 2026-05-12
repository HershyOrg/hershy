const fs = require('fs');

let fsmEdge = fs.readFileSync('components/node-editor/FSMEdge.tsx', 'utf8');

fsmEdge = fsmEdge.replace(/borderRadius: 40, offset: 40/g, 'borderRadius: 30, offset: 60');

fs.writeFileSync('components/node-editor/FSMEdge.tsx', fsmEdge);
console.log("FSMEdge routing spread out.");
