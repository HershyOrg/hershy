const fs = require('fs');

let groupNode = fs.readFileSync('components/node-editor/GroupNode.tsx', 'utf8');

// Update handles to be on Right and Left sides maybe? Or keep them Top/Bottom but position them on the far left edge, and use smoothstep?
// Actually if they are Left/Left they will route out of the left side and around!
groupNode = groupNode.replace(/position=\{Position\.Top\}/, 'position={Position.Left}');
groupNode = groupNode.replace(/position=\{Position\.Bottom\}/, 'position={Position.Left}');
groupNode = groupNode.replace(/style=\{\{ left: 48 \}\}/g, 'style={{ top: 20 }}'); // Top target handle
// wait, we need distinct top mapping for source and target so they don't overlap exactly
