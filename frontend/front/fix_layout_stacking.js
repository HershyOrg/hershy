const fs = require('fs');
const content = fs.readFileSync('components/node-editor/layout.ts', 'utf8');

const anchor = `  return newNodes;
}`;

const replacement = `
  // FORCE Top-to-Bottom stacking for sequences inside g_strategy
  const strategyGroups = newNodes.filter(n => n.parentId === 'g_strategy');
  if (strategyGroups.length > 0) {
    // Use manual sorting order or fallback to their original Y position
    const order = ["g_init", "g_trigger1", "g_trigger2", "g_emergency"];
    strategyGroups.sort((a, b) => {
      const idxA = order.indexOf(a.id);
      const idxB = order.indexOf(b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      return a.position.y - b.position.y;
    });

    let currentY = 50;
    let maxWidth = 0;
    const groupGap = 20;

    for (const sg of strategyGroups) {
      sg.position.x = 40;
      sg.position.y = currentY;
      const h = (sg.style?.height as number) || 160;
      const w = (sg.style?.width as number) || 300;
      if (w > maxWidth) maxWidth = w;
      currentY += h + groupGap;
    }

    const gStrategy = newNodes.find(n => n.id === 'g_strategy');
    if (gStrategy) {
      gStrategy.style = {
        ...gStrategy.style,
        width: Math.max((gStrategy.style?.width as number) || 0, maxWidth + 80),
        height: currentY + 30,
      };
    }
  }

  return newNodes;
}`;

const newContent = content.replace(anchor, replacement);
fs.writeFileSync('components/node-editor/layout.ts', newContent);
console.log("Stacking applied at bottom of layout.ts");
