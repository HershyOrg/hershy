const fs = require('fs');
const path = 'components/node-editor/NodeEditor.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  '        />\n      )}\n    </div>\n  );\n}',
  '        />\n      )}\n    </div>\n    </div>\n  );\n}'
);

fs.writeFileSync(path, content, 'utf8');
