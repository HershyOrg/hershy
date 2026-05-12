const fs = require('fs');

let layout = fs.readFileSync('components/node-editor/layout.ts', 'utf8');

const regex = /      if \(\!w\) w = node\.type === "groupNode" \? GROUP_MIN_WIDTH : NODE_WIDTH;\n      if \(\!h\) h = node\.type === "groupNode" \? GROUP_MIN_HEIGHT : NODE_HEIGHT;/g;

const replacement = `      if (!w || !h) {
        if (node.type === "groupNode") {
          w = w || GROUP_MIN_WIDTH;
          h = h || GROUP_MIN_HEIGHT;
        } else {
          switch (node.type) {
            case "actionNode": w = w || 220; h = h || 80; break;
            case "functionNode": w = w || 250; h = h || 80; break;
            case "branchNode": w = w || 420; h = h || 150; break;
            case "timelineFrame": w = w || 520; h = h || 350; break;
            case "clickTrigger": w = w || 200; h = h || 60; break;
            case "timeTrigger": w = w || 200; h = h || 60; break;
            default: w = w || NODE_WIDTH; h = h || NODE_HEIGHT; break;
          }
        }
      }`;

layout = layout.replace(regex, replacement);

fs.writeFileSync('components/node-editor/layout.ts', layout);
console.log("Layout fallbacks updated with type-specific sizes.");
