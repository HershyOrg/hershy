"use client"

import { useState, useCallback, useRef, useEffect } from "react"

// 노드 타입
type NodeType = "action" | "streaming" | "function" | "trigger"

interface NodeData {
  id: string
  type: NodeType
  name: string
  x: number
  y: number
  isDetail: boolean
  functionName: string
  returnCode: string
  connectionPoints: string[]
}

interface Connection {
  id: string
  fromNodeId: string
  toNodeId: string
  toPointId: string
}

interface ChainGroup {
  id: string
  nodeIds: string[]
  name: string
}

// 에셋: 화살표 아이콘
const ArrowIcon = () => (
  <svg width={19} height={15} viewBox="0 0 19 15" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M18.7071 8.07107C19.0976 7.68054 19.0976 7.04738 18.7071 6.65685L12.3431 0.292892C11.9526 -0.0976319 11.3195 -0.0976319 10.9289 0.292892C10.5384 0.683417 10.5384 1.31658 10.9289 1.70711L16.5858 7.36396L10.9289 13.0208C10.5384 13.4113 10.5384 14.0445 10.9289 14.435C11.3195 14.8256 11.9526 14.8256 12.3431 14.435L18.7071 8.07107ZM0 7.36396V8.36396H18V7.36396V6.36396H0V7.36396Z"
      fill="black"
    />
  </svg>
)

// 에셋: 연결점 동그라미
const ConnectionCircle = ({
  isConnected,
  onClick,
}: {
  isConnected: boolean
  onClick: () => void
}) => (
  <svg
    width={8}
    height={8}
    viewBox="0 0 8 8"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="cursor-pointer hover:scale-125 transition-transform shrink-0"
    onClick={(e) => {
      e.stopPropagation()
      onClick()
    }}
  >
    <circle cx={4} cy={4} r={3} fill={isConnected ? "#8A38F5" : "#D9D9D9"} stroke="black" strokeWidth={1} />
  </svg>
)

// 에셋: 팝업 프레임 (삼각형 + 다크 박스)
const FunctionPopup = ({
  onSelect,
  onClose,
}: {
  onSelect: (fn: string) => void
  onClose: () => void
}) => {
  const functions = [
    "console.log()",
    "fetch()",
    "map()",
    "filter()",
    "reduce()",
    "setTimeout()",
    "Promise.all()",
  ]

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".popup-container")) {
        onClose()
      }
    }
    document.addEventListener("click", handleClick)
    return () => document.removeEventListener("click", handleClick)
  }, [onClose])

  return (
    <div className="popup-container absolute z-50 left-0 top-full mt-1" onClick={(e) => e.stopPropagation()}>
      {/* 삼각형 */}
      <svg width={60} height={40} viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M60 0L0 80H50.718H120L60 0Z" fill="#2D1212" />
      </svg>
      {/* 다크 박스 메뉴 */}
      <div
        className="flex flex-col gap-1 p-4 -mt-1"
        style={{ background: "#1c1c1c", border: "2px solid #856464", borderRadius: 4 }}
      >
        {functions.map((fn) => (
          <button
            key={fn}
            className="text-left text-sm text-white/80 hover:text-white hover:bg-white/10 px-3 py-1.5 rounded transition-colors font-mono"
            onClick={() => onSelect(fn)}
          >
            {fn}
          </button>
        ))}
      </div>
    </div>
  )
}

// 에셋: 코드 에디터 (Return 섹션용)
const CodeEditor = ({ code, onChange }: { code: string; onChange: (code: string) => void }) => {
  const lines = code.split("\n")
  const lineCount = Math.max(lines.length, 6)

  return (
    <div className="flex gap-3 p-4 rounded" style={{ background: "#1c1c1c", border: "2px solid #856464" }}>
      {/* 줄 번호 */}
      <div className="flex flex-col text-sm font-mono select-none" style={{ color: "rgba(255,255,255,0.2)" }}>
        {Array.from({ length: lineCount }, (_, i) => (
          <span key={i} className="leading-5 text-right w-4">{i + 1}</span>
        ))}
      </div>
      {/* 코드 영역 */}
      <textarea
        value={code}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent text-white text-sm font-mono resize-none outline-none leading-5"
        style={{ minHeight: lineCount * 20 }}
        spellCheck={false}
        placeholder="// your code here"
      />
    </div>
  )
}

// 메인 노드 컴포넌트
const NodeComponent = ({
  node,
  isSelected,
  connections,
  isConnecting,
  onDrag,
  onDragStart,
  onUpdateNode,
  onStartConnection,
  onEndConnection,
  onSelect,
}: {
  node: NodeData
  isSelected: boolean
  connections: Connection[]
  isConnecting: boolean
  onDrag: (id: string, x: number, y: number) => void
  onDragStart: () => void
  onUpdateNode: (id: string, updates: Partial<NodeData>) => void
  onStartConnection: (nodeId: string) => void
  onEndConnection: (nodeId: string, pointId: string) => void
  onSelect: (e: React.MouseEvent, nodeId: string) => void
}) => {
  const [isDragging, setIsDragging] = useState(false)
  const [showFunctionPopup, setShowFunctionPopup] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  const connectedPointIds = connections
    .filter((c) => c.toNodeId === node.id)
    .map((c) => c.toPointId)

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".no-drag")) return
    e.stopPropagation()
    onDragStart()
    setIsDragging(true)
    dragOffset.current = { x: e.clientX - node.x, y: e.clientY - node.y }
  }

  useEffect(() => {
    if (!isDragging) return
    const handleMouseMove = (e: MouseEvent) => {
      onDrag(node.id, e.clientX - dragOffset.current.x, e.clientY - dragOffset.current.y)
    }
    const handleMouseUp = () => setIsDragging(false)
    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isDragging, node.id, onDrag])

  // 노드 우클릭: 간선 연결 시작
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if ((e.target as HTMLElement).closest(".function-block")) return
    onStartConnection(node.id)
  }

  // function 좌클릭: 팝업
  const handleFunctionClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowFunctionPopup(true)
  }

  // 연결점 클릭
  const handlePointClick = (pointId: string) => {
    if (isConnecting) {
      onEndConnection(node.id, pointId)
    }
  }

  // 연결 바 클릭 (새 연결점 생성)
  const handleConnectionBarClick = () => {
    if (isConnecting) {
      const newPointId = `${node.id}-point-${node.connectionPoints.length}`
      onUpdateNode(node.id, { connectionPoints: [...node.connectionPoints, newPointId] })
      setTimeout(() => onEndConnection(node.id, newPointId), 0)
    }
  }

  // 상세/기본 전환
  const toggleDetail = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onUpdateNode(node.id, { isDetail: !node.isDetail })
  }

  return (
    <div
      className={`absolute cursor-move select-none ${isSelected ? "ring-2 ring-purple-500 ring-offset-2" : ""}`}
      style={{ left: node.x, top: node.y }}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      onClick={(e) => onSelect(e, node.id)}
    >
      {/* 흰색 와이어프레임 */}
      <div style={{ border: "1px solid #000", background: "#fff" }}>
        {/* 노드 타입 라벨 (좌측 상단) */}
        <div
          className="flex items-center px-2 py-1"
          style={{ borderBottom: "1px solid #000", width: "fit-content" }}
        >
          <span className="text-xs" style={{ color: "#000" }}>
            {node.type}
          </span>
          <span className="text-xs ml-1 text-amber-600">{node.name}</span>
        </div>

        <div className="flex">
          {/* 좌측 연결점 바 */}
          <div
            className={`flex flex-col items-center justify-center gap-2 py-3 px-1 cursor-pointer ${
              isConnecting ? "bg-purple-50" : "hover:bg-gray-50"
            }`}
            style={{ borderRight: "1px solid #000", minWidth: 16 }}
            onClick={handleConnectionBarClick}
          >
            {node.connectionPoints.map((pointId) => (
              <ConnectionCircle
                key={pointId}
                isConnected={connectedPointIds.includes(pointId)}
                onClick={() => handlePointClick(pointId)}
              />
            ))}
          </div>

          {/* 노드 내용 */}
          <div className="flex-1">
            {node.isDetail ? (
              /* 상세 모드 (detail) */
              <div className="p-4 no-drag" style={{ minWidth: 280 }}>
                {/* Param 섹션 */}
                <div className="mb-4">
                  <p className="text-xs text-blue-600 mb-1">Param</p>
                  <input
                    type="text"
                    className="w-full px-2 py-1 text-sm border rounded text-amber-600 focus:outline-none focus:border-gray-400"
                    style={{ borderColor: "#000" }}
                    placeholder="parameter"
                  />
                </div>

                {/* function() 섹션 */}
                <div className="mb-4 relative">
                  <p className="text-xs text-blue-600 mb-1">function</p>
                  <div
                    className="function-block flex items-center justify-center px-3 py-2 cursor-pointer hover:bg-gray-50"
                    style={{ border: "1px solid #000" }}
                    onClick={handleFunctionClick}
                  >
                    <span className="text-sm text-amber-600">{node.functionName}</span>
                  </div>
                  {showFunctionPopup && (
                    <FunctionPopup
                      onSelect={(fn) => {
                        onUpdateNode(node.id, { functionName: fn })
                        setShowFunctionPopup(false)
                      }}
                      onClose={() => setShowFunctionPopup(false)}
                    />
                  )}
                </div>

                {/* Return 섹션 (코드 에디터) */}
                <div>
                  <p className="text-xs text-blue-600 mb-1">Return</p>
                  <CodeEditor
                    code={node.returnCode}
                    onChange={(code) => onUpdateNode(node.id, { returnCode: code })}
                  />
                </div>
              </div>
            ) : (
              /* 기본 모드 */
              <div className="p-3 flex flex-col items-center gap-3">
                {/* function() 블록 */}
                <div
                  className="function-block flex items-center justify-center px-3 py-1 cursor-pointer hover:bg-gray-50 relative"
                  style={{ border: "1px solid #000" }}
                  onClick={handleFunctionClick}
                >
                  <span className="text-xs">{node.functionName}</span>
                  {showFunctionPopup && (
                    <FunctionPopup
                      onSelect={(fn) => {
                        onUpdateNode(node.id, { functionName: fn })
                        setShowFunctionPopup(false)
                      }}
                      onClose={() => setShowFunctionPopup(false)}
                    />
                  )}
                </div>

                {/* 화살표 → BLOCK */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <ArrowIcon />
                    <div className="px-2 py-0.5" style={{ border: "1px solid #000", background: "#fff" }}>
                      <span className="text-[10px]">BLOCK</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArrowIcon />
                    <div className="px-2 py-0.5" style={{ border: "1px solid #000", background: "#fff" }}>
                      <span className="text-[10px]">BLOCK</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 상세/기본 전환 버튼 */}
      <button
        className="absolute -top-2 -right-2 w-5 h-5 bg-white border border-black rounded-full text-xs hover:bg-gray-100 flex items-center justify-center"
        onClick={toggleDetail}
      >
        {node.isDetail ? "−" : "+"}
      </button>
    </div>
  )
}

// Chaining Chain 그룹 프레임 - 상하좌우 동일 색상/명도
const ChainGroupFrame = ({ group, nodes }: { group: ChainGroup; nodes: NodeData[] }) => {
  const groupNodes = nodes.filter((n) => group.nodeIds.includes(n.id))
  if (groupNodes.length === 0) return null

  const padding = 24
  const minX = Math.min(...groupNodes.map((n) => n.x)) - padding
  const minY = Math.min(...groupNodes.map((n) => n.y)) - padding - 16
  const maxX = Math.max(...groupNodes.map((n) => n.x)) + (groupNodes.some((n) => n.isDetail) ? 320 : 180) + padding
  const maxY = Math.max(...groupNodes.map((n) => n.y)) + (groupNodes.some((n) => n.isDetail) ? 380 : 150) + padding

  const width = maxX - minX
  const height = maxY - minY

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: minX,
        top: minY,
        width: width,
        height: height,
      }}
    >
      {/* 균일한 보라색 실선 프레임 - 상하좌우 동일 */}
      <svg 
        width={width} 
        height={height} 
        className="absolute inset-0"
        style={{ overflow: 'visible' }}
      >
        <rect
          x={2}
          y={2}
          width={width - 4}
          height={height - 4}
          rx={8}
          fill="rgba(138, 56, 245, 0.05)"
          stroke="#8A38F5"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* 라벨 */}
      <div 
        className="absolute left-3 px-3 py-1 text-xs font-medium rounded"
        style={{ 
          top: -10, 
          backgroundColor: '#8A38F5',
          color: '#fff'
        }}
      >
        {group.name}
      </div>
    </div>
  )
}

// 히스토리 상태 타입
interface HistoryState {
  nodes: NodeData[]
  connections: Connection[]
  chainGroups: ChainGroup[]
}

// 메인 에디터
export default function NodeEditor() {
  const [nodes, setNodes] = useState<NodeData[]>([
    {
      id: "node1",
      type: "function",
      name: "node1",
      x: 80,
      y: 100,
      isDetail: false,
      functionName: "function()",
      returnCode: "",
      connectionPoints: ["node1-point-0", "node1-point-1"],
    },
    {
      id: "node2",
      type: "action",
      name: "node2",
      x: 350,
      y: 60,
      isDetail: false,
      functionName: "console.log()",
      returnCode: "",
      connectionPoints: ["node2-point-0"],
    },
    {
      id: "node3",
      type: "streaming",
      name: "node3",
      x: 350,
      y: 220,
      isDetail: true,
      functionName: "fetch()",
      returnCode: "const res = await fetch(url);\nreturn res.json();",
      connectionPoints: ["node3-point-0", "node3-point-1"],
    },
  ])

  const [connections, setConnections] = useState<Connection[]>([
    { id: "conn1", fromNodeId: "node1", toNodeId: "node2", toPointId: "node2-point-0" },
    { id: "conn2", fromNodeId: "node1", toNodeId: "node3", toPointId: "node3-point-0" },
  ])

  const [chainGroups, setChainGroups] = useState<ChainGroup[]>([])
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null)
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 })
  const [showNodeMenu, setShowNodeMenu] = useState(false)
  const [showChainMenu, setShowChainMenu] = useState<{ x: number; y: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  // 히스토리 관리 (Undo 기능)
  const [history, setHistory] = useState<HistoryState[]>([])
  const maxHistoryLength = 50

  // 현재 상태를 히스토리에 저장
  const saveToHistory = useCallback(() => {
    setHistory((prev) => {
      const newHistory = [...prev, { nodes: JSON.parse(JSON.stringify(nodes)), connections: JSON.parse(JSON.stringify(connections)), chainGroups: JSON.parse(JSON.stringify(chainGroups)) }]
      if (newHistory.length > maxHistoryLength) {
        return newHistory.slice(-maxHistoryLength)
      }
      return newHistory
    })
  }, [nodes, connections, chainGroups])

  // Undo: 히스토리에서 이전 상태 복원
  const handleUndo = useCallback(() => {
    if (history.length === 0) return
    const previousState = history[history.length - 1]
    setNodes(previousState.nodes)
    setConnections(previousState.connections)
    setChainGroups(previousState.chainGroups)
    setHistory((prev) => prev.slice(0, -1))
  }, [history])

  // ESC: 선택 취소, 연결 취소, 메뉴 닫기
  const handleEscape = useCallback(() => {
    setSelectedNodes([])
    setConnectingFromId(null)
    setShowNodeMenu(false)
    setShowChainMenu(null)
  }, [])

  // 키보드 이벤트 핸들러
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC: 선택 취소
      if (e.key === "Escape") {
        handleEscape()
      }
      // Ctrl+Z / Cmd+Z: 되돌리기
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault()
        handleUndo()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [handleEscape, handleUndo])

  // 연결 중 커서 추적
  useEffect(() => {
    if (!connectingFromId) return
    const handleMouseMove = (e: MouseEvent) => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect()
        setCursorPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      }
    }
    const handleClick = () => setConnectingFromId(null)
    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("click", handleClick)
    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("click", handleClick)
    }
  }, [connectingFromId])

  const handleDragStart = useCallback(() => {
    saveToHistory()
  }, [saveToHistory])

  const handleDrag = useCallback((id: string, x: number, y: number) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)))
  }, [])

  const handleUpdateNode = useCallback((id: string, updates: Partial<NodeData>) => {
    saveToHistory()
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...updates } : n)))
  }, [saveToHistory])

  const handleStartConnection = useCallback((nodeId: string) => {
    setConnectingFromId(nodeId)
  }, [])

  const handleEndConnection = useCallback(
    (toNodeId: string, toPointId: string) => {
      if (connectingFromId && connectingFromId !== toNodeId) {
        saveToHistory()
        setConnections((prev) => [
          ...prev,
          { id: `conn-${Date.now()}`, fromNodeId: connectingFromId, toNodeId, toPointId },
        ])
      }
      setConnectingFromId(null)
    },
    [connectingFromId, saveToHistory]
  )

  const handleNodeSelect = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    if (e.shiftKey) {
      setSelectedNodes((prev) =>
        prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]
      )
    } else {
      setSelectedNodes([nodeId])
    }
  }, [])

  const handleCanvasContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (selectedNodes.length >= 2) {
        setShowChainMenu({ x: e.clientX, y: e.clientY })
      }
    },
    [selectedNodes]
  )

  const createChainGroup = useCallback(() => {
    saveToHistory()
    setChainGroups((prev) => [
      ...prev,
      { id: `chain-${Date.now()}`, nodeIds: [...selectedNodes], name: `Chain ${prev.length + 1}` },
    ])
    setShowChainMenu(null)
    setSelectedNodes([])
  }, [selectedNodes, saveToHistory])

  const addNode = useCallback(
    (type: NodeType) => {
      saveToHistory()
      const newNode: NodeData = {
        id: `node-${Date.now()}`,
        type,
        name: `node${nodes.length + 1}`,
        x: 150 + Math.random() * 100,
        y: 150 + Math.random() * 100,
        isDetail: false,
        functionName: "function()",
        returnCode: "",
        connectionPoints: [`node-${Date.now()}-point-0`],
      }
      setNodes((prev) => [...prev, newNode])
      setShowNodeMenu(false)
    },
    [nodes.length, saveToHistory]
  )

  // 간선 경로 계산: fromNode의 BLOCK -> toNode의 연결점(원 중심)
  const getConnectionPath = (conn: Connection) => {
    const fromNode = nodes.find((n) => n.id === conn.fromNodeId)
    const toNode = nodes.find((n) => n.id === conn.toNodeId)
    if (!fromNode || !toNode) return ""

    // fromNode: BLOCK 에셋 우측 끝 (화살표 -> BLOCK 구조에서 BLOCK 오른쪽)
    const fromX = fromNode.x + (fromNode.isDetail ? 300 : 150)
    const fromY = fromNode.y + (fromNode.isDetail ? 180 : 95)

    // toNode: 왼쪽 연결점 바의 원 중심 (정확히 원의 중앙)
    // 연결점 바: x=node.x, 각 원은 반지름 4px이므로 중심은 node.x + 8 (패딩 4 + 반지름 4)
    const pointIndex = toNode.connectionPoints.indexOf(conn.toPointId)
    const toX = toNode.x + 8  // 원 중심 X (연결바 패딩 + 원 반지름)
    const toY = toNode.y + 38 + (pointIndex >= 0 ? pointIndex * 16 : 0)  // 원 중심 Y

    // 베지어 곡선으로 부드럽게 연결
    const midX = (fromX + toX) / 2
    return `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`
  }

  return (
    <div className="w-full h-screen bg-gray-100 overflow-hidden relative">
      {/* 툴바 */}
      <div className="absolute top-4 left-4 z-40 flex gap-2">
        <button
          className="px-4 py-2 bg-white border border-black rounded text-sm font-medium hover:bg-gray-50"
          onClick={() => setShowNodeMenu(!showNodeMenu)}
        >
          + Add Node
        </button>
        {showNodeMenu && (
          <div className="absolute top-12 left-0 bg-white border border-black rounded shadow-lg">
            {(["action", "streaming", "function", "trigger"] as NodeType[]).map((type) => (
              <button
                key={type}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
                onClick={() => addNode(type)}
              >
                {type}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 캔버스 */}
      <div
        ref={canvasRef}
        className="w-full h-full relative"
        onClick={() => setSelectedNodes([])}
        onContextMenu={handleCanvasContextMenu}
      >
        {/* 간선 */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {connections.map((conn) => (
            <path
              key={conn.id}
              d={getConnectionPath(conn)}
              fill="none"
              stroke="#9898AB"
              strokeWidth={2}
              strokeDasharray="5 3"
            />
          ))}
          {/* 연결 중인 선 - BLOCK에서 시작 */}
          {connectingFromId && (
            <path
              d={(() => {
                const fromNode = nodes.find((n) => n.id === connectingFromId)
                if (!fromNode) return ""
                // BLOCK 에셋 우측 끝에서 시작
                const fromX = fromNode.x + (fromNode.isDetail ? 300 : 150)
                const fromY = fromNode.y + (fromNode.isDetail ? 180 : 95)
                // 베지어 곡선으로 커서까지 부드럽게
                const midX = (fromX + cursorPosition.x) / 2
                return `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${cursorPosition.y}, ${cursorPosition.x} ${cursorPosition.y}`
              })()}
              fill="none"
              stroke="#8A38F5"
              strokeWidth={2}
              strokeDasharray="5 5"
            />
          )}
        </svg>

        {/* Chaining Chain 그룹 */}
        {chainGroups.map((group) => (
          <ChainGroupFrame key={group.id} group={group} nodes={nodes} />
        ))}

        {/* 노드들 */}
        {nodes.map((node) => (
          <NodeComponent
            key={node.id}
            node={node}
            isSelected={selectedNodes.includes(node.id)}
            connections={connections}
            isConnecting={!!connectingFromId}
            onDrag={handleDrag}
            onDragStart={handleDragStart}
            onUpdateNode={handleUpdateNode}
            onStartConnection={handleStartConnection}
            onEndConnection={handleEndConnection}
            onSelect={handleNodeSelect}
          />
        ))}
      </div>

      {/* Chaining Chain 메뉴 */}
      {showChainMenu && (
        <div
          className="fixed bg-white border border-black rounded shadow-lg z-50"
          style={{ left: showChainMenu.x, top: showChainMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
            onClick={createChainGroup}
          >
            Chaining Chain
          </button>
          <button
            className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
            onClick={() => setShowChainMenu(null)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* 범례 */}
      <div className="absolute bottom-4 left-4 bg-white border border-black rounded px-4 py-3 text-xs">
        <p className="font-medium mb-2">Legend</p>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-amber-600">Aa</span>
            <span className="text-gray-500">Editable (Yellow)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-blue-600">Aa</span>
            <span className="text-gray-500">Description (Blue)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-3 border border-black bg-white" />
            <span className="text-gray-500">UI Frame (White)</span>
          </div>
        </div>
      </div>

      {/* 조작법 */}
      <div className="absolute bottom-4 right-4 bg-white border border-black rounded px-4 py-3 text-xs">
        <p className="font-medium mb-2">Controls</p>
        <div className="space-y-1 text-gray-600">
          <p><b>Drag</b> - Move node</p>
          <p><b>Right-click node</b> - Start connection</p>
          <p><b>Click connection bar</b> - Connect</p>
          <p><b>Click function</b> - Select function</p>
          <p><b>+/- button</b> - Toggle detail</p>
          <p><b>Shift+Click</b> - Multi-select</p>
          <p><b>Right-click canvas</b> - Chain selected</p>
        </div>
      </div>
    </div>
  )
}
