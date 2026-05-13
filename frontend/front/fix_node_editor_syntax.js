const fs = require('fs');
const path = 'components/node-editor/NodeEditor.tsx';
let content = fs.readFileSync(path, 'utf8');

// I replaced \`        onRestore={handleRestore}\n      \/\>\n    \<\/div\>\n  \);\n\}\` with \`     />\n    </div>\n    </div>\n  );\n}\`
// wait, the problem is:
// JSX element 'div' has no corresponding closing tag.
// Meaning I have one more opening div than closing div.
// Original was:
// return (
//   <div className="...">
//     <ReactFlow ... />
//   </div>
// );

// I replaced <div className="..."> with:
//   return (
//     <div className="flex flex-col w-full h-full bg-[#1e1e1e] relative overflow-hidden">
//       <div className="...">Tabs</div>
//       <div className="...">

// Notice I added <div flex flex-col> as a top-level wrapper, and then <div className="...">
// So there are TWO nested divs now. I need TWO closing divs.
// The replacement I used earlier:
// content.replace(
//  /        onRestore={handleRestore}\n      \/\>\n    \<\/div\>\n  \);\n\}/,
//  \`        onRestore={handleRestore}\n      />\n    </div>\n    </div>\n  );\n}\`
// )

// But maybe `onRestore` part wasn't matched properly because of the regex.
content = content.replace(
  '        onRestore={handleRestore}\n      />\n    </div>\n  );\n}',
  '        onRestore={handleRestore}\n      />\n    </div>\n    </div>\n  );\n}'
);

fs.writeFileSync(path, content, 'utf8');
