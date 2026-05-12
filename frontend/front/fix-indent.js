const fs = require('fs');

let layout = fs.readFileSync('components/node-editor/layout.ts', 'utf8');

const regex = /    let currentY = 50;\n    let maxWidth = 0;\n    const groupGap = 20;\n\n    for \(const sg of strategyGroups\) \{\n      sg\.position\.x = 40;\n      sg\.position\.y = currentY;\n      const h = \(sg\.style\?\.height as number\) \|\| 160;\n      const w = \(sg\.style\?\.width as number\) \|\| 300;\n      if \(w > maxWidth\) maxWidth = w;\n      currentY \+= h \+ groupGap;\n    \}/;

const replacement = `    let currentY = 50;
    let maxWidth = 0;
    const groupGap = 20;

    // Indentation depth for each sequence to look like programming tabs
    const indentMap: Record<string, number> = {
      "g_init": 0,
      "g_trigger1": 1,
      "g_trigger2": 1,
      "g_emergency": 2
    };

    for (const sg of strategyGroups) {
      const depth = indentMap[sg.id] || 0;
      sg.position.x = 40 + depth * 120; // 120px tab indent gap
      sg.position.y = currentY;
      const h = (sg.style?.height as number) || 160;
      const w = (sg.style?.width as number) || 300;
      
      const spaceRequired = sg.position.x + w;
      if (spaceRequired > maxWidth) maxWidth = spaceRequired;
      
      currentY += h + groupGap;
    }`;

layout = layout.replace(regex, replacement);

// Also fix the gStrategy padding logic to account for the new maxWidth calculation.
// Previously maxWidth was just width, and padding was added as `maxWidth + 80`. 
// Now maxWidth incorporates `position.x`, so we just need a smaller right padding.

layout = layout.replace(
  /width: Math.max\(\(gStrategy\.style\?\.width as number\) \|\| 0, maxWidth \+ 80\),/,
  'width: Math.max((gStrategy.style?.width as number) || 0, maxWidth + 60),'
);

fs.writeFileSync('components/node-editor/layout.ts', layout);
console.log("Indentation logic applied.");
