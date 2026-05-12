const fs = require('fs');

let fsmEdge = fs.readFileSync('components/node-editor/FSMEdge.tsx', 'utf8');

// Fix redeclared baseOpacity
fsmEdge = fsmEdge.replace(
  `  let baseOpacity = 0.75;
  if (!showFSMEdges) baseOpacity = 0.4;
  if (isHighlighted) baseOpacity = 1;
  if (isDimmed) baseOpacity = 0.1;

  let strokeW = 2.5;

  if (isHighlighted) {
    color = "#3b82f6";
    baseOpacity = 1;
    strokeW = 3;
  } else if (!showFSMEdges) {
    color = "#cbd5e1";
    baseOpacity = 0.4;
    strokeW = 1.5;
  }`, 
  `  let strokeW = 2.5;
  if (isHighlighted) strokeW = 3;
  else if (!showFSMEdges) strokeW = 1.5;
`);

fs.writeFileSync('components/node-editor/FSMEdge.tsx', fsmEdge);
console.log("Deleted duplicate baseOpacity declaration.");
