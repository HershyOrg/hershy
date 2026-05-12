const fs = require('fs');

let editor = fs.readFileSync('components/node-editor/NodeEditor.tsx', 'utf8');

const regex = /      if \(isFocused\) \{\n        return \{\n          \.\.\.node,\n          className: cn\(node\.className, "z-50 relative"\),\n          style: \{ \.\.\.node\.style, filter: "none", opacity: 1 \},\n        \};\n      \}\n\n      if \(isConnected\) \{\n        return \{\n          \.\.\.node,\n          className: cn\(node\.className, "z-40 relative"\),\n          style: \{ \.\.\.node\.style, filter: "drop-shadow\\(0 0 12px rgba\\(59, 130, 246, 0\.8\\)\\)", opacity: 1 \},\n        \};\n      \}/g;

const replacement = `      if (isFocused) {
        return {
          ...node,
          className: cn(node.className, "z-50 relative"),
          style: { ...node.style, filter: "drop-shadow(0 0 12px rgba(59, 130, 246, 0.8))", opacity: 1 },
        };
      }`;

editor = editor.replace(regex, replacement);

fs.writeFileSync('components/node-editor/NodeEditor.tsx', editor);
console.log("Focused node CSS updated successfully.");
