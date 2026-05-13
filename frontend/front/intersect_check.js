const nodes = [
  { id: "g_strategy", type: "groupNode", position: { x: 50, y: 50 } },
  { id: "g_init", type: "groupNode", parentNode: "g_strategy", position: { x: 40, y: 50 } },
  { id: "node1", position: { x: 150, y: 150 } },
];

const getAbsolutePosition = (node, allNodes) => {
  let x = node.position.x;
  let y = node.position.y;
  let currentId = node.parentNode;
  
  while (currentId) {
    const parent = allNodes.find(n => n.id === currentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    currentId = parent.parentNode;
  }
  return { x, y };
};

const draggedAbs = getAbsolutePosition(nodes[2], nodes);
const targetAbs = getAbsolutePosition(nodes[1], nodes);

console.log("dragged abs:", draggedAbs);
console.log("target abs:", targetAbs);
console.log("new x:", draggedAbs.x - targetAbs.x, "new y:", draggedAbs.y - targetAbs.y);
