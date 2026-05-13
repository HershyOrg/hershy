const fs = require('fs');
let layoutContent = fs.readFileSync('components/node-editor/layout.ts', 'utf8');

// The line is: rankdir: direction,
// We want to change it so that if parentId === "g_strategy", rankdir is "TB".
layoutContent = layoutContent.replace(
  /rankdir: direction,/g,
  'rankdir: parentId === "g_strategy" ? "TB" : direction,'
);

fs.writeFileSync('components/node-editor/layout.ts', layoutContent);
console.log("Layout rankdir fixed.");
