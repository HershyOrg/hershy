import React, { useState, useEffect } from "react";
import { NodeProps, useReactFlow } from "@xyflow/react";
import { Info, X, Edit2, Check, Sparkles } from "lucide-react";

// 그룹(시퀀스)인지 개별 단위 노드인지에 따라 설명을 구분해서 생성합니다.
// v2 델타 뉴트럴 이자 농사(Yield Farming) 도메인에 맞춤형으로 작성되었습니다.
const generateMockExplanation = (label: string = "", isGroup: boolean) => {
  const lowerLabel = label.toLowerCase();
  
  // 1. 그룹(시퀀스/전략)에 대한 설명: 전체 전략 자체의 역할을 설명
  if (isGroup) {
    if (lowerLabel.includes("유동성") || lowerLabel.includes("lp") || lowerLabel.includes("공급") || lowerLabel.includes("v2")) {
      return "이 시퀀스는 DEX(v2) 라우터와 상호작용하여 자산 쌍을 유동성 풀에 예치하고, 거래 수수료 기반의 타겟 APR(연이율) 기저 수익을 창출하는 [v2 유동성 공급 메인 파이프라인]입니다.";
    }
    if (lowerLabel.includes("헤지") || lowerLabel.includes("hedge") || lowerLabel.includes("숏") || lowerLabel.includes("short")) {
      return "이 시퀀스는 LP 공급 중 발생하는 주자산의 가격 변동(및 비영구적 손실) 리스크를 완전히 상쇄하는 [델타 뉴트럴 헤징 파이프라인]입니다.\n\n오라클의 데이터를 바탕으로 공급된 변동 자산의 수량만큼 거래소에서 즉각 숏(Short) 포지션을 구축하여, 가격 등락에 관계없이 안정적인 이자 농사 구역을 만듭니다.";
    }
    if (lowerLabel.includes("리밸런싱") || lowerLabel.includes("rebalance") || lowerLabel.includes("조정")) {
      return "이 시퀀스는 자산 가격 변화로 인해 풀 내부의 자산 비율이 틀어질 때마다 헤지 비율을 0으로 맞추는 [델타 리밸런싱 관리 파이프라인]입니다.\n\n숏 포지션 규모를 자동으로 증감시켜 무위험(Risk-free)에 가까운 상태를 지속 통제합니다.";
    }
    if (lowerLabel.includes("농사") || lowerLabel.includes("farm") || lowerLabel.includes("yield") || lowerLabel.includes("보상")) {
      return "이 시퀀스는 예치 후 수령한 LP 토큰을 추가 팜(Farm) 등에 스테이킹하여 프로토콜 보상 거버넌스 토큰을 얻는 [추가 수익률 부스팅(Farming)] 파이프라인입니다.";
    }
    return `이 시퀀스는 전체 이자 농사 아키텍처 내에서 «${label}» 작동을 매니징하는 [독립적 구조의 서브 파이프라인]입니다.\n\n트리거부터 온체인 트랜잭션 집행, 헤지 관리까지 하나의 완결된 디파이(DeFi) 논리 흐름을 책임집니다.`;
  }

  // 2. 개별 노드에 대한 설명: 해당 노드가 전체 전략 속에서 "어떤 부분/역할을 담당하는지" 요약
  if (lowerLabel.includes("스왑") || lowerLabel.includes("swap") || lowerLabel.includes("환전")) {
    return `전체 파이프라인 내에서 🔄[토큰 비율 맞춤형 온체인 스왑] 역할을 담당합니다.\n\nv2 풀에 유동성 예치(50:50) 전, 비율이 모자란 잉여 자산을 타겟 자산으로 전환하는 트랜잭션을 스마트 컨트랙트에 요청합니다.`;
  }
  if (lowerLabel.includes("공급") || lowerLabel.includes("mint") || lowerLabel.includes("add") || lowerLabel.includes("예치")) {
    return `전체 파이프라인 내에서 💧[유동성 풀 덧붙이기(Add Liquidity)] 역할을 담당합니다.\n\nDEX 스마트 컨트랙트를 호출하여 실제 온체인 풀에 토큰을 투입하고 그 증명으로 LP 토큰을 지갑에 받아오는 가장 최종적인 액션입니다.`;
  }
  if (lowerLabel.includes("숏") || lowerLabel.includes("short") || lowerLabel.includes("매도") || lowerLabel.includes("cex")) {
    return `전체 파이프라인 내에서 🛡️[변동성 상쇄를 위한 능동 방어 주문] 역할을 담당합니다.\n\nAPI를 통해 파생 거래소(CEX/Perp)에 온체인의 변동 자산 몫과 일차하는 크기의 숏(Short) 사이즈를 시장가로 오픈시킵니다.`;
  }
  if (lowerLabel.includes("트리거") || lowerLabel.includes("조건") || lowerLabel.includes("if") || lowerLabel.includes("가격") || lowerLabel.includes("비율")) {
    return `전체 파이프라인 내에서 🏁[온오프체인 데이터 감시 및 진입 통제] 역할을 담당합니다.\n\n현재 유동성 풀 비율, 호가 스프레드, 혹은 펀딩비 조건이 타겟 APR 이자 농사를 시작(혹은 청산)하기 적합한 기준을 만족하는지 파악하는 진입점 역할을 합니다.`;
  }
  if (lowerLabel.includes("모니터링") || lowerLabel.includes("monitor") || lowerLabel.includes("pnl") || lowerLabel.includes("수익")) {
    return `전체 파이프라인 내에서 🚨[전체 델타 포지션 및 팜 헬스 감시] 역할을 담당합니다.\n\n숏 포지션 마진(청산 위험도)과 누적된 유동성 수수료 수익 지표를 지속 크롤링하며, 임계치가 깨질 경우 즉각 리밸런싱 명령 노드를 작동시킵니다.`;
  }
  
  return `전체 파이프라인 내에서 ⚙️[데이터 가공 및 온/오프체인 통신 분기] 역할을 담당합니다.\n\n상위 경로로부터 넘어온 지갑 가용 자본금, 풀 상태 데이터 등을 연산하여 어느 컨트랙트를 호출하고 API를 날릴지 하위 파이프라인으로 흐름을 이어주는 브릿지입니다.`;
};

export function withExplanation(WrappedComponent: React.ComponentType<any>) {
  return function ExplanationWrapper(props: any) {
    const { id, selected, data, type } = props;
    const { setNodes } = useReactFlow();
    const [manualShow, setManualShow] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState("");

    // 노드의 선택(focus)이 해제되면 수동으로 띄운 팝업도 초기화시킵 니다.
    useEffect(() => {
      if (!selected) {
        setManualShow(false);
        setIsEditing(false);
      }
    }, [selected]);

    // 그룹 노드인지 판별 (groupNode 이면 = 전략/시퀀스)
    const isGroup = type === "groupNode";
    
    // 팝업이 뜨는 조건:
    // 그룹 노드 = 선택 시 즉시 표출
    // 개별 노드 = 선택 시 버튼이 나오고, 해당 버튼을 클릭해야(manualShow === true) 표출
    const showPopup = isGroup ? selected : (selected && manualShow);

    // label for title
    const label = data?.label || data?.functionName || data?.name || "이 항목";
    // explanation text depending on node type & label keywords
    const explanation = data?.explanation || generateMockExplanation(label, isGroup);

    const handleSave = (e: React.MouseEvent) => {
      e.stopPropagation();
      setNodes((nds) => 
        nds.map((n) => 
          n.id === id ? { ...n, data: { ...n.data, explanation: editText } } : n
        )
      );
      setIsEditing(false);
    };

    const handleAiSummary = (e: React.MouseEvent) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent("aiExplainGroup", { detail: { groupId: id, label } }));
    };

    return (
      <>
        <WrappedComponent {...props} />

        {/* 1. 개별 노드용 설명(Info) 버튼 - 그룹이 아닐 때만 뜹니다. */}
        {selected && !isGroup && !manualShow && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setManualShow(true);
            }}
            className="absolute -top-3 -right-3 z-[110] p-1.5 bg-blue-500 text-white rounded-full shadow-md hover:bg-blue-600 transition-colors pointer-events-auto"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        )}

        {/* 2. 말풍선 팝업 패널 */}
        {showPopup && (
          <div className="absolute top-1/2 left-full -translate-y-1/2 translate-x-4 w-[340px] bg-white/95 backdrop-blur-sm border border-slate-200/80 rounded-xl shadow-xl z-[120] p-4 text-sm pointer-events-auto nodrag nowheel cursor-default">
            <div className="absolute top-1/2 -left-2 -translate-y-1/2 border-y-[6px] border-y-transparent border-r-[8px] border-r-white" />
            
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-slate-800 text-xs text-indigo-700 bg-indigo-50 px-2 py-1 rounded-md max-w-[140px] truncate">
                {isGroup ? `[시퀀스] ${label}` : `[노드] ${label}`}
              </h4>
              <div className="flex items-center gap-1">
                {isGroup && !isEditing && (
                  <button
                    onClick={handleAiSummary}
                    className="flex items-center gap-1 text-[10px] bg-indigo-100 text-indigo-600 hover:bg-indigo-200 px-1.5 py-1 rounded transition-colors"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>AI 요약</span>
                  </button>
                )}
                {!isEditing && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditText(explanation);
                      setIsEditing(true);
                    }}
                    className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1 rounded transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                )}
                {isEditing && (
                  <button
                    onClick={handleSave}
                    className="text-green-500 hover:text-green-700 hover:bg-green-50 p-1 rounded transition-colors"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                )}
                {/* 개별 노드는 팝업을 다시 끌 수 있는 X 버튼 활성화 */}
                {!isGroup && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setManualShow(false);
                      setIsEditing(false);
                    }}
                    className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1 rounded transition-colors ml-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            
            {isEditing ? (
              <textarea 
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full text-[13px] p-2 border border-slate-300 rounded focus:outline-none focus:border-indigo-500 resize-none h-32"
                autoFocus
              />
            ) : (
              <p className="text-slate-600 leading-relaxed text-[13px] whitespace-pre-wrap word-break flex flex-col gap-2">
                {explanation}
              </p>
            )}
          </div>
        )}
      </>
    );
  };
}
