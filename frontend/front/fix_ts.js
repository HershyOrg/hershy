const fs = require('fs');
let layoutContent = fs.readFileSync('components/node-editor/layout.ts', 'utf8');

layoutContent = layoutContent.replace(/const h = sg.style\?\.height \|\| GROUP_MIN_HEIGHT;/g, 'const h = (sg.style?.height as number) || GROUP_MIN_HEIGHT;');
layoutContent = layoutContent.replace(/const w = sg.style\?\.width \|\| PARENT_MIN_WIDTH;/g, 'const w = (sg.style?.width as number) || PARENT_MIN_WIDTH;');
layoutContent = layoutContent.replace(/Math.max\(gStrategy.style\?\.width \|\| 0, maxWidth \+ 80\)/g, 'Math.max((gStrategy.style?.width as number) || 0, maxWidth + 80)');

fs.writeFileSync('components/node-editor/layout.ts', layoutContent);
console.log("Types fixed.");
