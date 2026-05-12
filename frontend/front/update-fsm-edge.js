const fs = require('fs');

let fsmEdge = fs.readFileSync('components/node-editor/FSMEdge.tsx', 'utf8');

// Replace "if (!showFSMEdges) return null;" to handle the visibility dynamically
fsmEdge = fsmEdge.replace(/  if \(\!showFSMEdges\) return null;\n\n  const edgeData = data as FSMEdgeData \| undefined;\n  const color = edgeData\?\.color \?\? "#10b981";/g, `
  const edgeData = data as any;
  const isHighlighted = edgeData?.isHighlighted;
  const defaultColor = edgeData?.color ?? "#10b981";

  let color = defaultColor;
  let baseOpacity = 0.75;
  let strokeW = 2.5;

  if (isHighlighted) {
    color = "#3b82f6";
    baseOpacity = 1;
    strokeW = 3;
  } else if (!showFSMEdges) {
    color = "#cbd5e1";
    baseOpacity = 0.4;
    strokeW = 1.5;
  }
`);

// Support external style opacity override from NodeEditor's focusState
fsmEdge = fsmEdge.replace(
  /function FSMEdgeComponent\(\{([^}]+)\}\: EdgeProps\) \{/g,
  `function FSMEdgeComponent({\n$1,\n  style,\n}: EdgeProps) {`
);

// Update SVG paths and properties using new variables
fsmEdge = fsmEdge.replace(
  /<path d="M 0 0 L 10 5 L 0 10 z" fill=\{color\} opacity=\{0\.85\} \/>/g,
  `<path d="M 0 0 L 10 5 L 0 10 z" fill={color} opacity={isHighlighted ? 1 : baseOpacity} />`
);

fsmEdge = fsmEdge.replace(
  /<path\n        d=\{edgePath\}\n        stroke=\{color\}\n        strokeWidth=\{8\}\n        fill="none"\n        opacity=\{0\.08\}\n        style=\{\{ pointerEvents: "none" \}\}\n      \/>/g,
  `<path
        d={edgePath}
        stroke={color}
        strokeWidth={isHighlighted ? 8 : 6}
        fill="none"
        opacity={isHighlighted ? 0.3 : 0.05}
        style={{ pointerEvents: "none" }}
      />`
);

fsmEdge = fsmEdge.replace(
  /<path\n        id=\{id\}\n        d=\{edgePath\}\n        stroke=\{color\}\n        strokeWidth=\{2\.5\}\n        strokeDasharray="10 5"\n        fill="none"\n        opacity=\{0\.75\}\n        markerEnd=\{`url\(#\$\{markerId\}\)`\}\n        style=\{\{ pointerEvents: "none" \}\}\n      \/>/g,
  `<path
        id={id}
        d={edgePath}
        stroke={color}
        strokeWidth={strokeW}
        strokeDasharray={(!showFSMEdges && !isHighlighted) ? "none" : "10 5"}
        fill="none"
        opacity={(style?.opacity as number) ?? baseOpacity}
        markerEnd={\`url(#\${markerId})\`}
        style={{ pointerEvents: "none" }}
      />`
);

// If !showFSMEdges and !isHighlighted, maybe hide the label?
fsmEdge = fsmEdge.replace(
  /\{edgeData\?\.label && \(/g,
  `{edgeData?.label && (showFSMEdges || isHighlighted) && (`
);

fs.writeFileSync('components/node-editor/FSMEdge.tsx', fsmEdge);
console.log("FSMEdge updated for semi-transparent/highlighting.");
