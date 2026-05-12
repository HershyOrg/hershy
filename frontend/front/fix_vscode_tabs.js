const fs = require('fs');

const path = 'components/node-editor/NodeEditor.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add Ctrl+S event listener in NodeEditor
content = content.replace(
  'const handleReactFlowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {',
  `const handleReactFlowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "s" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      historyStore.saveSnapshot(nodes, edges);
      return;
    }`
);

// 2. Wrap the NodeEditor render in a View that has tabs
const renderStartMatch = /  return \(\n    \<\>\n      \<div className="flex h-screen bg-slate-50"\>/;
const renderReplacement = `  return (
    <>
      <div className="flex flex-col h-screen bg-slate-50">
        {/* Editor Tabs */}
        <div className="flex h-9 w-full bg-[#1e1e1e] overflow-x-auto select-none border-b border-[#333333]">
          {historyStore.getSnapshots().filter(s => s.parentId === null).map((snap) => (
            <div
              key={snap.id}
              onClick={() => historyStore.setActiveId(snap.id)}
              className={\`flex items-center gap-2 px-4 py-1.5 min-w-[140px] max-w-[200px] border-r border-[#333333] cursor-pointer text-sm
                \${historyStore.getActiveId() === snap.id ? 'bg-[#1e1e1e] text-white border-t-2 border-t-blue-500' : 'bg-[#2d2d2d] text-gray-400 hover:bg-[#2a2d2e]'}
              \`}
            >
              <span className="truncate flex-1">{snap.name}</span>
              <button 
                className="w-4 h-4 rounded hover:bg-[#333333] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  // Just an example close behavior: doesn't delete, just hides from tabs if we implemented hidden state. For now just visual close button demo
                }}
              >
                &times;
              </button>
            </div>
          ))}
          <button 
            className="flex items-center justify-center w-9 h-full hover:bg-[#333333] text-gray-400"
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
              historyStore.setActiveId(newSnap.id);
            }}
          >
            +
          </button>
        </div>
      <div className="flex flex-1 overflow-hidden">`;

// Applying a simpler global replace wrapper if it looks specific enough:
let changed = false;
if (content.includes('return (\n    <>\n      <div className="flex h-screen bg-slate-50">')) {
  content = content.replace('return (\n    <>\n      <div className="flex h-screen bg-slate-50">', renderReplacement);
  changed = true;
} else if (content.includes('return (\n    <div className="flex h-screen bg-slate-50">')) {
   // Alternative regex for some variants
   content = content.replace('return (\n    <div className="flex h-screen bg-slate-50">', renderReplacement.replace('<>\n      ', ''));
   changed = true;
}

fs.writeFileSync(path, content, 'utf8');
console.log("Updated Tabs in NodeEditor", changed ? "successfully" : "failed to find match");
