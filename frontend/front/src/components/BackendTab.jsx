import { useRef, useState } from 'react';
import ChromeTabs from './ChromeTabs';
import Sidebar from './Sidebar';
import Canvas from './Canvas';
import BlockListPanel from './panels/BlockListPanel';
import SavedBlocksPanel from './panels/SavedBlocksPanel';
import StreamingBlocksPanel from './panels/StreamingBlocksPanel';
import NormalBlocksPanel from './panels/NormalBlocksPanel';
import TriggerBlocksPanel from './panels/TriggerBlocksPanel';
import ActionBlocksPanel from './panels/ActionBlocksPanel';
import MonitoringBlocksPanel from './panels/MonitoringBlocksPanel';

export default function BackendTab() {
  const initialTabs = [{ id: 'strategy-1', label: 'Strategy 1' }];
  const nextTabIdRef = useRef(2);
  const [tabs, setTabs] = useState(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialTabs[0].id);
  const [activePanel, setActivePanel] = useState(null);

  const handleIconClick = (panelType) => {
    setActivePanel(activePanel === panelType ? null : panelType);
  };

  const handleAddTab = () => {
    const nextId = `strategy-${nextTabIdRef.current}`;
    const nextLabel = `Strategy ${nextTabIdRef.current}`;
    nextTabIdRef.current += 1;

    setTabs((prevTabs) => [...prevTabs, { id: nextId, label: nextLabel }]);
    setActiveTabId(nextId);
  };

  const handleCloseTab = (tabId) => {
    setTabs((prevTabs) => {
      const closingIndex = prevTabs.findIndex((tab) => tab.id === tabId);
      const nextTabs = prevTabs.filter((tab) => tab.id !== tabId);

      if (tabId === activeTabId) {
        if (nextTabs.length === 0) {
          setActiveTabId(null);
        } else {
          const nextIndex = Math.min(closingIndex, nextTabs.length - 1);
          setActiveTabId(nextTabs[nextIndex].id);
        }
      }

      return nextTabs;
    });
  };

  return (
    <div className="backend-tab">
      <ChromeTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onAddTab={handleAddTab}
        onCloseTab={handleCloseTab}
        onSelectTab={setActiveTabId}
      />
      
      <div className="backend-content">
        <Sidebar activePanel={activePanel} onIconClick={handleIconClick} />
        
        <Canvas />
        
        {activePanel === 'block-list' && (
          <BlockListPanel onClose={() => setActivePanel(null)} />
        )}
        {activePanel === 'saved-blocks' && (
          <SavedBlocksPanel onClose={() => setActivePanel(null)} />
        )}
        {activePanel === 'streaming-blocks' && (
          <StreamingBlocksPanel onClose={() => setActivePanel(null)} />
        )}
        {activePanel === 'normal-blocks' && (
          <NormalBlocksPanel onClose={() => setActivePanel(null)} />
        )}
        {activePanel === 'trigger-blocks' && (
          <TriggerBlocksPanel onClose={() => setActivePanel(null)} />
        )}
        {activePanel === 'action-blocks' && (
          <ActionBlocksPanel onClose={() => setActivePanel(null)} />
        )}
        {activePanel === 'monitoring-blocks' && (
          <MonitoringBlocksPanel onClose={() => setActivePanel(null)} />
        )}
      </div>
    </div>
  );
}
