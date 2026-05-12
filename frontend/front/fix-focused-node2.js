const fs = require('fs');

let editor = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');

const target = `      if (isFocused) {
        return {
          ...node,
          className: cn(node.className, "z-50 relative"),
          style: { ...node.style, filter: "none", opacity: 1 },
        };
      }

      if (isConnected) {
        return {
          ...node,
          className: cn(node.className, "z-40 relative"),
          style: { ...node.style, filter: "drop-shadow(0 0 12px rgba(59, 130, 246, 0.8))", opacity: 1 },
        };
      }`;

const replacement = `      if (isFocused) {
        return {
          ...node,
          className: cn(node.className, "z-50 relative"),
          style: { ...node.style, filter: "drop-shadow(0 0 12px rgba(59, 130, 246, 0.8))", opacity: 1 },
        };
      }

      if (isConnected) {
        return {
          ...node,
          className: cn(node.className, "z-40 relative"),
          style: { ...node.style, filter: "none", opacity: 1 },
        };
      }`;

editor = editor.replace(target, replacement);

fs.writeFileSync('components/node-editor/NodeEditor.tsx', editor);
console.log("Replaced using pure string match.");
