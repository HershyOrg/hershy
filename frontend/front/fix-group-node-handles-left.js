const fs = require('fs');
let groupNode = fs.readFileSync('components/node-editor/GroupNode.tsx', 'utf8');

// Replace target to be Left, top 30%
groupNode = groupNode.replace(
  /type="target"\n            position=\{Position\.Left\}\n            id=\{`\$\{id\}-fsm-target`\}\n            className="!w-1 !h-1 !opacity-0 !bg-transparent !border-0"\n            style=\{\{ top: "30%" \}\}/g,
  'type="target"\n            position={Position.Left}\n            id={`${id}-fsm-target`}\n            className="!w-[3px] !h-[3px] !bg-[#10b981] !border-none !rounded-full"\n            style={{ top: "35%", left: -4 }}'
);

// Replace source to be Left, top 70%
groupNode = groupNode.replace(
  /type="source"\n            position=\{Position\.Right\}\n            id=\{`\$\{id\}-fsm-source`\}\n            className="!w-1 !h-1 !opacity-0 !bg-transparent !border-0"\n            style=\{\{ top: "30%" \}\}/g,
  'type="source"\n            position={Position.Left}\n            id={`${id}-fsm-source`}\n            className="!w-[3px] !h-[3px] !bg-[#10b981] !border-none !rounded-full"\n            style={{ top: "65%", left: -4 }}'
);

fs.writeFileSync('components/node-editor/GroupNode.tsx', groupNode);
console.log("Group handles fixed to LEFT.");
