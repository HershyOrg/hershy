const fs = require('fs');
const content = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');
if (content.includes('positionAbsolute')) {
  console.log("Yes, positionAbsolute is used.");
} else {
  console.log("No positionAbsolute in NodeEditor");
}
