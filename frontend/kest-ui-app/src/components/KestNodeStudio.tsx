import { useMemo, useState } from 'react'

type FlowNode = {
  id: string
  title: string
  functionName: string
  outputs: string[]
}

function PaleInput({
  value,
  onChange,
  className = '',
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
  placeholder?: string
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={`rounded-2xl border border-[#ead47a] bg-[#fff4b8] px-3 py-2 text-sm font-medium text-[#6e5612] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] outline-none transition focus:border-[#d7b63f] focus:ring-4 focus:ring-[#ffe58f]/60 ${className}`}
    />
  )
}

function PaleTextarea({
  value,
  onChange,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`w-full resize-none rounded-[24px] border border-[#ead47a] bg-[#fff7cc] px-4 py-3 text-sm leading-6 text-[#5f5124] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] outline-none transition focus:border-[#d7b63f] focus:ring-4 focus:ring-[#ffe58f]/60 ${className}`}
    />
  )
}

function CompactNodeCard({
  title,
  onTitleChange,
  functionName,
  onFunctionChange,
  outputs,
  onOutputChange,
  highlightedOutput,
  showInputPort = false,
}: {
  title: string
  onTitleChange: (value: string) => void
  functionName: string
  onFunctionChange: (value: string) => void
  outputs: string[]
  onOutputChange: (index: number, value: string) => void
  highlightedOutput?: number
  showInputPort?: boolean
}) {
  return (
    <div className="relative rounded-[28px] border border-[#d7dde8] bg-white/92 p-4 shadow-[0_20px_45px_rgba(15,23,42,0.08)]">
      {showInputPort ? (
        <div className="absolute left-[-7px] top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-[#91a3ff] bg-white shadow-sm" />
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <PaleInput
          value={title}
          onChange={onTitleChange}
          className="w-36 text-xs font-semibold"
        />
        <div className="rounded-full bg-[#f3f5f8] px-3 py-1 text-xs font-semibold text-slate-500">
          Node
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-4">
        <div className="rounded-[22px] border border-[#d9dee8] bg-[#fbfcfe] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
          <div className="flex items-center gap-3">
            <div className="h-2.5 w-2.5 rounded-full bg-[#111827]" />
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              Function
            </span>
          </div>
          <PaleInput
            value={functionName}
            onChange={onFunctionChange}
            className="mt-3 w-full bg-white px-0 py-0 text-lg font-semibold text-slate-800 shadow-none ring-0 focus:ring-0"
          />
          <div className="mt-2 text-sm text-slate-400">=&gt;</div>
        </div>

        <div className="space-y-2">
          {outputs.map((output, index) => (
            <PaleInput
              key={`${title}-${index}`}
              value={output}
              onChange={(value) => onOutputChange(index, value)}
              className={`w-28 text-xs ${
                highlightedOutput === index
                  ? 'border-[#aab7ff] ring-4 ring-[#dce3ff]'
                  : ''
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function KestNodeStudio() {
  const [nodeName, setNodeName] = useState('노드 이름')
  const [functionName, setFunctionName] = useState('function()')
  const [parameters, setParameters] = useState([
    'Param 1',
    'Param 2',
    'Param 3',
    'Param 4',
  ])
  const [detailTitle, setDetailTitle] = useState('Param 01')
  const [detailBody, setDetailBody] = useState(
    '선택된 함수가 어떤 문장을 만들고, 어떤 결과를 반환하는지 이 영역에서 정리합니다.'
  )
  const [detailNotes, setDetailNotes] = useState(
    '텍스트 생성, 그림 설명, 출력 포맷처럼 함수 설명을 채우는 상세 노트 영역입니다.'
  )
  const [returns, setReturns] = useState(['param 1', 'param 2'])
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([
    {
      id: 'source',
      title: '노드 이름',
      functionName: '[function()]',
      outputs: ['Param 1', 'Param 2'],
    },
    {
      id: 'target',
      title: '노드 이름',
      functionName: '[function()]',
      outputs: ['Param 3', 'Param 4'],
    },
  ])
  const [selectedOutput, setSelectedOutput] = useState(0)

  const selectedToken = flowNodes[0]?.outputs[selectedOutput] ?? 'Param 1'

  const connectionSummary = useMemo(
    () =>
      `${flowNodes[0].functionName}에서 만든 ${selectedToken}이 다음 노드 입력으로 이어집니다.`,
    [flowNodes, selectedOutput, selectedToken]
  )

  function updateParameter(index: number, value: string) {
    setParameters((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? value : item))
    )
  }

  function updateReturn(index: number, value: string) {
    setReturns((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? value : item))
    )
  }

  function updateFlowNode(
    nodeId: string,
    field: 'title' | 'functionName',
    value: string
  ) {
    setFlowNodes((current) =>
      current.map((node) =>
        node.id === nodeId ? { ...node, [field]: value } : node
      )
    )
  }

  function updateFlowOutput(nodeId: string, index: number, value: string) {
    setFlowNodes((current) =>
      current.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              outputs: node.outputs.map((item, itemIndex) =>
                itemIndex === index ? value : item
              ),
            }
          : node
      )
    )
  }

  return (
    <main className="min-h-screen px-4 py-6 text-slate-900 sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 rounded-[34px] border border-white/80 bg-white/72 px-6 py-5 shadow-[0_28px_70px_rgba(15,23,42,0.08)] backdrop-blur-2xl lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#d8dfef] bg-[#f7f9fc] px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              Kest Concept
              <span className="h-1.5 w-1.5 rounded-full bg-[#91a3ff]" />
              Apple Style
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-5xl">
                Node Flow Studio
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 sm:text-base">
                PDF 스케치의 흰 프레임을 실제 UI 카드로, 노란 박스는 직접 수정할 수
                있는 입력값으로 옮겼습니다. 함수 상세 패널과 간선 연결 보드까지 한
                화면에서 편집할 수 있게 정리했습니다.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['편집 가능 토큰', '8'],
              ['연결된 노드', '2'],
              ['리턴 값', returns.length.toString()],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-[24px] border border-[#dde3ee] bg-[#fbfcfe] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
              >
                <div className="text-sm text-slate-500">{label}</div>
                <div className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-slate-950">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[34px] border border-white/80 bg-white/78 p-5 shadow-[0_30px_75px_rgba(15,23,42,0.08)] backdrop-blur-2xl sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">
                  Action Node
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  상단 스케치의 큰 액션 노드를 Apple-style 편집 캔버스로 옮긴 영역입니다.
                </p>
              </div>
              <div className="rounded-full border border-[#d9dfeb] bg-[#f8faff] px-3 py-1 text-xs font-semibold text-slate-500">
                Editable Tokens
              </div>
            </div>

            <div className="mt-5 rounded-[32px] border border-[#dde3ee] bg-[linear-gradient(180deg,_rgba(255,255,255,0.95)_0%,_rgba(246,248,252,0.96)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
              <div className="relative overflow-hidden rounded-[28px] border border-[#d9dee8] bg-[#f9fbff] p-5 shadow-[0_18px_32px_rgba(15,23,42,0.05)]">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top,_rgba(170,186,255,0.2),_transparent_70%)]" />

                <PaleInput
                  value={nodeName}
                  onChange={setNodeName}
                  className="relative z-10 w-36 text-xs font-semibold"
                />

                <div className="relative mt-5 h-[350px] rounded-[26px] border border-[#d8dee9] bg-white/85 px-4 py-5">
                  <svg
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <path
                      d="M22 18 L50 48"
                      stroke="#c3cad8"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                    <path
                      d="M78 18 L50 48"
                      stroke="#c3cad8"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                    <path
                      d="M22 82 L50 52"
                      stroke="#c3cad8"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                    <path
                      d="M78 82 L50 52"
                      stroke="#c3cad8"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                    <path
                      d="M50 50 C68 50 72 50 88 50"
                      stroke="#aab7ff"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </svg>

                  <div className="relative grid h-full grid-cols-3 grid-rows-3 items-center">
                    <PaleInput
                      value={parameters[0]}
                      onChange={(value) => updateParameter(0, value)}
                      className="w-24 justify-self-start self-start text-center"
                    />
                    <PaleInput
                      value={parameters[1]}
                      onChange={(value) => updateParameter(1, value)}
                      className="w-24 justify-self-end self-start text-center"
                    />
                    <PaleInput
                      value={parameters[2]}
                      onChange={(value) => updateParameter(2, value)}
                      className="w-24 justify-self-start self-end text-center"
                    />
                    <PaleInput
                      value={parameters[3]}
                      onChange={(value) => updateParameter(3, value)}
                      className="w-24 justify-self-end self-end text-center"
                    />

                    <div className="col-start-2 row-start-2 flex w-full max-w-[240px] flex-col justify-self-center rounded-[28px] border border-[#d8deea] bg-white px-4 py-4 text-center shadow-[0_16px_30px_rgba(15,23,42,0.08)]">
                      <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                        Function
                      </span>
                      <PaleInput
                        value={functionName}
                        onChange={setFunctionName}
                        className="mt-2 w-full bg-white px-0 py-0 text-center text-xl font-semibold text-slate-900 shadow-none"
                      />
                    </div>

                    <div className="col-start-3 row-start-2 ml-6 hidden self-center xl:block">
                      <div className="rounded-[24px] border border-[#d9dfeb] bg-white px-4 py-3 shadow-[0_12px_24px_rgba(15,23,42,0.06)]">
                        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                          Inspector Link
                        </div>
                        <div className="mt-2 text-sm font-medium text-slate-600">
                          function detail
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[0.88fr_1.12fr]">
                <div className="rounded-[26px] border border-[#dbe1ec] bg-white px-4 py-4 shadow-[0_14px_28px_rgba(15,23,42,0.05)]">
                  <div className="text-sm font-semibold text-slate-600">
                    Compact Preview
                  </div>
                  <div className="mt-3">
                    <CompactNodeCard
                      title={nodeName}
                      onTitleChange={setNodeName}
                      functionName={`[${functionName}]`}
                      onFunctionChange={(value) =>
                        setFunctionName(value.replace(/^\[|\]$/g, ''))
                      }
                      outputs={parameters.slice(0, 2)}
                      onOutputChange={updateParameter}
                    />
                  </div>
                </div>

                <div className="rounded-[26px] border border-[#dbe1ec] bg-[#fbfcfe] px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                  <div className="text-sm font-semibold text-slate-600">
                    Selected Output
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {flowNodes[0].outputs.map((token, index) => (
                      <button
                        key={`${token}-${index}`}
                        type="button"
                        onClick={() => setSelectedOutput(index)}
                        className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                          selectedOutput === index
                            ? 'border-[#aab7ff] bg-[#eef1ff] text-[#3f57bf] shadow-sm'
                            : 'border-[#e4e8ef] bg-white text-slate-500'
                        }`}
                      >
                        {token}
                      </button>
                    ))}
                  </div>
                  <p className="mt-4 text-sm leading-6 text-slate-500">
                    현재 선택된 출력 토큰은 <span className="font-semibold text-slate-900">{selectedToken}</span>
                    이고, 하단 플로우 보드에서 다음 노드로 연결됩니다.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <aside className="rounded-[34px] border border-white/80 bg-white/78 p-5 shadow-[0_30px_75px_rgba(15,23,42,0.08)] backdrop-blur-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">
                  Function Detail
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  스케치 우측 패널의 설명 영역을 함수 상세 인스펙터로 옮겼습니다.
                </p>
              </div>
              <div className="rounded-full border border-[#dce2ed] bg-[#f8faff] px-3 py-1 text-xs font-semibold text-slate-500">
                Live Inspector
              </div>
            </div>

            <div className="mt-5 space-y-4 rounded-[30px] border border-[#dbe1ec] bg-[linear-gradient(180deg,_rgba(255,255,255,0.98)_0%,_rgba(247,249,252,0.98)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
              <div>
                <label className="text-sm font-semibold text-slate-600">
                  Detail Title
                </label>
                <PaleInput
                  value={detailTitle}
                  onChange={setDetailTitle}
                  className="mt-2 w-full"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-600">
                  Description
                </label>
                <PaleTextarea
                  value={detailBody}
                  onChange={setDetailBody}
                  className="mt-2 h-28"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-600">
                  Notes
                </label>
                <PaleTextarea
                  value={detailNotes}
                  onChange={setDetailNotes}
                  className="mt-2 h-32"
                />
              </div>

              <div className="rounded-[24px] border border-[#dce2ed] bg-white px-4 py-4">
                <div className="text-sm font-semibold text-slate-600">Return</div>
                <div className="mt-3 flex flex-wrap gap-3">
                  {returns.map((item, index) => (
                    <PaleInput
                      key={`${item}-${index}`}
                      value={item}
                      onChange={(value) => updateReturn(index, value)}
                      className="w-28"
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] border border-[#dfe5ef] bg-[#fbfcfe] px-4 py-4">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                  Inspector Summary
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  {functionName}는 {detailTitle}을 기준으로 작동하며, 최종적으로{' '}
                  <span className="font-semibold text-slate-900">
                    {returns.join(', ')}
                  </span>
                  를 반환합니다.
                </p>
              </div>
            </div>
          </aside>
        </div>

        <section className="rounded-[34px] border border-white/80 bg-white/78 p-5 shadow-[0_30px_75px_rgba(15,23,42,0.08)] backdrop-blur-2xl sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">
                Flow Board
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                하단 스케치의 연결된 노드 카드 흐름을 실제 플로우 보드로 구성했습니다.
              </p>
            </div>
            <div className="rounded-full border border-[#dce2ed] bg-[#f8faff] px-4 py-2 text-sm font-semibold text-slate-600">
              {connectionSummary}
            </div>
          </div>

          <div className="mt-5 rounded-[32px] border border-[#dde3ee] bg-[linear-gradient(180deg,_rgba(251,252,255,0.98)_0%,_rgba(245,247,251,0.98)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] sm:p-6">
            <div className="rounded-[28px] border border-[#dbe1ec] bg-[radial-gradient(circle_at_top,_rgba(170,186,255,0.12),_transparent_30%),linear-gradient(180deg,_rgba(255,255,255,0.98)_0%,_rgba(247,249,252,0.98)_100%)] p-4 sm:p-6">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)] lg:items-center">
                <CompactNodeCard
                  title={flowNodes[0].title}
                  onTitleChange={(value) =>
                    updateFlowNode(flowNodes[0].id, 'title', value)
                  }
                  functionName={flowNodes[0].functionName}
                  onFunctionChange={(value) =>
                    updateFlowNode(flowNodes[0].id, 'functionName', value)
                  }
                  outputs={flowNodes[0].outputs}
                  onOutputChange={(index, value) =>
                    updateFlowOutput(flowNodes[0].id, index, value)
                  }
                  highlightedOutput={selectedOutput}
                />

                <div className="relative hidden h-40 lg:block">
                  <svg
                    className="absolute inset-0 h-full w-full"
                    viewBox="0 0 140 160"
                    fill="none"
                  >
                    <path
                      d="M0 58 C40 58 46 58 70 80"
                      stroke="#b7c3ff"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <path
                      d="M0 108 C40 108 46 108 70 80"
                      stroke="#c9d2f4"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <path
                      d="M70 80 C100 80 110 80 140 80"
                      stroke="#91a3ff"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#dce2ef] bg-white px-3 py-2 text-xs font-semibold text-[#5368d9] shadow-[0_12px_20px_rgba(15,23,42,0.08)]">
                    {selectedToken}
                  </div>
                </div>

                <CompactNodeCard
                  title={flowNodes[1].title}
                  onTitleChange={(value) =>
                    updateFlowNode(flowNodes[1].id, 'title', value)
                  }
                  functionName={flowNodes[1].functionName}
                  onFunctionChange={(value) =>
                    updateFlowNode(flowNodes[1].id, 'functionName', value)
                  }
                  outputs={flowNodes[1].outputs}
                  onOutputChange={(index, value) =>
                    updateFlowOutput(flowNodes[1].id, index, value)
                  }
                  showInputPort
                />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                {[
                  ['입력으로 사용되는 값', selectedToken],
                  ['시작 노드 함수', flowNodes[0].functionName],
                  ['도착 노드 함수', flowNodes[1].functionName],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-[24px] border border-[#dce2ed] bg-white px-4 py-4"
                  >
                    <div className="text-sm text-slate-500">{label}</div>
                    <div className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
