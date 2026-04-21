import { useCallback, useEffect, useRef, useState } from 'react'

type NodeType = 'action' | 'streaming' | 'function' | 'trigger'

type NodeData = {
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

type Connection = {
  id: string
  fromNodeId: string
  toNodeId: string
  toPointId: string
}

type ChainGroup = {
  id: string
  nodeIds: string[]
  name: string
}

type HistoryState = {
  nodes: NodeData[]
  connections: Connection[]
  chainGroups: ChainGroup[]
}

function ArrowIcon() {
  return (
    <svg width={19} height={15} viewBox="0 0 19 15" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M18.7071 8.07107C19.0976 7.68054 19.0976 7.04738 18.7071 6.65685L12.3431 0.292892C11.9526 -0.0976319 11.3195 -0.0976319 10.9289 0.292892C10.5384 0.683417 10.5384 1.31658 10.9289 1.70711L16.5858 7.36396L10.9289 13.0208C10.5384 13.4113 10.5384 14.0445 10.9289 14.435C11.3195 14.8256 11.9526 14.8256 12.3431 14.435L18.7071 8.07107ZM0 7.36396V8.36396H18V7.36396V6.36396H0V7.36396Z"
        fill="black"
      />
    </svg>
  )
}

function ConnectionCircle({
  isConnected,
  onClick,
}: {
  isConnected: boolean
  onClick: () => void
}) {
  return (
    <svg
      width={8}
      height={8}
      viewBox="0 0 8 8"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0 cursor-pointer transition-transform hover:scale-125"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      <circle
        cx={4}
        cy={4}
        r={3}
        fill={isConnected ? '#8A38F5' : '#D9D9D9'}
        stroke="black"
        strokeWidth={1}
      />
    </svg>
  )
}

function FunctionPopup({
  onSelect,
  onClose,
}: {
  onSelect: (fn: string) => void
  onClose: () => void
}) {
  const functions = [
    'console.log()',
    'fetch()',
    'map()',
    'filter()',
    'reduce()',
    'setTimeout()',
    'Promise.all()',
  ]

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (!(event.target as HTMLElement).closest('.popup-container')) {
        onClose()
      }
    }

    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [onClose])

  return (
    <div className="popup-container absolute left-0 top-full z-50 mt-1" onClick={(event) => event.stopPropagation()}>
      <svg width={60} height={40} viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M60 0L0 80H50.718H120L60 0Z" fill="#2D1212" />
      </svg>
      <div
        className="-mt-1 flex flex-col gap-1 p-4"
        style={{ background: '#1c1c1c', border: '2px solid #856464', borderRadius: 4 }}
      >
        {functions.map((fn) => (
          <button
            key={fn}
            className="rounded px-3 py-1.5 text-left font-mono text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            onClick={() => onSelect(fn)}
          >
            {fn}
          </button>
        ))}
      </div>
    </div>
  )
}

function CodeEditor({
  code,
  onChange,
}: {
  code: string
  onChange: (code: string) => void
}) {
  const lines = code.split('\n')
  const lineCount = Math.max(lines.length, 6)

  return (
    <div className="flex gap-3 rounded p-4" style={{ background: '#1c1c1c', border: '2px solid #856464' }}>
      <div className="flex select-none flex-col text-sm font-mono" style={{ color: 'rgba(255,255,255,0.2)' }}>
        {Array.from({ length: lineCount }, (_, index) => (
          <span key={index} className="w-4 text-right leading-5">
            {index + 1}
          </span>
        ))}
      </div>
      <textarea
        value={code}
        onChange={(event) => onChange(event.target.value)}
        className="flex-1 resize-none bg-transparent font-mono text-sm leading-5 text-white outline-none"
        style={{ minHeight: lineCount * 20 }}
        spellCheck={false}
        placeholder="// your code here"
      />
    </div>
  )
}

function NodeComponent({
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
  onSelect: (event: React.MouseEvent, nodeId: string) => void
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [showFunctionPopup, setShowFunctionPopup] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })

  const connectedPointIds = connections
    .filter((connection) => connection.toNodeId === node.id)
    .map((connection) => connection.toPointId)

  function handleMouseDown(event: React.MouseEvent) {
    if ((event.target as HTMLElement).closest('.no-drag')) {
      return
    }

    event.stopPropagation()
    onDragStart()
    setIsDragging(true)
    dragOffset.current = { x: event.clientX - node.x, y: event.clientY - node.y }
  }

  useEffect(() => {
    if (!isDragging) {
      return
    }

    function handleMouseMove(event: MouseEvent) {
      onDrag(node.id, event.clientX - dragOffset.current.x, event.clientY - dragOffset.current.y)
    }

    function handleMouseUp() {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, node.id, onDrag])

  function handleContextMenu(event: React.MouseEvent) {
    event.preventDefault()
    if ((event.target as HTMLElement).closest('.function-block')) {
      return
    }
    onStartConnection(node.id)
  }

  function handleFunctionClick(event: React.MouseEvent) {
    event.stopPropagation()
    setShowFunctionPopup(true)
  }

  function handlePointClick(pointId: string) {
    if (isConnecting) {
      onEndConnection(node.id, pointId)
    }
  }

  function handleConnectionBarClick() {
    if (isConnecting) {
      const newPointId = `${node.id}-point-${node.connectionPoints.length}`
      onUpdateNode(node.id, { connectionPoints: [...node.connectionPoints, newPointId] })
      setTimeout(() => onEndConnection(node.id, newPointId), 0)
    }
  }

  function toggleDetail(event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    onUpdateNode(node.id, { isDetail: !node.isDetail })
  }

  return (
    <div
      className={`absolute cursor-move select-none ${isSelected ? 'ring-2 ring-purple-500 ring-offset-2' : ''}`}
      style={{ left: node.x, top: node.y }}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      onClick={(event) => onSelect(event, node.id)}
    >
      <div style={{ border: '1px solid #000', background: '#fff' }}>
        <div className="flex items-center px-2 py-1" style={{ borderBottom: '1px solid #000', width: 'fit-content' }}>
          <span className="text-xs" style={{ color: '#000' }}>
            {node.type}
          </span>
          <span className="ml-1 text-xs text-amber-600">{node.name}</span>
        </div>

        <div className="flex">
          <div
            className={`flex min-w-4 cursor-pointer flex-col items-center justify-center gap-2 px-1 py-3 ${
              isConnecting ? 'bg-purple-50' : 'hover:bg-gray-50'
            }`}
            style={{ borderRight: '1px solid #000' }}
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

          <div className="flex-1">
            {node.isDetail ? (
              <div className="no-drag p-4" style={{ minWidth: 280 }}>
                <div className="mb-4">
                  <p className="mb-1 text-xs text-blue-600">Param</p>
                  <input
                    type="text"
                    className="w-full rounded border px-2 py-1 text-sm text-amber-600 focus:border-gray-400 focus:outline-none"
                    style={{ borderColor: '#000' }}
                    placeholder="parameter"
                  />
                </div>

                <div className="relative mb-4">
                  <p className="mb-1 text-xs text-blue-600">function</p>
                  <div
                    className="function-block flex cursor-pointer items-center justify-center px-3 py-2 hover:bg-gray-50"
                    style={{ border: '1px solid #000' }}
                    onClick={handleFunctionClick}
                  >
                    <span className="text-sm text-amber-600">{node.functionName}</span>
                  </div>
                  {showFunctionPopup ? (
                    <FunctionPopup
                      onSelect={(fn) => {
                        onUpdateNode(node.id, { functionName: fn })
                        setShowFunctionPopup(false)
                      }}
                      onClose={() => setShowFunctionPopup(false)}
                    />
                  ) : null}
                </div>

                <div>
                  <p className="mb-1 text-xs text-blue-600">Return</p>
                  <CodeEditor
                    code={node.returnCode}
                    onChange={(code) => onUpdateNode(node.id, { returnCode: code })}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 p-3">
                <div
                  className="function-block relative flex cursor-pointer items-center justify-center px-3 py-1 hover:bg-gray-50"
                  style={{ border: '1px solid #000' }}
                  onClick={handleFunctionClick}
                >
                  <span className="text-xs">{node.functionName}</span>
                  {showFunctionPopup ? (
                    <FunctionPopup
                      onSelect={(fn) => {
                        onUpdateNode(node.id, { functionName: fn })
                        setShowFunctionPopup(false)
                      }}
                      onClose={() => setShowFunctionPopup(false)}
                    />
                  ) : null}
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <ArrowIcon />
                    <div className="bg-white px-2 py-0.5" style={{ border: '1px solid #000' }}>
                      <span className="text-[10px]">BLOCK</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArrowIcon />
                    <div className="bg-white px-2 py-0.5" style={{ border: '1px solid #000' }}>
                      <span className="text-[10px]">BLOCK</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <button
        className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-black bg-white text-xs hover:bg-gray-100"
        onClick={toggleDetail}
      >
        {node.isDetail ? '−' : '+'}
      </button>
    </div>
  )
}

function ChainGroupFrame({
  group,
  nodes,
}: {
  group: ChainGroup
  nodes: NodeData[]
}) {
  const groupNodes = nodes.filter((node) => group.nodeIds.includes(node.id))
  if (groupNodes.length === 0) {
    return null
  }

  const padding = 24
  const minX = Math.min(...groupNodes.map((node) => node.x)) - padding
  const minY = Math.min(...groupNodes.map((node) => node.y)) - padding - 16
  const maxX =
    Math.max(...groupNodes.map((node) => node.x)) +
    (groupNodes.some((node) => node.isDetail) ? 320 : 180) +
    padding
  const maxY =
    Math.max(...groupNodes.map((node) => node.y)) +
    (groupNodes.some((node) => node.isDetail) ? 380 : 150) +
    padding

  const width = maxX - minX
  const height = maxY - minY

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: minX,
        top: minY,
        width,
        height,
      }}
    >
      <svg width={width} height={height} className="absolute inset-0" style={{ overflow: 'visible' }}>
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
      <div
        className="absolute left-3 rounded px-3 py-1 text-xs font-medium"
        style={{
          top: -10,
          backgroundColor: '#8A38F5',
          color: '#fff',
        }}
      >
        {group.name}
      </div>
    </div>
  )
}

export function HershyNodeDemo() {
  const [nodes, setNodes] = useState<NodeData[]>([
    {
      id: 'node1',
      type: 'function',
      name: 'node1',
      x: 80,
      y: 100,
      isDetail: false,
      functionName: 'function()',
      returnCode: '',
      connectionPoints: ['node1-point-0', 'node1-point-1'],
    },
    {
      id: 'node2',
      type: 'action',
      name: 'node2',
      x: 350,
      y: 60,
      isDetail: false,
      functionName: 'console.log()',
      returnCode: '',
      connectionPoints: ['node2-point-0'],
    },
    {
      id: 'node3',
      type: 'streaming',
      name: 'node3',
      x: 350,
      y: 220,
      isDetail: true,
      functionName: 'fetch()',
      returnCode: 'const res = await fetch(url);\nreturn res.json();',
      connectionPoints: ['node3-point-0', 'node3-point-1'],
    },
  ])

  const [connections, setConnections] = useState<Connection[]>([
    { id: 'conn1', fromNodeId: 'node1', toNodeId: 'node2', toPointId: 'node2-point-0' },
    { id: 'conn2', fromNodeId: 'node1', toNodeId: 'node3', toPointId: 'node3-point-0' },
  ])

  const [chainGroups, setChainGroups] = useState<ChainGroup[]>([])
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null)
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 })
  const [showNodeMenu, setShowNodeMenu] = useState(false)
  const [showChainMenu, setShowChainMenu] = useState<{ x: number; y: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const [history, setHistory] = useState<HistoryState[]>([])
  const maxHistoryLength = 50

  const saveToHistory = useCallback(() => {
    setHistory((prev) => {
      const newHistory = [
        ...prev,
        {
          nodes: JSON.parse(JSON.stringify(nodes)),
          connections: JSON.parse(JSON.stringify(connections)),
          chainGroups: JSON.parse(JSON.stringify(chainGroups)),
        },
      ]

      if (newHistory.length > maxHistoryLength) {
        return newHistory.slice(-maxHistoryLength)
      }

      return newHistory
    })
  }, [nodes, connections, chainGroups])

  const handleUndo = useCallback(() => {
    if (history.length === 0) {
      return
    }

    const previousState = history[history.length - 1]
    setNodes(previousState.nodes)
    setConnections(previousState.connections)
    setChainGroups(previousState.chainGroups)
    setHistory((prev) => prev.slice(0, -1))
  }, [history])

  const handleEscape = useCallback(() => {
    setSelectedNodes([])
    setConnectingFromId(null)
    setShowNodeMenu(false)
    setShowChainMenu(null)
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        handleEscape()
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        event.preventDefault()
        handleUndo()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleEscape, handleUndo])

  useEffect(() => {
    if (!connectingFromId) {
      return
    }

    function handleMouseMove(event: MouseEvent) {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect()
        setCursorPosition({ x: event.clientX - rect.left, y: event.clientY - rect.top })
      }
    }

    function handleClick() {
      setConnectingFromId(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('click', handleClick)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('click', handleClick)
    }
  }, [connectingFromId])

  const handleDragStart = useCallback(() => {
    saveToHistory()
  }, [saveToHistory])

  const handleDrag = useCallback((id: string, x: number, y: number) => {
    setNodes((prev) => prev.map((node) => (node.id === id ? { ...node, x, y } : node)))
  }, [])

  const handleUpdateNode = useCallback(
    (id: string, updates: Partial<NodeData>) => {
      saveToHistory()
      setNodes((prev) => prev.map((node) => (node.id === id ? { ...node, ...updates } : node)))
    },
    [saveToHistory]
  )

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

  const handleNodeSelect = useCallback((event: React.MouseEvent, nodeId: string) => {
    event.stopPropagation()
    if (event.shiftKey) {
      setSelectedNodes((prev) =>
        prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]
      )
    } else {
      setSelectedNodes([nodeId])
    }
  }, [])

  const handleCanvasContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      if (selectedNodes.length >= 2) {
        setShowChainMenu({ x: event.clientX, y: event.clientY })
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
      const timestamp = Date.now()
      const newNode: NodeData = {
        id: `node-${timestamp}`,
        type,
        name: `node${nodes.length + 1}`,
        x: 150 + Math.random() * 100,
        y: 150 + Math.random() * 100,
        isDetail: false,
        functionName: 'function()',
        returnCode: '',
        connectionPoints: [`node-${timestamp}-point-0`],
      }
      setNodes((prev) => [...prev, newNode])
      setShowNodeMenu(false)
    },
    [nodes.length, saveToHistory]
  )

  const getConnectionPath = (connection: Connection) => {
    const fromNode = nodes.find((node) => node.id === connection.fromNodeId)
    const toNode = nodes.find((node) => node.id === connection.toNodeId)
    if (!fromNode || !toNode) {
      return ''
    }

    const fromX = fromNode.x + (fromNode.isDetail ? 300 : 150)
    const fromY = fromNode.y + (fromNode.isDetail ? 180 : 95)

    const pointIndex = toNode.connectionPoints.indexOf(connection.toPointId)
    const toX = toNode.x + 8
    const toY = toNode.y + 38 + (pointIndex >= 0 ? pointIndex * 16 : 0)

    const midX = (fromX + toX) / 2
    return `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-gray-100">
      <div className="absolute left-4 top-4 z-40 flex gap-2">
        <button
          className="rounded border border-black bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50"
          onClick={() => setShowNodeMenu(!showNodeMenu)}
        >
          + Add Node
        </button>
        {showNodeMenu ? (
          <div className="absolute left-0 top-12 rounded border border-black bg-white shadow-lg">
            {(['action', 'streaming', 'function', 'trigger'] as NodeType[]).map((type) => (
              <button
                key={type}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
                onClick={() => addNode(type)}
              >
                {type}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div
        ref={canvasRef}
        className="relative h-full w-full"
        onClick={() => setSelectedNodes([])}
        onContextMenu={handleCanvasContextMenu}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {connections.map((connection) => (
            <path
              key={connection.id}
              d={getConnectionPath(connection)}
              fill="none"
              stroke="#9898AB"
              strokeWidth={2}
              strokeDasharray="5 3"
            />
          ))}

          {connectingFromId ? (
            <path
              d={(() => {
                const fromNode = nodes.find((node) => node.id === connectingFromId)
                if (!fromNode) {
                  return ''
                }

                const fromX = fromNode.x + (fromNode.isDetail ? 300 : 150)
                const fromY = fromNode.y + (fromNode.isDetail ? 180 : 95)
                const midX = (fromX + cursorPosition.x) / 2
                return `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${cursorPosition.y}, ${cursorPosition.x} ${cursorPosition.y}`
              })()}
              fill="none"
              stroke="#8A38F5"
              strokeWidth={2}
              strokeDasharray="5 5"
            />
          ) : null}
        </svg>

        {chainGroups.map((group) => (
          <ChainGroupFrame key={group.id} group={group} nodes={nodes} />
        ))}

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

      {showChainMenu ? (
        <div
          className="fixed z-50 rounded border border-black bg-white shadow-lg"
          style={{ left: showChainMenu.x, top: showChainMenu.y }}
          onClick={(event) => event.stopPropagation()}
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
      ) : null}

      <div className="absolute bottom-4 left-4 rounded border border-black bg-white px-4 py-3 text-xs">
        <p className="mb-2 font-medium">Legend</p>
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
            <div className="h-3 w-4 border border-black bg-white" />
            <span className="text-gray-500">UI Frame (White)</span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-4 right-4 rounded border border-black bg-white px-4 py-3 text-xs">
        <p className="mb-2 font-medium">Controls</p>
        <div className="space-y-1 text-gray-600">
          <p>
            <b>Drag</b> - Move node
          </p>
          <p>
            <b>Right-click node</b> - Start connection
          </p>
          <p>
            <b>Click connection bar</b> - Connect
          </p>
          <p>
            <b>Click function</b> - Select function
          </p>
          <p>
            <b>+/- button</b> - Toggle detail
          </p>
          <p>
            <b>Shift+Click</b> - Multi-select
          </p>
          <p>
            <b>Right-click canvas</b> - Chain selected
          </p>
        </div>
      </div>
    </div>
  )
}

export default HershyNodeDemo
