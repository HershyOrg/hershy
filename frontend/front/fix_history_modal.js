const fs = require('fs');

const path = 'components/node-editor/StrategyHistoryModal.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Position import
content = content.replace(
  'import { ReactFlow, Background, Controls, Node, Edge, MarkerType } from "@xyflow/react";',
  'import { ReactFlow, Background, Controls, Node, Edge, MarkerType, Position } from "@xyflow/react";\nimport { X } from "lucide-react";\nimport { Button } from "@/components/ui/button";'
);

// 2. Add source/target positions and Preview rendering
const nodeReplacement = `
      treeNodes.push({
        id: snap.id,
        position: { x: lx, y: ly },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          label: (
            <div className={\`group relative p-4 rounded-xl border-2 transition-all duration-300 cursor-pointer \${isActive ? 'bg-indigo-50 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.4)]' : 'bg-white border-slate-200 hover:border-indigo-400'} active:opacity-50\`}
              onClick={() => {
                historyStore.setActiveId(snap.id);
                onClose();
              }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {snap.parentId ? <GitBranch className={\`w-4 h-4 \${isActive ? 'text-indigo-600' : 'text-slate-500'}\`} /> : <GitCommit className={\`w-4 h-4 \${isActive ? 'text-indigo-600' : 'text-slate-500'}\`} />}
                  <span className={\`font-bold text-sm \${isActive ? 'text-indigo-700' : 'text-slate-700'}\`}>{snap.name}</span>
                </div>
              </div>
              
              {/* Strategy Preview */}
              <div className={\`relative w-full h-[80px] bg-slate-100/50 rounded overflow-hidden border border-slate-200 transition-all duration-500 mb-3 \${isActive ? 'blur-0' : 'blur-[3px] group-hover:blur-0 group-hover:shadow-[0_0_20px_rgba(99,102,241,0.6)] group-hover:border-indigo-400'}\`}>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none transform scale-[0.6]">
                  <div className="relative" style={{ width: '200px', height: '100px' }}>
                    {snap.nodes.map((n: any, i: number) => (
                      <div 
                        key={i} 
                        className="absolute rounded bg-indigo-500/80 border border-indigo-700" 
                        style={{ 
                          left: (n.position?.x || 0) / 20 + 100, 
                          top: (n.position?.y || 0) / 20 + 50, 
                          width: Math.max((n.style?.width || n.measured?.width || 200) / 20, 8), 
                          height: Math.max((n.style?.height || n.measured?.height || 50) / 20, 8) 
                        }} 
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500 w-full gap-4">
                <div className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(snap.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">{snap.nodes.length} nodes</span>
              </div>
            </div>
          )
        },
        type: 'default',
        style: { width: 260, border: 'none', background: 'transparent', padding: 0 }
      });
`;

content = content.replace(/treeNodes\.push\(\{[^]*?\}\);/, nodeReplacement.trim());

// 3. Header Close Button
content = content.replace(
  '<DialogTitle className="flex items-center gap-2 text-xl">',
  `<div className="flex items-center justify-between w-full">
            <DialogTitle className="flex items-center gap-2 text-xl">`
);

content = content.replace(
  '<DialogDescription>',
  `</DialogTitle>
            <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full z-20 hover:bg-slate-100" onClick={(e) => { e.stopPropagation(); onClose(); }}>
              <X className="w-5 h-5 text-slate-600" />
            </Button>
          </div>
          <DialogDescription>`
);

fs.writeFileSync(path, content, 'utf8');
console.log("Updated Modal successfully");
