const fs = require('fs');

let page = fs.readFileSync('app/page.tsx', 'utf8');

// Ensure TabsContent acts as a proper flex container 
page = page.replace(
  /<TabsContent value="editor" className="flex-1 m-0 min-h-0 relative overflow-hidden data-\[state=inactive\]:hidden">/g,
  '<TabsContent value="editor" className="flex flex-col flex-1 min-h-0 relative overflow-hidden data-[state=inactive]:hidden">'
);
page = page.replace(
  /<TabsContent value="dashboard" className="flex-1 m-0 h-full p-6 overflow-hidden data-\[state=inactive\]:hidden">/g,
  '<TabsContent value="dashboard" className="flex flex-col flex-1 p-6 min-h-0 relative overflow-hidden data-[state=inactive]:hidden">'
);

fs.writeFileSync('app/page.tsx', page);
console.log("page.tsx TabsContent flex containers fixed.");
