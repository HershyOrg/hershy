const fs = require('fs');

const path = 'components/node-editor/NodeEditor.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add Ctrl+S and Tabs State mapping
const useEffectImportMatch = 'import { useCallback, useEffect, useMemo, useRef, useState } from "react";';
if(!content.includes('import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";')) {
    content = content.replace(
        useEffectImportMatch,
        'import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";'
    );
}

// 2. Wrap layout to include tabs 
const returnedHtml = `  return (
    <div className="flex flex-col w-full h-full bg-[#1e1e1e] relative overflow-hidden">
      {/* VS Code like Editor Tabs */}
      <div className="flex shrink-0 h-9 w-full bg-[#1e1e1e] overflow-x-auto select-none border-b border-[#333333]">
        {/* We find snapshots for currently open tabs */}
        {historyStore.getOpenTabs().map(tabId => {
          const snap = historyStore.getSnapshots().find(s => s.id === tabId);
          if (!snap) return null;
          const isActive = historyStore.getActiveId() === tabId;
          return (
            <div
              key={tabId}
              onClick={() => historyStore.openTab(tabId)}
              className={\`group flex items-center gap-2 px-3 py-1.5 min-w-[140px] max-w-[200px] border-r border-[#333333] cursor-pointer text-sm transition-colors
                \${isActive ? 'bg-[#1e1e1e] text-[#cccccc] border-t-2 border-t-blue-500' : 'bg-[#2d2d2d] text-[#969696] hover:bg-[#2a2d2e] border-t-2 border-t-transparent'}
              \`}
            >
              <div className="w-3 h-3 rounded-sm bg-indigo-500/20 flex items-center justify-center">
                <span className="text-[8px] text-indigo-400">⚡</span>
              </div>
              <span className="truncate flex-1 tracking-tight">\${snap.name}</span>
              <button 
                className="w-5 h-5 rounded hover:bg-[#444444] text-gray-400 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  historyStore.closeTab(tabId);
                }}
              >
                &times;
              </button>
            </div>
          );
        })}
        {/* Fill remainder space */}
        <div className="flex-1 min-w-[50px] bg-[#222222] border-b border-[#333333]"></div>
      </div>
      
      {/* React Flow Editor */}
      <div
        className={cn(
          "w-full flex-1 bg-gray-100 relative overflow-hidden",
          isSequenceLayoutAnimating &&
            "[&_.react-flow__node]:transition-transform [&_.react-flow__node]:duration-[420ms] [&_.react-flow__node]:ease-[cubic-bezier(0.22,1,0.36,1)]",
        )}
      >`;

// Apply it
content = content.replace(
    /  return \(\n    <div\n      className=\{cn\(\n        "w-full h-full bg-gray-100 relative overflow-hidden",\n        isSequenceLayoutAnimating &&\n          "\[&_\.react-flow__node\]:transition-transform \[&_\.react-flow__node\]:duration-\[420ms\] \[&_\.react-flow__node\]:ease-\[cubic-bezier\(0\.22,1,0\.36,1\)\]",\n      \)\}\n    >/,
    returnedHtml
);

// We need an extra closing div at the end of NodeEditorInner
content = content.replace(
  /        onRestore={handleRestore}\n      \/\>\n    \<\/div\>\n  \);\n\}/,
  `        onRestore={handleRestore}\n      />\n    </div>\n    </div>\n  );\n}`
);

// Add Ctrl+S support in existing keyboard effect (around line 777-ish). We'll intercept it globally or at the editor level. 
// We are injecting a new useEffect at the start of NodeEditorInner.
const effectToInject = `
  // Sync historyStore to trigger re-renders when tabs change
  useSyncExternalStore(historyStore.subscribe.bind(historyStore), () => historyStore.getActiveId());
  
  // Ctrl+S to save explicitly
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        historyStore.saveSnapshot(nodes, edges);
        console.log("Snapshot successfully saved via Ctrl+S");
        // Could fire a toast here
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [nodes, edges]);
`;

content = content.replace(
  '  // Effect for detecting history changes to restore',
  effectToInject + '\n  // Effect for detecting history changes to restore'
);

fs.writeFileSync(path, content, 'utf8');
console.log("Injected UI layout tabs and Ctrl+S into NodeEditorInner");
