import { useEffect, useMemo, useRef, useState } from 'react';
import ChromeTabs from './ChromeTabs';
import Sidebar from './Sidebar';
import Canvas from './Canvas';
import FrontTab from './FrontTab';
import PreAuthTab from './PreAuthTab';
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
import { buildStrategyRunnerPayload } from '../lib/hostRunnerTemplates';
import { generateStrategyDraft } from '../lib/strategyAssistant';
import {
  createEmptyActionAuthState,
  getProviderCredentials,
  isProviderAuthorized,
  resolveActionAuthRequirement
} from '../lib/actionAuth';

const DEFAULT_LIVE_INTERVAL = 1200;
const MAX_SNAPSHOT_RECORDS = 30;
const FRONT_AI_ENDPOINT = '/api/ai/strategy-draft';
const FRONT_HOST_PROXY_PREFIX = '/api/host';
const DEFAULT_HOST_TARGET = 'http://localhost:9000';

const buildSnapshotValue = (field, seq, previousValues = {}) => {
  const lower = field.toLowerCase();
  if (lower.includes('time') || lower.includes('date')) {
    return new Date().toISOString();
  }
  if (lower.includes('symbol')) {
    return 'BTCUSDT';
  }
  if (lower.includes('address')) {
    return `0x${Math.random().toString(16).slice(2, 10)}`;
  }
  const prevRaw = previousValues[field];
  const prevNumber = Number(prevRaw);
  if (Number.isFinite(prevNumber)) {
    const jitter = (Math.random() - 0.5) * Math.max(1, Math.abs(prevNumber) * 0.02);
    return Number((prevNumber + jitter).toFixed(4));
  }
  if (
    lower.includes('price')
    || lower.includes('amount')
    || lower.includes('volume')
    || lower.includes('value')
    || lower.includes('rate')
  ) {
    const nextValue = 100 + seq * 0.7 + Math.random() * 5;
    return Number(nextValue.toFixed(4));
  }
  if (lower.includes('id')) {
    return `${seq}`;
  }
  return `${field}-${seq}`;
};

const buildSnapshotValues = (fields, seq, previousValues) => (
  fields.reduce((acc, field) => {
    acc[field] = buildSnapshotValue(field, seq, previousValues);
    return acc;
  }, {})
);

const buildAIAuthContext = (actionAuthState = {}) => {
  const evmCredentials = getProviderCredentials(actionAuthState, 'evm');
  const explorerApiKey = String(evmCredentials?.explorerApiKey || '').trim();
  if (!explorerApiKey) {
    return null;
  }
  return {
    evm: {
      explorerApiKey
    }
  };
};

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
  const [aiPrompt, setAiPrompt] = useState('BTCUSDT 1시간 마켓 전략으로 만들어줘. 최근 가격 기준 상단/하단 임계값을 자동 추정하고, 1시간 내 단기 돌파는 매수, 이탈은 매도하도록 구성해줘.');
  const [aiNotice, setAiNotice] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [hostTarget, setHostTarget] = useState(DEFAULT_HOST_TARGET);
  const [hostProgram, setHostProgram] = useState(null);
  const [hostBusy, setHostBusy] = useState(false);

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

  useEffect(() => {
    let mounted = true;
    fetch('/api/config')
      .then((response) => response.json())
      .then((payload) => {
        if (!mounted) {
          return;
        }
        if (typeof payload?.host_api_base === 'string' && payload.host_api_base.trim()) {
          setHostTarget(payload.host_api_base.trim());
        }
      })
      .catch(() => {
        // Keep default when front server config endpoint is unavailable.
      });
    return () => {
      mounted = false;
    };
  }, []);

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

  const handleGenerateAIStrategy = async () => {
    if (!activeTabId) {
      setNotice('error', '활성 전략 탭이 없습니다.');
      return;
    }
    if (!aiPrompt.trim()) {
      setNotice('error', 'AI 프롬프트를 입력하세요.');
      return;
    }

    const current = compileActiveStrategy();
    setAiBusy(true);
    setAiNotice(null);
    try {
      const generated = await generateStrategyDraft({
        prompt: aiPrompt,
        currentStrategy: current?.strategy || null,
        authContext: buildAIAuthContext(activeActionAuth),
        endpoint: FRONT_AI_ENDPOINT
      });
      const report = validateStrategyDefinition(generated.strategy);
      setStrategyReport(report);

      if (!report.valid) {
        setNotice('error', `AI 전략 검증 실패 (에러 ${report.errors.length}건).`);
        setAiNotice({
          type: 'error',
          message: generated.message || 'AI가 유효하지 않은 전략을 반환했습니다.',
          at: Date.now()
        });
        return;
      }

      applyStrategyToActiveTab(generated.strategy);
      setAiNotice({
        type: 'success',
        message: generated.message || `AI 전략 적용 완료 (${generated.source})`,
        at: Date.now()
      });
      setNotice('success', `AI 전략 적용 완료 (${generated.source}).`);
    } catch (error) {
      setAiNotice({
        type: 'error',
        message: error.message || 'AI 전략 생성 실패',
        at: Date.now()
      });
      setNotice('error', `AI 전략 생성 실패: ${error.message}`);
    } finally {
      setAiBusy(false);
    }
  };

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

  const handleOpenHostUI = () => {
    if (typeof window === 'undefined') {
      return;
    }
    const base = hostTarget.trim().replace(/\/+$/, '') || DEFAULT_HOST_TARGET;
    window.open(`${base}/ui/programs`, '_blank', 'noopener,noreferrer');
  };

  const callHost = async (path, options = {}) => {
    const url = `${FRONT_HOST_PROXY_PREFIX}${path}`;
    let response;

    try {
      response = await fetch(url, options);
    } catch {
      throw new Error(
        `Host API 연결 실패 (${url}). front 서버 프록시와 host(:9000) 상태를 확인하세요.`
      );
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error || payload?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload;
  };

  const handleDeployHostProgram = async () => {
    const compiled = compileActiveStrategy();
    if (!compiled) {
      setNotice('error', '활성 전략 탭이 없습니다.');
      return;
    }
    if (!compiled.report.valid) {
      setNotice('error', '전략 검증을 먼저 통과시켜야 배포할 수 있습니다.');
      return;
    }

    setHostBusy(true);
    try {
      const payload = buildStrategyRunnerPayload(compiled.json, {
        userHint: activeTabLabel || activeTabId || 'strategy',
        actionAuth: activeActionAuth
      });
      const created = await callHost('/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setHostProgram({
        programId: created.program_id,
        buildId: created.build_id,
        state: created.state,
        proxyUrl: created.proxy_url
      });
      setNotice('success', `Host 프로그램 생성 완료: ${created.program_id}`);
    } catch (error) {
      setNotice('error', `배포 실패: ${error.message}`);
    } finally {
      setHostBusy(false);
    }
  };

  const handleStartHostProgram = async () => {
    if (!hostProgram?.programId) {
      setNotice('error', '먼저 Host 배포를 실행하세요.');
      return;
    }
    setHostBusy(true);
    try {
      const started = await callHost(`/programs/${hostProgram.programId}/start`, {
        method: 'POST'
      });
      setHostProgram((prev) => ({
        ...prev,
        state: started.state
      }));
      setNotice('success', `실행 요청 완료: ${hostProgram.programId}`);
    } catch (error) {
      setNotice('error', `시작 실패: ${error.message}`);
    } finally {
      setHostBusy(false);
    }
  };

  const handleRefreshHostProgram = async () => {
    if (!hostProgram?.programId) {
      return;
    }
    setHostBusy(true);
    try {
      const item = await callHost(`/programs/${hostProgram.programId}`);
      setHostProgram({
        programId: item.program_id,
        buildId: item.build_id,
        state: item.state,
        proxyUrl: item.proxy_url,
        errorMsg: item.error_msg
      });
      if (item.state === 'Ready') {
        setNotice('success', `프로그램 Ready: ${item.program_id}`);
      } else {
        setNotice('warn', `프로그램 상태: ${item.state}`);
      }
    } catch (error) {
      setNotice('error', `상태 조회 실패: ${error.message}`);
    } finally {
      setHostBusy(false);
    }
  };

  const handleStopHostProgram = async () => {
    if (!hostProgram?.programId) {
      return;
    }
    setHostBusy(true);
    try {
      const stopped = await callHost(`/programs/${hostProgram.programId}/stop`, {
        method: 'POST'
      });
      setHostProgram((prev) => ({
        ...prev,
        state: stopped.state
      }));
      setNotice('warn', `중지 요청 완료: ${hostProgram.programId}`);
    } catch (error) {
      setNotice('error', `중지 실패: ${error.message}`);
    } finally {
      setHostBusy(false);
    }
  };

  const handleOpenWatcherStatus = () => {
    if (typeof window === 'undefined' || !hostProgram?.programId) {
      return;
    }
    const base = hostTarget.trim().replace(/\/+$/, '') || DEFAULT_HOST_TARGET;
    window.open(
      `${base}/programs/${hostProgram.programId}/proxy/watcher/status`,
      '_blank',
      'noopener,noreferrer'
    );
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
      <div className="backend-tab-header">
        <ChromeTabs
          tabs={tabs}
          activeTabId={activeTabId}
          onAddTab={handleAddTab}
          onCloseTab={handleCloseTab}
          onSelectTab={setActiveTabId}
        />
        <div className="backend-view-toggle">
          <button
            type="button"
            className="strategy-tool-btn"
            onClick={handleValidateStrategy}
            disabled={!activeTabId}
          >
            전략 검증
          </button>
          <button
            type="button"
            className="strategy-tool-btn"
            onClick={handleCopyStrategyJson}
            disabled={!activeTabId}
          >
            JSON 복사
          </button>
          <button
            type="button"
            className="strategy-tool-btn"
            onClick={handleDownloadStrategyJson}
            disabled={!activeTabId}
          >
            JSON 저장
          </button>
          <button
            type="button"
            className="strategy-tool-btn host"
            onClick={handleOpenHostUI}
          >
            Host UI
          </button>
          <button
            type="button"
            className={`strategy-tool-btn ai${aiPanelOpen ? ' active' : ''}`}
            onClick={() => setAiPanelOpen((prev) => !prev)}
          >
            AI 전략
          </button>
          <button
            type="button"
            className={`backend-view-btn${viewMode === 'backend' ? ' active' : ''}`}
            onClick={() => {
              setViewMode('backend');
              setActivePanel(null);
            }}
          >
            백엔드
          </button>
          <button
            type="button"
            className={`backend-view-btn${viewMode === 'front' ? ' active' : ''}`}
            onClick={() => {
              setViewMode('front');
              setActivePanel(null);
            }}
          >
            프론트
          </button>
          <button
            type="button"
            className={`backend-view-btn${viewMode === 'preauth' ? ' active' : ''}`}
            onClick={() => {
              setViewMode('preauth');
              setActivePanel(null);
            }}
          >
            사전인증
          </button>
        </div>
      </div>
      <div className="strategy-feedback-bar">
        <div className={`strategy-feedback-chip ${strategyReport?.valid ? 'valid' : 'invalid'}`}>
          {strategyReport
            ? `검증: ${strategyReport.valid ? '통과' : '실패'}`
            : '검증: 미실행'}
        </div>
        {strategyReport && (
          <div className="strategy-feedback-summary">
            blocks {strategyReport.stats?.blocks ?? 0} · links {strategyReport.stats?.connections ?? 0}
            {' '}· errors {strategyReport.errors.length} · warnings {strategyReport.warnings.length}
          </div>
        )}
        {strategyNotice && (
          <div className={`strategy-feedback-message ${strategyNotice.type}`}>
            {strategyNotice.message}
          </div>
        )}
      </div>
      <div className="host-control-bar">
        <div className="host-control-target">
          Host API Target: {hostTarget}
        </div>
        <button
          type="button"
          className="strategy-tool-btn host"
          onClick={handleDeployHostProgram}
          disabled={!activeTabId || hostBusy}
        >
          {hostBusy ? '처리중...' : 'Host 배포'}
        </button>
        <button
          type="button"
          className="strategy-tool-btn"
          onClick={handleStartHostProgram}
          disabled={!hostProgram?.programId || hostBusy}
        >
          시작
        </button>
        <button
          type="button"
          className="strategy-tool-btn"
          onClick={handleRefreshHostProgram}
          disabled={!hostProgram?.programId || hostBusy}
        >
          상태
        </button>
        <button
          type="button"
          className="strategy-tool-btn"
          onClick={handleStopHostProgram}
          disabled={!hostProgram?.programId || hostBusy}
        >
          중지
        </button>
        <button
          type="button"
          className="strategy-tool-btn"
          onClick={handleOpenWatcherStatus}
          disabled={!hostProgram?.programId}
        >
          Watcher 상태
        </button>
        {hostProgram && (
          <div className="host-program-summary">
            id {hostProgram.programId} · build {hostProgram.buildId} · state {hostProgram.state}
          </div>
        )}
      </div>
      {strategyReport && (strategyReport.errors.length > 0 || strategyReport.warnings.length > 0) && (
        <div className="strategy-feedback-issues">
          {strategyReport.errors.slice(0, 3).map((item) => (
            <div key={`err-${item.code}-${item.message}`} className="strategy-feedback-issue error">
              [ERR] {item.message}
            </div>
          ))}
          {strategyReport.warnings.slice(0, 3).map((item) => (
            <div key={`warn-${item.code}-${item.message}`} className="strategy-feedback-issue warn">
              [WARN] {item.message}
            </div>
          ))}
        </div>
      )}
      
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
      <div className={`ai-side-panel${aiPanelOpen ? ' open' : ''}`}>
        <div className="ai-side-header">
          <div className="ai-side-title">AI 전략</div>
          <button
            type="button"
            className="ai-side-close"
            onClick={() => setAiPanelOpen(false)}
          >
            닫기
          </button>
        </div>
        <div className="ai-side-body">
          <label htmlFor="ai-strategy-prompt" className="ai-control-label">요청 프롬프트</label>
          <textarea
            id="ai-strategy-prompt"
            className="ai-control-input"
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.target.value)}
            placeholder="예: BTCUSDT 1시간 마켓 기준으로 돌파 매수/이탈 매도 전략 만들어줘"
            rows={7}
          />
          <div className="ai-control-actions">
            <button
              type="button"
              className="strategy-tool-btn host"
              onClick={handleGenerateAIStrategy}
              disabled={!activeTabId || aiBusy}
            >
              {aiBusy ? 'AI 생성중...' : 'AI로 전략 생성'}
            </button>
            <button
              type="button"
              className="strategy-tool-btn"
              onClick={() => setAiPrompt('BTCUSDT 1시간 마켓 전략으로 만들어줘. 최근 가격 기준 상단/하단 임계값을 자동 추정하고, 1시간 내 단기 돌파는 매수, 이탈은 매도하도록 구성해줘.')}
              disabled={aiBusy}
            >
              예시 입력
            </button>
          </div>
          <div className="ai-control-hint">
            front 서버의 `/api/ai/strategy-draft`(오케스트레이션 to 리서치 to 전략)를 호출하고, 실패하면 로컬 규칙 생성으로 대체합니다.
          </div>
          {aiNotice && (
            <div className={`ai-control-message ${aiNotice.type}`}>
              {aiNotice.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
