const fs = require('fs');

let editor = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');

// Replace the dimming logic at the end of the styledNodes map function
const dimmingRegex = /      return \{\n        \.\.\.node,\n        className: cn\(node\.className, "z-10"\),\n        style: \{ \.\.\.node\.style, filter: "brightness\(0\.4\)", opacity: 0\.5 \},\n      \};/g;

const dimmingReplacement = `      return {
        ...node,
        className: cn(node.className, "z-10"),
        style: { ...node.style }, // Do not dim unselected nodes
      };`;

editor = editor.replace(dimmingRegex, dimmingReplacement);

fs.writeFileSync('components/node-editor/NodeEditor.tsx', editor);
console.log("Removed rest node dimming.");
