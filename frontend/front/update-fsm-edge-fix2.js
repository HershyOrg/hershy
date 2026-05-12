const fs = require('fs');

let fsmEdge = fs.readFileSync('components/node-editor/FSMEdge.tsx', 'utf8');

fsmEdge = fsmEdge.replace(/let baseOpacity = 0\.75;\n  let strokeW = 2\.5;\n\n  if \(isHighlighted\) \{/g, `
  let strokeW = 2.5;

  if (isHighlighted) {`);

fs.writeFileSync('components/node-editor/FSMEdge.tsx', fsmEdge);
console.log("Deleted other duplicate");
