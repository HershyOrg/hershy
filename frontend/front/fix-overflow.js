const fs = require('fs');

let page = fs.readFileSync('app/page.tsx', 'utf8');
// remove h-full on flex-1 children as flex-1 already handles the height to fill the remaining space correctly without breaking bounds.
page = page.replace(/className="flex-1 m-0 h-full overflow-hidden/g, 'className="flex-1 m-0 min-h-0 relative overflow-hidden');

fs.writeFileSync('app/page.tsx', page);
console.log("app/page.tsx fixed.");

let editor = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');
editor = editor.replace(/className="w-full h-full bg-gray-100 relative"/g, 'className="w-full h-full bg-gray-100 relative overflow-hidden"');
fs.writeFileSync('components/node-editor/NodeEditor.tsx', editor);
console.log("NodeEditor.tsx fixed.");
