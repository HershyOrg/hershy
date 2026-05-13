import { useState } from 'react';
import { generateStrategyDraft } from '../lib/strategyAssistant';
import { getProviderCredentials } from '../lib/actionAuth';

const FRONT_AI_ENDPOINT = '/api/ai/strategy-draft';
const DEFAULT_AI_PROMPT = 'BTCUSDT 1시간 마켓 전략으로 만들어줘. 최근 가격 기준 상단/하단 임계값을 자동 추정하고, 1시간 내 단기 돌파는 매수, 이탈은 매도하도록 구성해줘.';

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

export default function useStrategyAI({
  activeTabId,
  activeActionAuth,
  compileActiveStrategy,
  applyStrategyToActiveTab,
  validateStrategyDefinition,
  setStrategyReport,
  setNotice
}) {
  const [aiPrompt, setAiPrompt] = useState(DEFAULT_AI_PROMPT);
  const [aiNotice, setAiNotice] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

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

  return {
    aiPrompt,
    setAiPrompt,
    aiNotice,
    aiBusy,
    aiPanelOpen,
    setAiPanelOpen,
    handleGenerateAIStrategy,
    resetAiPrompt: () => setAiPrompt(DEFAULT_AI_PROMPT)
  };
}
