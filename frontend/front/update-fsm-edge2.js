const fs = require('fs');

let fsmEdge = fs.readFileSync('components/node-editor/FSMEdge.tsx', 'utf8');

fsmEdge = fsmEdge.replace(/  data,\n,\n  style,/g, '  data,\n  style,');
fsmEdge = fsmEdge.replace(/const isHighlighted = edgeData\?\.isHighlighted;/g, 'const isHighlighted = edgeData?.isHighlighted;\n  const isDimmed = style?.opacity === 0.2;');

fsmEdge = fsmEdge.replace(/let color = defaultColor;/, `let color = defaultColor;
  if (!showFSMEdges) color = "#cbd5e1";
  if (isHighlighted) color = "#3b82f6";
  
  let baseOpacity = 0.75;
  if (!showFSMEdges) baseOpacity = 0.4;
  if (isHighlighted) baseOpacity = 1;
  if (isDimmed) baseOpacity = 0.1;
`);

fs.writeFileSync('components/node-editor/FSMEdge.tsx', fsmEdge);
console.log("Syntax fixed");
