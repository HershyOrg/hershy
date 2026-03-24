import { useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './Sidebar';
import Canvas from './Canvas';
import FrontTab from './FrontTab';
import PreAuthTab from './PreAuthTab';
import BackendHeader from './backend/BackendHeader';
import StrategyFeedbackBar from './backend/StrategyFeedbackBar';
import HostControlBar from './backend/HostControlBar';
import AISidePanel from './backend/AISidePanel';
import BlockListPanel from './panels/BlockListPanel';
import SavedBlocksPanel from './panels/SavedBlocksPanel';
import StreamingBlocksPanel from './panels/StreamingBlocksPanel';
import NormalBlocksPanel from './panels/NormalBlocksPanel';
import TriggerBlocksPanel from './panels/TriggerBlocksPanel';
import ActionBlocksPanel from './panels/ActionBlocksPanel';
import MonitoringBlocksPanel from './panels/MonitoringBlocksPanel';
import {
  buildStrategyDefinition,
  buildStrategyFilename,
  strategyDefinitionToCanvas,
  strategyToPrettyJson,
  validateStrategyDefinition
} from '../lib/strategyCompiler';
import {
  createEmptyActionAuthState,
  isProviderAuthorized,
  resolveActionAuthRequirement
} from '../lib/actionAuth';
import useHostProgram from '../hooks/useHostProgram';
import useStrategyAI from '../hooks/useStrategyAI';
import { MAX_SNAPSHOT_RECORDS, buildSnapshotValues } from '../lib/monitoringSnapshots';

const DEFAULT_LIVE_INTERVAL = 1200;

export default function BackendTab() {
  const initialTabs = [{ id: 'strategy-1', label: 'Strategy 1' }];
  const nextTabIdRef = useRef(2);
  const nextBlockIdRef = useRef(1);
  const nextTemplateIdRef = useRef(1);
  const clipboardRef = useRef(null);
  const pasteOffsetRef = useRef(24);
  const streamIntervalsRef = useRef(new Map());
  const spawnColumnCount = 3;
  const spawnColumnWidth = 320;
  const spawnRowHeight = 260;
  const [tabs, setTabs] = useState(initialTabs);
  const [activeTabId, setActiveTabId] = useState(initialTabs[0].id);
  const [activePanel, setActivePanel] = useState(null);
  const [viewMode, setViewMode] = useState('backend');
  const [blocksByTab, setBlocksByTab] = useState(() => ({
    [initialTabs[0].id]: []
  }));
  const [connectionsByTab, setConnectionsByTab] = useState(() => ({
    [initialTabs[0].id]: []
  }));
  const [selectedBlockIdsByTab, setSelectedBlockIdsByTab] = useState(() => ({
    [initialTabs[0].id]: []
  }));
  const [actionAuthByTab, setActionAuthByTab] = useState(() => ({
    [initialTabs[0].id]: createEmptyActionAuthState()
  }));
  const [savedTemplates, setSavedTemplates] = useState([]);
  const [strategyNotice, setStrategyNotice] = useState(null);
  const [strategyReport, setStrategyReport] = useState(null);

  const handleIconClick = (panelType) => {
    setActivePanel(activePanel === panelType ? null : panelType);
  };

  const handleAddTab = () => {
    const nextId = `strategy-${nextTabIdRef.current}`;
    const nextLabel = `Strategy ${nextTabIdRef.current}`;
    nextTabIdRef.current += 1;

    setTabs((prevTabs) => [...prevTabs, { id: nextId, label: nextLabel }]);
    setBlocksByTab((prevBlocks) => ({
      ...prevBlocks,
      [nextId]: []
    }));
    setConnectionsByTab((prevConnections) => ({
      ...prevConnections,
      [nextId]: []
    }));
    setSelectedBlockIdsByTab((prevSelected) => ({
      ...prevSelected,
      [nextId]: []
    }));
    setActionAuthByTab((prevAuth) => ({
      ...prevAuth,
      [nextId]: createEmptyActionAuthState()
    }));
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

    setBlocksByTab((prevBlocks) => {
      const nextBlocks = { ...prevBlocks };
      delete nextBlocks[tabId];
      return nextBlocks;
    });

    setConnectionsByTab((prevConnections) => {
      const nextConnections = { ...prevConnections };
      delete nextConnections[tabId];
      return nextConnections;
    });

    setSelectedBlockIdsByTab((prevSelected) => {
      const nextSelected = { ...prevSelected };
      delete nextSelected[tabId];
      return nextSelected;
    });

    setActionAuthByTab((prevAuth) => {
      const nextAuth = { ...prevAuth };
      delete nextAuth[tabId];
      return nextAuth;
    });
  };

  useEffect(() => {
    if (!activeTabId) {
      return;
    }

    setSelectedBlockIdsByTab((prevSelected) => (
      prevSelected[activeTabId] ? prevSelected : { ...prevSelected, [activeTabId]: [] }
    ));
  }, [activeTabId]);

  useEffect(() => {
    if (!activeTabId) {
      return;
    }
    setActionAuthByTab((prevAuth) => (
      prevAuth[activeTabId]
        ? prevAuth
        : { ...prevAuth, [activeTabId]: createEmptyActionAuthState() }
    ));
  }, [activeTabId]);

  const getDefaultPosition = (blocks) => {
    const index = blocks.length;
    const column = index % spawnColumnCount;
    const row = Math.floor(index / spawnColumnCount);
    return {
      x: column * spawnColumnWidth,
      y: row * spawnRowHeight
    };
  };

  const activeBlocks = activeTabId ? blocksByTab[activeTabId] || [] : [];
  const activeConnections = activeTabId ? connectionsByTab[activeTabId] || [] : [];
  const activeSelectedIds = activeTabId ? selectedBlockIdsByTab[activeTabId] || [] : [];
  const activeActionAuth = activeTabId ? actionAuthByTab[activeTabId] || createEmptyActionAuthState() : createEmptyActionAuthState();
  const activeTabLabel = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId)?.label || '',
    [tabs, activeTabId]
  );

  const updateProviderAuth = (providerId, updates) => {
    if (!activeTabId || !providerId) {
      return;
    }
    setActionAuthByTab((prevAuth) => {
      const currentTab = prevAuth[activeTabId] || createEmptyActionAuthState();
      const currentProvider = currentTab[providerId] || {};
      return {
        ...prevAuth,
        [activeTabId]: {
          ...currentTab,
          [providerId]: {
            ...currentProvider,
            ...updates
          }
        }
      };
    });
  };

  const setNotice = (type, message) => {
    setStrategyNotice({
      type,
      message,
      at: Date.now()
    });
  };

  const compileActiveStrategy = () => {
    if (!activeTabId) {
      return null;
    }

    const strategy = buildStrategyDefinition({
      tabId: activeTabId,
      tabLabel: activeTabLabel,
      blocks: activeBlocks,
      connections: activeConnections
    });
    const report = validateStrategyDefinition(strategy);
    setStrategyReport(report);

    return {
      strategy,
      report,
      json: strategyToPrettyJson(strategy)
    };
  };

  const resetNextBlockId = (blocks) => {
    let maxSuffix = 0;
    (blocks || []).forEach((block) => {
      const match = String(block?.id || '').match(/-(\d+)$/);
      if (match) {
        maxSuffix = Math.max(maxSuffix, Number(match[1]));
      }
    });
    nextBlockIdRef.current = Math.max(maxSuffix + 1, (blocks?.length || 0) + 1);
  };

  const applyStrategyToActiveTab = (strategy) => {
    if (!activeTabId) {
      return false;
    }
    const canvasState = strategyDefinitionToCanvas(strategy);
    resetNextBlockId(canvasState.blocks);

    setBlocksByTab((prevBlocks) => ({
      ...prevBlocks,
      [activeTabId]: canvasState.blocks
    }));
    setConnectionsByTab((prevConnections) => ({
      ...prevConnections,
      [activeTabId]: canvasState.connections
    }));
    setSelectedBlockIdsByTab((prevSelected) => ({
      ...prevSelected,
      [activeTabId]: []
    }));
    return true;
  };

  const {
    aiPrompt,
    setAiPrompt,
    aiNotice,
    aiBusy,
    aiPanelOpen,
    setAiPanelOpen,
    handleGenerateAIStrategy,
    resetAiPrompt
  } = useStrategyAI({
    activeTabId,
    activeActionAuth,
    compileActiveStrategy,
    applyStrategyToActiveTab,
    validateStrategyDefinition,
    setStrategyReport,
    setNotice
  });

  const {
    hostTarget,
    hostProgram,
    hostBusy,
    handleOpenHostUI,
    handleDeployHostProgram,
    handleStartHostProgram,
    handleRefreshHostProgram,
    handleStopHostProgram,
    handleOpenWatcherStatus
  } = useHostProgram({
    activeTabId,
    activeTabLabel,
    activeActionAuth,
    compileActiveStrategy,
    setNotice
  });

  const handleValidateStrategy = () => {
    const result = compileActiveStrategy();
    if (!result) {
      setNotice('error', '활성 전략 탭이 없습니다.');
      return;
    }

    if (result.report.valid) {
      if (result.report.warnings.length > 0) {
        setNotice(
          'warn',
          `검증 통과 (경고 ${result.report.warnings.length}건).`
        );
      } else {
        setNotice('success', '검증 통과. 배포 가능한 전략 형식입니다.');
      }
      return;
    }

    setNotice(
      'error',
      `검증 실패 (에러 ${result.report.errors.length}건).`
    );
  };

  const handleCopyStrategyJson = async () => {
    const result = compileActiveStrategy();
    if (!result) {
      setNotice('error', '활성 전략 탭이 없습니다.');
      return;
    }

    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error('clipboard unavailable');
      }
      await navigator.clipboard.writeText(result.json);
      setNotice('success', '전략 JSON을 클립보드에 복사했습니다.');
    } catch {
      setNotice('error', '클립보드 복사에 실패했습니다.');
    }
  };

  const handleDownloadStrategyJson = () => {
    const result = compileActiveStrategy();
    if (!result) {
      setNotice('error', '활성 전략 탭이 없습니다.');
      return;
    }

    const filename = buildStrategyFilename(result.strategy?.strategy?.name || activeTabLabel);
    const blob = new Blob([result.json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setNotice('success', `${filename} 파일로 저장했습니다.`);
  };

  const serializeBlocks = (blocks) => {
    const positions = blocks.map((block) => block.position || { x: 0, y: 0 });
    const minX = Math.min(...positions.map((position) => position.x));
    const minY = Math.min(...positions.map((position) => position.y));

    return blocks.map((block) => {
      const { id, position, ...rest } = block;
      const normalizedPosition = position || { x: 0, y: 0 };
      return {
        ...rest,
        position: {
          x: normalizedPosition.x - minX,
          y: normalizedPosition.y - minY
        }
      };
    });
  };

  const createBlocksFromTemplate = (templateBlocks, basePosition) => (
    templateBlocks.map((block) => ({
      ...block,
      id: `${block.type}-${nextBlockIdRef.current++}`,
      position: {
        x: basePosition.x + (block.position?.x || 0),
        y: basePosition.y + (block.position?.y || 0)
      }
    }))
  );

  const addBlockToActiveTab = (block) => {
    if (!activeTabId) {
      return;
    }

    setBlocksByTab((prevBlocks) => ({
      ...prevBlocks,
      [activeTabId]: [
        ...(prevBlocks[activeTabId] || []),
        {
          ...block,
          position: block.position ?? getDefaultPosition(prevBlocks[activeTabId] || [])
        }
      ]
    }));
  };

  const addBlocksToActiveTab = (blocks, { select = false } = {}) => {
    if (!activeTabId || blocks.length === 0) {
      return;
    }

    setBlocksByTab((prevBlocks) => ({
      ...prevBlocks,
      [activeTabId]: [
        ...(prevBlocks[activeTabId] || []),
        ...blocks
      ]
    }));

    if (select) {
      setSelectedBlockIdsByTab((prevSelected) => ({
        ...prevSelected,
        [activeTabId]: blocks.map((block) => block.id)
      }));
    }
  };

  const handleSelectBlock = (blockId, options = {}) => {
    if (!activeTabId) {
      return;
    }

    setSelectedBlockIdsByTab((prevSelected) => {
      const current = prevSelected[activeTabId] || [];
      const { toggle, additive } = options;

      if (toggle) {
        return {
          ...prevSelected,
          [activeTabId]: current.includes(blockId)
            ? current.filter((id) => id !== blockId)
            : [...current, blockId]
        };
      }

      if (additive) {
        return {
          ...prevSelected,
          [activeTabId]: current.includes(blockId) ? current : [...current, blockId]
        };
      }

      return {
        ...prevSelected,
        [activeTabId]: [blockId]
      };
    });
  };

  const handleSelectBlocks = (blockIds, options = {}) => {
    if (!activeTabId) {
      return;
    }

    setSelectedBlockIdsByTab((prevSelected) => {
      const current = prevSelected[activeTabId] || [];
      const { additive } = options;
      const next = additive ? Array.from(new Set([...current, ...blockIds])) : blockIds;
      return {
        ...prevSelected,
        [activeTabId]: next
      };
    });
  };

  const handleClearSelection = () => {
    if (!activeTabId) {
      return;
    }

    setSelectedBlockIdsByTab((prevSelected) => ({
      ...prevSelected,
      [activeTabId]: []
    }));
  };

  const handleDeleteSelected = () => {
    if (!activeTabId || activeSelectedIds.length === 0) {
      return;
    }

    const idSet = new Set(activeSelectedIds);

    setBlocksByTab((prevBlocks) => ({
      ...prevBlocks,
      [activeTabId]: (prevBlocks[activeTabId] || []).filter((block) => !idSet.has(block.id))
    }));

    setConnectionsByTab((prevConnections) => ({
      ...prevConnections,
      [activeTabId]: (prevConnections[activeTabId] || []).filter((connection) => (
        !idSet.has(connection.fromId) && !idSet.has(connection.toId)
      ))
    }));

    handleClearSelection();
  };

  const handleSaveSelection = () => {
    if (!activeTabId || activeSelectedIds.length === 0) {
      return;
    }

    const selectedBlocks = activeBlocks.filter((block) => activeSelectedIds.includes(block.id));
    if (selectedBlocks.length === 0) {
      return;
    }

    const fallbackName = `저장된 블록 ${nextTemplateIdRef.current}`;
    const name = typeof window !== 'undefined'
      ? window.prompt('저장할 블록 묶음 이름', fallbackName) || fallbackName
      : fallbackName;

    const template = {
      id: `template-${nextTemplateIdRef.current++}`,
      name,
      blocks: serializeBlocks(selectedBlocks)
    };

    setSavedTemplates((prevTemplates) => [...prevTemplates, template]);
  };

  const handleCreateFromTemplate = (template) => {
    if (!activeTabId || !template) {
      return;
    }

    const basePosition = getDefaultPosition(activeBlocks);
    const offset = pasteOffsetRef.current;
    pasteOffsetRef.current += 24;

    const createdBlocks = createBlocksFromTemplate(template.blocks, {
      x: basePosition.x + offset,
      y: basePosition.y + offset
    });

    addBlocksToActiveTab(createdBlocks, { select: true });
  };

  const handleCopySelection = () => {
    if (!activeTabId || activeSelectedIds.length === 0) {
      return;
    }

    const selectedBlocks = activeBlocks.filter((block) => activeSelectedIds.includes(block.id));
    if (selectedBlocks.length === 0) {
      return;
    }

    clipboardRef.current = {
      blocks: serializeBlocks(selectedBlocks)
    };
  };

  const handlePasteSelection = () => {
    if (!activeTabId || !clipboardRef.current?.blocks?.length) {
      return;
    }

    const basePosition = getDefaultPosition(activeBlocks);
    const offset = pasteOffsetRef.current;
    pasteOffsetRef.current += 24;

    const createdBlocks = createBlocksFromTemplate(clipboardRef.current.blocks, {
      x: basePosition.x + offset,
      y: basePosition.y + offset
    });

    addBlocksToActiveTab(createdBlocks, { select: true });
  };

  const handleCreateStreamingBlock = (blockData) => {
    addBlockToActiveTab({
      id: `streaming-${nextBlockIdRef.current++}`,
      type: 'streaming',
      ...blockData
    });
  };

  const handleCreateActionBlock = (blockData) => {
    const requirement = resolveActionAuthRequirement(blockData);
    if (requirement && !isProviderAuthorized(activeActionAuth, requirement.id)) {
      setNotice('error', `${requirement.label} 사전인증을 완료해야 액션 블록을 생성할 수 있습니다.`);
      setViewMode('preauth');
      setActivePanel(null);
      return;
    }

    addBlockToActiveTab({
      id: `action-${nextBlockIdRef.current++}`,
      type: 'action',
      ...blockData
    });
  };

  const handleCreateMonitoringBlock = (blockData) => {
    addBlockToActiveTab({
      id: `monitoring-${nextBlockIdRef.current++}`,
      type: 'monitoring',
      ...blockData
    });
  };

  const handleCreateNormalBlock = (blockData) => {
    addBlockToActiveTab({
      id: `normal-${nextBlockIdRef.current++}`,
      type: 'normal',
      ...blockData
    });
  };

  const handleCreateTriggerBlock = (blockData) => {
    addBlockToActiveTab({
      id: `trigger-${nextBlockIdRef.current++}`,
      type: 'trigger',
      ...blockData
    });
  };

  const handleUpdateBlockPosition = (blockId, position) => {
    if (!activeTabId) {
      return;
    }

    setBlocksByTab((prevBlocks) => ({
      ...prevBlocks,
      [activeTabId]: (prevBlocks[activeTabId] || []).map((block) => (
        block.id === blockId ? { ...block, position } : block
      ))
    }));
  };

  const handleUpdateBlock = (blockId, updates) => {
    if (!activeTabId) {
      return;
    }

    setBlocksByTab((prevBlocks) => {
      const tabBlocks = prevBlocks[activeTabId] || [];
      const updatedBlocks = tabBlocks.map((block) => (
        block.id === blockId ? { ...block, ...updates } : block
      ));

      const target = updatedBlocks.find((block) => block.id === blockId);
      if (!target) {
        return prevBlocks;
      }

      const nextBlocks = updatedBlocks.map((block) => {
        if (block.type !== 'monitoring' || block.connectedStreamId !== blockId) {
          return block;
        }

        const next = { ...block };
        if (typeof updates.name === 'string') {
          next.connectedStream = updates.name || block.connectedStream;
        }
        if (Array.isArray(updates.fields)) {
          next.fields = updates.fields;
        }
        return next;
      });

      return {
        ...prevBlocks,
        [activeTabId]: nextBlocks
      };
    });
  };

  const handleRemoveStream = (monitoringId) => {
    if (!activeTabId) {
      return;
    }

    setConnectionsByTab((prevConnections) => {
      const nextConnections = { ...prevConnections };
      nextConnections[activeTabId] = (nextConnections[activeTabId] || []).filter((connection) => (
        !(connection.kind === 'stream-monitor' && connection.toId === monitoringId)
      ));
      return nextConnections;
    });

    setBlocksByTab((prevBlocks) => ({
      ...prevBlocks,
      [activeTabId]: (prevBlocks[activeTabId] || []).map((block) => (
        block.id === monitoringId
          ? {
              ...block,
              connectedStreamId: null,
              connectedStream: '',
              fields: []
            }
          : block
      ))
    }));
  };

  const pushMonitoringSnapshot = (tabId, monitoringId, streamId) => {
    if (!tabId) {
      return;
    }

    setBlocksByTab((prevBlocks) => {
      const tabBlocks = prevBlocks[tabId] || [];
      let changed = false;

      const nextBlocks = tabBlocks.map((block) => {
        if (block.id !== monitoringId || block.type !== 'monitoring') {
          return block;
        }
        if (block.connectedStreamId !== streamId) {
          return block;
        }
        const fields = Array.isArray(block.fields) ? block.fields : [];
        if (fields.length === 0) {
          return block;
        }

        const nextSeq = (block.snapshotSeq ?? 0) + 1;
        const timestamp = new Date().toISOString();
        const values = buildSnapshotValues(fields, nextSeq, block.previewValues || {});
        const record = {
          id: `${block.id}-snapshot-${nextSeq}`,
          seq: nextSeq,
          timestamp,
          values
        };
        const existing = Array.isArray(block.previewRecords) ? block.previewRecords : [];
        const nextRecords = [record, ...existing].slice(0, MAX_SNAPSHOT_RECORDS);
        changed = true;
        return {
          ...block,
          snapshotSeq: nextSeq,
          previewRecords: nextRecords,
          previewValues: values,
          previewTimestamp: timestamp
        };
      });

      if (!changed) {
        return prevBlocks;
      }

      return {
        ...prevBlocks,
        [tabId]: nextBlocks
      };
    });
  };

  const handleCreateStreamingFieldBlock = (sourceId, fieldName) => {
    if (!activeTabId || !fieldName) {
      return;
    }

    const sourceBlock = activeBlocks.find((block) => block.id === sourceId);
    if (!sourceBlock) {
      return;
    }

    const basePosition = sourceBlock.position || getDefaultPosition(activeBlocks);
    const offset = 40;

    addBlockToActiveTab({
      id: `streaming-${nextBlockIdRef.current++}`,
      type: 'streaming',
      name: `${sourceBlock.name || sourceBlock.id}_${fieldName}`,
      fields: [fieldName],
      apiUrl: sourceBlock.apiUrl || '',
      streamKind: sourceBlock.streamKind || 'url',
      streamChain: sourceBlock.streamChain || '',
      streamMethod: sourceBlock.streamMethod || '',
      streamParamsJson: sourceBlock.streamParamsJson || '',
      updateMode: sourceBlock.updateMode || 'periodic',
      updateInterval: sourceBlock.updateInterval || 1000,
      position: {
        x: (basePosition.x || 0) + offset,
        y: (basePosition.y || 0) + offset
      }
    });
  };

  const normalizeConnection = (fromBlock, toBlock, fromSide, toSide) => {
    if (fromBlock.type === 'streaming' && toBlock.type === 'monitoring') {
      return {
        kind: 'stream-monitor',
        streamingBlock: fromBlock,
        monitoringBlock: toBlock,
        streamingSide: fromSide,
        monitoringSide: toSide
      };
    }

    if (fromBlock.type === 'monitoring' && toBlock.type === 'streaming') {
      return {
        kind: 'stream-monitor',
        streamingBlock: toBlock,
        monitoringBlock: fromBlock,
        streamingSide: toSide,
        monitoringSide: fromSide
      };
    }

    if (fromBlock.type === 'trigger' && toBlock.type === 'action') {
      return {
        kind: 'trigger-action',
        triggerBlock: fromBlock,
        actionBlock: toBlock,
        fromSide,
        toSide
      };
    }

    if (fromBlock.type === 'action' && toBlock.type === 'trigger') {
      return {
        kind: 'trigger-action',
        triggerBlock: toBlock,
        actionBlock: fromBlock,
        fromSide: toSide,
        toSide: fromSide
      };
    }

    if (['streaming', 'normal', 'monitoring'].includes(fromBlock.type) && toBlock.type === 'action') {
      return {
        kind: 'action-input',
        sourceBlock: fromBlock,
        actionBlock: toBlock,
        fromSide,
        toSide
      };
    }

    if (fromBlock.type === 'action' && ['streaming', 'normal', 'monitoring'].includes(toBlock.type)) {
      return {
        kind: 'action-input',
        sourceBlock: toBlock,
        actionBlock: fromBlock,
        fromSide: toSide,
        toSide: fromSide
      };
    }

    return null;
  };

  const handleConnectBlocks = ({ fromId, fromSide, toId, toSide }) => {
    if (!activeTabId) {
      return;
    }

    setBlocksByTab((prevBlocks) => {
      const tabBlocks = prevBlocks[activeTabId] || [];
      const fromBlock = tabBlocks.find((block) => block.id === fromId);
      const toBlock = tabBlocks.find((block) => block.id === toId);

      if (!fromBlock || !toBlock) {
        return prevBlocks;
      }

      const normalized = normalizeConnection(fromBlock, toBlock, fromSide, toSide);
      if (!normalized) {
        return prevBlocks;
      }

      if (normalized.kind === 'stream-monitor') {
        const { streamingBlock, monitoringBlock, streamingSide, monitoringSide } = normalized;
        const streamName = streamingBlock.name || streamingBlock.id;
        const streamingFields = Array.isArray(streamingBlock.fields) ? streamingBlock.fields : [];

        setConnectionsByTab((prevConnections) => {
          const nextConnections = { ...prevConnections };
          const existing = nextConnections[activeTabId] || [];
          const filtered = existing.filter((connection) => (
            !(connection.kind === 'stream-monitor' && connection.toId === monitoringBlock.id)
          ));

          nextConnections[activeTabId] = [
            ...filtered,
            {
              id: `conn-${monitoringBlock.id}`,
              kind: 'stream-monitor',
              fromId: streamingBlock.id,
              fromSide: streamingSide,
              toId: monitoringBlock.id,
              toSide: monitoringSide
            }
          ];

          return nextConnections;
        });

        return {
          ...prevBlocks,
          [activeTabId]: tabBlocks.map((block) => (
            block.id === monitoringBlock.id
              ? {
                  ...block,
                  connectedStreamId: streamingBlock.id,
                  connectedStream: streamName,
                  fields: streamingFields
                }
              : block
          ))
        };
      }

      if (normalized.kind === 'trigger-action') {
        const { triggerBlock, actionBlock } = normalized;
        setConnectionsByTab((prevConnections) => {
          const nextConnections = { ...prevConnections };
          const existing = nextConnections[activeTabId] || [];
          const exists = existing.some((connection) => (
            connection.kind === 'trigger-action'
            && connection.fromId === triggerBlock.id
            && connection.toId === actionBlock.id
          ));
          if (exists) {
            return prevConnections;
          }
          nextConnections[activeTabId] = [
            ...existing,
            {
              id: `conn-${triggerBlock.id}-${actionBlock.id}`,
              kind: 'trigger-action',
              fromId: triggerBlock.id,
              fromSide,
              toId: actionBlock.id,
              toSide
            }
          ];
          return nextConnections;
        });

        return prevBlocks;
      }

      if (normalized.kind === 'action-input') {
        const { sourceBlock, actionBlock } = normalized;
        setConnectionsByTab((prevConnections) => {
          const nextConnections = { ...prevConnections };
          const existing = nextConnections[activeTabId] || [];
          const exists = existing.some((connection) => (
            connection.kind === 'action-input'
            && connection.fromId === sourceBlock.id
            && connection.toId === actionBlock.id
          ));
          if (exists) {
            return prevConnections;
          }
          nextConnections[activeTabId] = [
            ...existing,
            {
              id: `conn-${sourceBlock.id}-${actionBlock.id}`,
              kind: 'action-input',
              fromId: sourceBlock.id,
              fromSide,
              toId: actionBlock.id,
              toSide
            }
          ];
          return nextConnections;
        });

        return prevBlocks;
      }

      return prevBlocks;
    });
  };

  useEffect(() => {
    if (!activeTabId) {
      streamIntervalsRef.current.forEach((entry) => clearInterval(entry.timerId));
      streamIntervalsRef.current.clear();
      return;
    }

    const tabBlocks = blocksByTab[activeTabId] || [];
    const streamingById = new Map(
      tabBlocks
        .filter((block) => block.type === 'streaming')
        .map((block) => [block.id, block])
    );
    const monitoringBlocks = tabBlocks.filter((block) => (
      block.type === 'monitoring' && block.connectedStreamId
    ));

    const activeKeys = new Set();

    monitoringBlocks.forEach((monitor) => {
      const streaming = streamingById.get(monitor.connectedStreamId);
      if (!streaming) {
        return;
      }
      const intervalMs = streaming.updateMode === 'periodic'
        ? Math.max(300, Number(streaming.updateInterval) || 1000)
        : DEFAULT_LIVE_INTERVAL;
      const fieldsKey = Array.isArray(monitor.fields) ? monitor.fields.join('|') : '';
      const existing = streamIntervalsRef.current.get(monitor.id);

      activeKeys.add(monitor.id);

      if (
        !existing
        || existing.intervalMs !== intervalMs
        || existing.streamId !== streaming.id
        || existing.fieldsKey !== fieldsKey
      ) {
        if (existing) {
          clearInterval(existing.timerId);
        }
        const timerId = window.setInterval(() => {
          pushMonitoringSnapshot(activeTabId, monitor.id, streaming.id);
        }, intervalMs);
        streamIntervalsRef.current.set(monitor.id, {
          timerId,
          intervalMs,
          streamId: streaming.id,
          fieldsKey
        });
      }
    });

    streamIntervalsRef.current.forEach((entry, key) => {
      if (!activeKeys.has(key)) {
        clearInterval(entry.timerId);
        streamIntervalsRef.current.delete(key);
      }
    });
  }, [activeTabId, blocksByTab]);

  useEffect(() => () => {
    streamIntervalsRef.current.forEach((entry) => clearInterval(entry.timerId));
    streamIntervalsRef.current.clear();
  }, []);

  const isEditableTarget = (target) => {
    if (!target) {
      return false;
    }

    if (target.isContentEditable) {
      return true;
    }

    const tagName = target.tagName?.toLowerCase();
    return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!activeTabId || isEditableTarget(event.target)) {
        return;
      }

      if (event.key === 'Escape') {
        handleClearSelection();
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        handleDeleteSelected();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        handleCopySelection();
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        handlePasteSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, activeSelectedIds, activeBlocks]);

  return (
    <div className="backend-tab">
      <BackendHeader
        tabs={tabs}
        activeTabId={activeTabId}
        onAddTab={handleAddTab}
        onCloseTab={handleCloseTab}
        onSelectTab={setActiveTabId}
        onValidateStrategy={handleValidateStrategy}
        onCopyStrategyJson={handleCopyStrategyJson}
        onDownloadStrategyJson={handleDownloadStrategyJson}
        onOpenHostUI={handleOpenHostUI}
        aiPanelOpen={aiPanelOpen}
        onToggleAIPanel={() => setAiPanelOpen((prev) => !prev)}
        viewMode={viewMode}
        onSelectViewMode={(nextMode) => {
          setViewMode(nextMode);
          setActivePanel(null);
        }}
        hasActiveTab={Boolean(activeTabId)}
      />
      <StrategyFeedbackBar
        strategyReport={strategyReport}
        strategyNotice={strategyNotice}
      />
      <HostControlBar
        hostTarget={hostTarget}
        hostProgram={hostProgram}
        hostBusy={hostBusy}
        onDeploy={handleDeployHostProgram}
        onStart={handleStartHostProgram}
        onRefresh={handleRefreshHostProgram}
        onStop={handleStopHostProgram}
        onOpenWatcherStatus={handleOpenWatcherStatus}
        hasActiveTab={Boolean(activeTabId)}
      />
      
      {viewMode === 'backend' ? (
        <div className="backend-content">
          <Sidebar activePanel={activePanel} onIconClick={handleIconClick} />
          
          <Canvas
            blocks={activeBlocks}
            connections={activeConnections}
            selectedBlockIds={activeSelectedIds}
            onPositionChange={handleUpdateBlockPosition}
            onConnect={handleConnectBlocks}
            onUpdateBlock={handleUpdateBlock}
            onCreateStreamFieldBlock={handleCreateStreamingFieldBlock}
            onRemoveStream={handleRemoveStream}
            onSelectBlock={handleSelectBlock}
            onSelectBlocks={handleSelectBlocks}
            onClearSelection={handleClearSelection}
            onSaveSelection={handleSaveSelection}
          />
          
          {activePanel === 'block-list' && (
            <BlockListPanel
              onClose={() => setActivePanel(null)}
              blocks={activeBlocks}
              selectedBlockIds={activeSelectedIds}
              onSelectBlock={handleSelectBlock}
            />
          )}
          {activePanel === 'saved-blocks' && (
            <SavedBlocksPanel
              onClose={() => setActivePanel(null)}
              templates={savedTemplates}
              onCreateTemplate={handleCreateFromTemplate}
              onDeleteTemplate={(templateId) => {
                setSavedTemplates((prevTemplates) => (
                  prevTemplates.filter((template) => template.id !== templateId)
                ));
              }}
            />
          )}
          {activePanel === 'streaming-blocks' && (
            <StreamingBlocksPanel
              onClose={() => setActivePanel(null)}
              onCreate={handleCreateStreamingBlock}
            />
          )}
          {activePanel === 'normal-blocks' && (
            <NormalBlocksPanel
              onClose={() => setActivePanel(null)}
              onCreate={handleCreateNormalBlock}
            />
          )}
          {activePanel === 'trigger-blocks' && (
            <TriggerBlocksPanel
              onClose={() => setActivePanel(null)}
              onCreate={handleCreateTriggerBlock}
            />
          )}
          {activePanel === 'action-blocks' && (
            <ActionBlocksPanel
              onClose={() => setActivePanel(null)}
              onCreate={handleCreateActionBlock}
              authState={activeActionAuth}
              onRequestAuth={() => {
                setViewMode('preauth');
                setActivePanel(null);
              }}
            />
          )}
          {activePanel === 'monitoring-blocks' && (
            <MonitoringBlocksPanel
              onClose={() => setActivePanel(null)}
              onCreate={handleCreateMonitoringBlock}
            />
          )}
        </div>
      ) : viewMode === 'front' ? (
        <FrontTab
          blocks={activeBlocks}
          connections={activeConnections}
          onUpdateBlock={handleUpdateBlock}
          authState={activeActionAuth}
        />
      ) : (
        <PreAuthTab
          authState={activeActionAuth}
          onUpdateProvider={updateProviderAuth}
          onExit={() => setViewMode('backend')}
        />
      )}
      <AISidePanel
        open={aiPanelOpen}
        aiPrompt={aiPrompt}
        onChangePrompt={setAiPrompt}
        aiBusy={aiBusy}
        aiNotice={aiNotice}
        onGenerate={handleGenerateAIStrategy}
        onResetPrompt={resetAiPrompt}
        onClose={() => setAiPanelOpen(false)}
        disabled={!activeTabId}
      />
    </div>
  );
}
