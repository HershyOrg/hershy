const fs = require('fs');

const path = 'components/node-editor/StrategyHistoryModal.tsx';
let content = fs.readFileSync(path, 'utf8');

const returnStatement = `  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#0d1117]">`;

const returnReplacement = `  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#0d1117]">
      {/* Top action bar */}`;

let plusBtn = `
      <div className="absolute top-4 left-4 z-50 flex gap-2">
        <Button 
          variant="outline" 
          size="sm"
          className="bg-[#1e1e1e] border-[#30363d] text-[#c9d1d9] hover:bg-[#30363d] hover:text-white"
          onClick={() => {
            const newSnap = {
              id: \`snapshot-\${Date.now()}\`,
              name: \`새 전략 탬플릿-\${Math.floor(Math.random()*1000)}\`,
              parentId: null,
              nodes: [],
              edges: [],
              timestamp: Date.now()
            };
            historyStore.snapshots.push(newSnap);
            historyStore.openTab(newSnap.id);
            setIsOpen(false);
          }}
        >
          <Sparkles className="w-4 h-4 mr-2" /> 새 탬플릿 만들기
        </Button>
      </div>
`;
content = content.replace(returnStatement, returnReplacement + plusBtn);
fs.writeFileSync(path, content, 'utf8');
