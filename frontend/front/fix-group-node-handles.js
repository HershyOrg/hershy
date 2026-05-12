const fs = require('fs');
let groupNode = fs.readFileSync('components/node-editor/GroupNode.tsx', 'utf8');

// Change position={Position.Top} to position={Position.Left} and remove left: 48, add top: 20
groupNode = groupNode.replace(
  /type="target"\s+position=\{Position\.Top\}\s+id=\{`\$\{id\}-fsm-target`\}\s+className="!w-1 !h-1 !opacity-0 !bg-transparent !border-0"\s+style=\{\{ left: 48 \}\}/g,
  'type="target"\n            position={Position.Left}\n            id={`${id}-fsm-target`}\n            className="!w-1 !h-1 !opacity-0 !bg-transparent !border-0"\n            style={{ top: "30%" }}'
);

groupNode = groupNode.replace(
  /type="source"\s+position=\{Position\.Bottom\}\s+id=\{`\$\{id\}-fsm-source`\}\s+className="!w-1 !h-1 !opacity-0 !bg-transparent !border-0"\s+style=\{\{ left: 48 \}\}/g,
  'type="source"\n            position={Position.Right}\n            id={`${id}-fsm-source`}\n            className="!w-1 !h-1 !opacity-0 !bg-transparent !border-0"\n            style={{ top: "30%" }}'
);

fs.writeFileSync('components/node-editor/GroupNode.tsx', groupNode);
console.log("Group handles fixed.");
