const fs = require('fs');

let fsmEdge = fs.readFileSync('components/node-editor/FSMEdge.tsx', 'utf8');

fsmEdge = fsmEdge.replace(/borderRadius: 20/g, 'borderRadius: 40');

fs.writeFileSync('components/node-editor/FSMEdge.tsx', fsmEdge);
console.log("FSMEdge radius increased.");
