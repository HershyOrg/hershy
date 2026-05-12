const fs = require('fs');
let layoutContent = fs.readFileSync('components/node-editor/layout.ts', 'utf8');

if (!layoutContent.includes('// Step 5: Stack groups vertically')) {
  layoutContent = layoutContent.replace(/return { nodes: processedNodes, edges };/g, `
  // Step 5: Stack groups vertically inside their parent (e.g. g_strategy)
  // Identify root-level groups (or groups with parent 'g_strategy') and stack them
  const strategyGroups = processedNodes.filter(n => n.parentId === 'g_strategy').sort((a, b) => a.position.y - b.position.y);
  let currentY = 50; // paddingTop for the first inside g_strategy
  const groupGap = 20; // Vertical gap between scenario groups
  let maxWidth = 0;

  for (const sg of strategyGroups) {
    sg.position.y = currentY;
    const h = sg.style?.height || GROUP_MIN_HEIGHT;
    const w = sg.style?.width || PARENT_MIN_WIDTH;
    if (w > maxWidth) maxWidth = w;
    currentY += h + groupGap;
  }

  // Also update g_strategy height and width based on stacked children
  const gStrategy = processedNodes.find(n => n.id === 'g_strategy');
  if (gStrategy) {
    gStrategy.style = {
      ...gStrategy.style,
      height: currentY + 30, // some padding bottom
      width: Math.max(gStrategy.style?.width || 0, maxWidth + 80), // padding right
    };
  }

  return { nodes: processedNodes, edges };
`);
  fs.writeFileSync('components/node-editor/layout.ts', layoutContent);
  console.log("Group stacking applied!");
} else {
  console.log("Already applied!");
}
