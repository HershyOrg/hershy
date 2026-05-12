function test() {
  const nodes = [
    { id: "root", position: { x: 50, y: 50 } },
    { id: "g1", parentNode: "root", position: { x: 40, y: 50 } },
    { id: "node1", position: { x: 150, y: 150 } }, // Absolute 150, 150
  ];
  
  const getNodes = () => nodes;
  
  const getAbsolutePosition = (nId) => {
    let x = 0;
    let y = 0;
    let current = nId ? getNodes().find(n => n.id === nId) : null;
    while (current) {
      x += current.position.x;
      y += current.position.y;
      current = current.parentNode ? getNodes().find(n => n.id === current.parentNode) : null;
    }
    return { x, y };
  };

  const drgAbs = getAbsolutePosition("node1");
  const tgtAbs = getAbsolutePosition("g1");

  console.log("dragged abs:", drgAbs);
  console.log("target abs:", tgtAbs);

  const newX = drgAbs.x - tgtAbs.x;
  const newY = drgAbs.y - tgtAbs.y;
  
  console.log("new rel:", newX, newY);
  
  // if parented, new absolute is:
  const checkX = tgtAbs.x + newX;
  const checkY = tgtAbs.y + newY;
  console.log("check abs:", checkX, checkY);
}
test();
