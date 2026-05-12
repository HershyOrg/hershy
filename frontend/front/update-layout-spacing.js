const fs = require('fs');

let layout = fs.readFileSync('components/node-editor/layout.ts', 'utf8');

layout = layout.replace(
  /ranksep: 40,\n      nodesep: 20,/g,
  'ranksep: 20,\n      nodesep: 10,'
);

fs.writeFileSync('components/node-editor/layout.ts', layout);
console.log("Layout spacing halved.");
