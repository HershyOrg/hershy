import { useMemo, useState } from 'react';
import { getActionParams } from '../../data/blockFixtures';
import {
  getProviderCredentials,
  isProviderAuthorized,
  resolveActionAuthRequirement
} from '../../lib/actionAuth';
import {
  DEFAULT_EVM_CHAIN,
  EVM_CHAINS,
  fetchVerifiedContractABI,
  getEVMChainLabel,
  isValidEVMAddress
} from '../../lib/evmChains';

const normalizeFunctionEntry = (entry, index) => {
  const name = typeof entry?.name === 'string' && entry.name.trim()
    ? entry.name.trim()
    : `function_${index + 1}`;
  const stateMutability = typeof entry?.stateMutability === 'string' && entry.stateMutability.trim()
    ? entry.stateMutability.trim()
    : 'nonpayable';
  const inputs = Array.isArray(entry?.inputs)
    ? entry.inputs.map((input, argIndex) => ({
      name: typeof input?.name === 'string' && input.name.trim()
        ? input.name.trim()
        : `arg${argIndex + 1}`,
      type: typeof input?.type === 'string' && input.type.trim()
        ? input.type.trim()
        : 'bytes'
    }))
    : [];
  const signature = typeof entry?.signature === 'string' && entry.signature.trim()
    ? entry.signature.trim()
    : `${name}(${inputs.map((input) => input.type).join(',')})`;

  return {
    name,
    signature,
    stateMutability,
    inputs
  };
};

const toParameterName = (name, index) => (
  typeof name === 'string' && name.trim() ? name.trim() : `arg${index + 1}`
);

const buildEVMParameters = (selectedFunction) => {
  if (!selectedFunction) {
    return [];
  }

  const params = (selectedFunction.inputs || []).map((input, index) => ({
    name: toParameterName(input.name, index),
    value: '',
    placeholder: `${input.type}`,
    source: null,
    sources: []
  }));

  if (selectedFunction.stateMutability === 'payable') {
    params.push({
      name: 'value',
      value: '',
      placeholder: '보낼 ETH (예: 0.01)',
      source: null,
      sources: []
    });
  }

  if (!['view', 'pure'].includes(selectedFunction.stateMutability)) {
    params.push({
      name: 'gasLimit',
      value: '',
      placeholder: '선택 (예: 250000)',
      source: null,
      sources: []
    });
    params.push({
      name: 'maxFeeGwei',
      value: '',
      placeholder: '선택 (예: 30)',
      source: null,
      sources: []
    });
    params.push({
      name: 'maxPriorityFeeGwei',
      value: '',
      placeholder: '선택 (예: 2)',
      source: null,
      sources: []
    });
  }

  return params;
};

export default function ActionBlocksPanel({
  onClose,
  onCreate,
  authState = {},
  onRequestAuth
}) {
  const [actionType, setActionType] = useState('cex');
  const [blockName, setBlockName] = useState('');
  const [exchange, setExchange] = useState('Binance');
  const [dexProtocol, setDexProtocol] = useState('generic');
  const [marketType, setMarketType] = useState('');
  const [token, setToken] = useState('');
  const [executionMode, setExecutionMode] = useState('address');
  const [contractAddress, setContractAddress] = useState('');
  const [contractAbi, setContractAbi] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiPayloadTemplate, setApiPayloadTemplate] = useState('');
  const [evmChain, setEvmChain] = useState(DEFAULT_EVM_CHAIN);
  const [polymarketChainId, setPolymarketChainId] = useState('137');
  const [evmFunctions, setEvmFunctions] = useState([]);
  const [selectedEvmFunctionSig, setSelectedEvmFunctionSig] = useState('');
  const [evmAbiLoading, setEvmAbiLoading] = useState(false);
  const [evmAbiNotice, setEvmAbiNotice] = useState('');
  const evmAuthCredentials = useMemo(
    () => getProviderCredentials(authState, 'evm'),
    [authState]
  );

  const selectedEvmFunction = useMemo(() => (
    evmFunctions.find((fn) => fn.signature === selectedEvmFunctionSig) || null
  ), [evmFunctions, selectedEvmFunctionSig]);
  const evmFunctionParameters = useMemo(
    () => buildEVMParameters(selectedEvmFunction),
    [selectedEvmFunction]
  );

  const parameters = useMemo(() => {
    if (actionType === 'dex' && dexProtocol === 'evm' && executionMode === 'address') {
      if (evmFunctionParameters.length > 0) {
        return evmFunctionParameters;
      }
      return [];
    }
    return getActionParams(actionType, executionMode, dexProtocol);
  }, [actionType, executionMode, dexProtocol, evmFunctionParameters]);

  const authRequirement = useMemo(() => (
    resolveActionAuthRequirement({
      actionType,
      exchange,
      dexProtocol,
      apiUrl
    })
  ), [actionType, exchange, dexProtocol, apiUrl]);
  const isAuthReady = !authRequirement || isProviderAuthorized(authState, authRequirement.id);

  const isEVMAction = actionType === 'dex' && dexProtocol === 'evm' && executionMode === 'address';
  const isPolymarketAction = actionType === 'dex' && dexProtocol === 'polymarket';
  const isEVMReady = !isEVMAction || (
    isValidEVMAddress(contractAddress)
    && contractAbi.trim() !== ''
    && Boolean(selectedEvmFunctionSig)
  );
  const isPolymarketReady = !isPolymarketAction || (Number(polymarketChainId) > 0);
  const canCreate = Boolean(blockName.trim()) && isAuthReady && isEVMReady && isPolymarketReady;

  const handleFetchEVMABI = async () => {
    const address = contractAddress.trim();
    if (!isValidEVMAddress(address)) {
      setEvmAbiNotice('유효한 컨트랙트 주소(0x...)를 입력하세요.');
      return;
    }

    setEvmAbiLoading(true);
    setEvmAbiNotice('');
    try {
      const payload = await fetchVerifiedContractABI({
        chain: evmChain,
        address,
        explorerApiKey: evmAuthCredentials.explorerApiKey || ''
      });
      const normalizedFunctions = Array.isArray(payload?.functions)
        ? payload.functions.map(normalizeFunctionEntry)
        : [];
      if (normalizedFunctions.length === 0) {
        throw new Error('함수 목록이 비어 있습니다.');
      }

      setContractAbi(JSON.stringify(payload.abi || [], null, 2));
      setEvmFunctions(normalizedFunctions);
      setSelectedEvmFunctionSig(normalizedFunctions[0].signature);
      setEvmAbiNotice(`ABI 로드 완료: ${normalizedFunctions.length}개 함수 (${getEVMChainLabel(evmChain)})`);
    } catch (error) {
      setEvmAbiNotice(error?.message || 'ABI 조회 실패');
    } finally {
      setEvmAbiLoading(false);
    }
  };

  const handleCreate = () => {
    if (!canCreate || !onCreate) {
      return;
    }

    const resolvedParameters = parameters.map((param) => {
      if (actionType === 'cex') {
        if (param.name === 'symbol' && token.trim()) {
          return { ...param, value: token.trim() };
        }
        if (param.name === 'marketType' && marketType.trim()) {
          return { ...param, value: marketType.trim() };
        }
      }
      return param;
    });

    onCreate({
      name: blockName.trim(),
      actionType,
      exchange: actionType === 'cex' ? exchange : '',
      dexProtocol: actionType === 'dex' ? dexProtocol : 'generic',
      contractAddress: actionType === 'dex' ? contractAddress.trim() : '',
      contractAbi: actionType === 'dex' ? contractAbi.trim() : '',
      executionMode: actionType === 'dex' ? executionMode : 'address',
      apiUrl: actionType === 'dex' && executionMode === 'api' ? apiUrl.trim() : '',
      apiPayloadTemplate: actionType === 'dex' && executionMode === 'api' ? apiPayloadTemplate : '',
      chainId: isPolymarketAction ? polymarketChainId.trim() : '',
      evmChain: isEVMAction ? evmChain : '',
      evmFunctionName: isEVMAction ? (selectedEvmFunction?.name || '') : '',
      evmFunctionSignature: isEVMAction ? (selectedEvmFunction?.signature || '') : '',
      evmFunctionStateMutability: isEVMAction ? (selectedEvmFunction?.stateMutability || '') : '',
      parameters: resolvedParameters,
      contractAddressSource: null,
      contractAddressSources: []
    });

    setBlockName('');
    setContractAbi('');
  };

  return (
    <div className="overlay-panel">
      <div className="panel-sidebar">
        {/* Panel sidebar icons */}
      </div>

      <div className="panel-content">
        <div className="panel-header">
          <h3 className="panel-title">Action 블록</h3>
        </div>

        <div className="panel-form">
          <div className="form-field">
            <label className="field-label">블록 이름</label>
            <input
              type="text"
              className="field-input"
              placeholder="예: BTC_Buy_Action"
              value={blockName}
              onChange={(event) => setBlockName(event.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="field-label">액션 타입</label>
            <div className="button-group">
              <button
                type="button"
                className={`btn-option tall ${actionType === 'cex' ? 'active' : ''}`}
                onClick={() => setActionType('cex')}
              >
                중앙화 거래소 (CEX)
              </button>
              <button
                type="button"
                className={`btn-option tall ${actionType === 'dex' ? 'active' : ''}`}
                onClick={() => setActionType('dex')}
              >
                스마트 컨트랙트
              </button>
            </div>
          </div>

          {actionType === 'cex' && (
            <>
              <div className="form-field">
                <label className="field-label">거래소</label>
                <select
                  className="field-input"
                  value={exchange}
                  onChange={(event) => setExchange(event.target.value)}
                >
                  <option value="Binance">Binance</option>
                  <option value="Coinbase">Coinbase</option>
                  <option value="Kraken">Kraken</option>
                  <option value="Upbit">Upbit</option>
                </select>
              </div>

              <div className="form-field">
                <label className="field-label">시장 타입</label>
                <input
                  type="text"
                  className="field-input"
                  value={marketType}
                  onChange={(event) => setMarketType(event.target.value)}
                />
              </div>

              <div className="form-field">
                <label className="field-label">토큰</label>
                <input
                  type="text"
                  className="field-input"
                  placeholder="예: BTCUSDT"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
              </div>
            </>
          )}

          {actionType === 'dex' && (
            <>
              <div className="form-field">
                <label className="field-label">DEX 프로토콜</label>
                <select
                  className="field-input"
                  value={dexProtocol}
                  onChange={(event) => {
                    const next = event.target.value;
                    setDexProtocol(next);
                    if (next === 'polymarket') {
                      setExecutionMode('api');
                    }
                    if (next === 'evm') {
                      setExecutionMode('address');
                    }
                  }}
                >
                  <option value="generic">일반 DEX/커스텀</option>
                  <option value="evm">EVM Contract (Web3)</option>
                  <option value="polymarket">Polymarket</option>
                </select>
              </div>

              <div className="form-field">
                <label className="field-label">실행 방식</label>
                <div className="button-group">
                  <button
                    type="button"
                    className={`btn-option ${executionMode === 'address' ? 'active' : ''}`}
                    onClick={() => setExecutionMode('address')}
                  >
                    컨트랙트 주소
                  </button>
                  <button
                    type="button"
                    className={`btn-option ${executionMode === 'api' ? 'active' : ''}`}
                    onClick={() => setExecutionMode('api')}
                    disabled={dexProtocol === 'evm'}
                  >
                    API
                  </button>
                </div>
              </div>

              {dexProtocol === 'polymarket' && (
                <div className="form-field">
                  <label className="field-label">체인 ID</label>
                  <input
                    type="number"
                    className="field-input"
                    value={polymarketChainId}
                    onChange={(event) => setPolymarketChainId(event.target.value)}
                    placeholder="예: 137"
                  />
                </div>
              )}

              {executionMode === 'address' && dexProtocol === 'evm' && (
                <>
                  <div className="form-field">
                    <label className="field-label">체인</label>
                    <select
                      className="field-input"
                      value={evmChain}
                      onChange={(event) => setEvmChain(event.target.value)}
                    >
                      {EVM_CHAINS.map((chain) => (
                        <option key={chain.id} value={chain.id}>{chain.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label className="field-label">컨트랙트 주소</label>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="0x..."
                      value={contractAddress}
                      onChange={(event) => setContractAddress(event.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <button
                      type="button"
                      className="strategy-tool-btn host"
                      onClick={handleFetchEVMABI}
                      disabled={evmAbiLoading}
                    >
                      {evmAbiLoading ? 'ABI 조회 중...' : '검증된 ABI/함수 불러오기'}
                    </button>
                    {evmAbiNotice && (
                      <div className="strategy-feedback-issue warn">{evmAbiNotice}</div>
                    )}
                  </div>

                  <div className="form-field">
                    <label className="field-label">함수 선택</label>
                    <select
                      className="field-input"
                      value={selectedEvmFunctionSig}
                      onChange={(event) => setSelectedEvmFunctionSig(event.target.value)}
                    >
                      <option value="">함수를 선택하세요</option>
                      {evmFunctions.map((fn) => (
                        <option key={fn.signature} value={fn.signature}>
                          {fn.name} ({fn.stateMutability})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label className="field-label">ABI</label>
                    <textarea
                      className="field-textarea"
                      placeholder="ABI JSON을 입력하세요"
                      value={contractAbi}
                      onChange={(event) => setContractAbi(event.target.value)}
                    />
                  </div>
                </>
              )}

              {executionMode === 'address' && dexProtocol !== 'evm' && (
                <>
                  <div className="form-field">
                    <label className="field-label">컨트랙트 주소 (선택)</label>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="0x..."
                      value={contractAddress}
                      onChange={(event) => setContractAddress(event.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label className="field-label">ABI (선택)</label>
                    <textarea
                      className="field-textarea"
                      placeholder="ABI JSON을 입력하세요"
                      value={contractAbi}
                      onChange={(event) => setContractAbi(event.target.value)}
                    />
                  </div>
                </>
              )}

              {executionMode === 'api' && (
                <>
                  <div className="form-field">
                    <label className="field-label">API URL</label>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="https://api.example.com/tx"
                      value={apiUrl}
                      onChange={(event) => setApiUrl(event.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label className="field-label">JSON 구조</label>
                    <textarea
                      className="field-textarea"
                      placeholder={'{\n  \"to\": \"{{to}}\",\n  \"amount\": \"{{amount}}\"\n}'}
                      value={apiPayloadTemplate}
                      onChange={(event) => setApiPayloadTemplate(event.target.value)}
                    />
                  </div>
                </>
              )}
            </>
          )}

          <div className="field-preview">
            <span className="field-preview-label">파라미터 목록</span>
            <div className="field-preview-list">
              {parameters.map((param) => (
                <span key={param.name} className="field-preview-tag">{param.name}</span>
              ))}
              {parameters.length === 0 && (
                <span className="field-preview-tag">함수 선택 후 자동 생성</span>
              )}
            </div>
          </div>

          {!isAuthReady && authRequirement && (
            <div className="strategy-feedback-issue warn">
              {authRequirement.label} 사전인증이 필요합니다.
              {' '}
              <button
                type="button"
                className="strategy-tool-btn"
                onClick={onRequestAuth}
              >
                사전인증 탭 열기
              </button>
            </div>
          )}
          {!isEVMReady && isEVMAction && (
            <div className="strategy-feedback-issue warn">
              EVM 함수 실행을 위해 체인/컨트랙트/ABI/함수를 모두 설정하세요.
            </div>
          )}
          {!isPolymarketReady && isPolymarketAction && (
            <div className="strategy-feedback-issue warn">
              Polymarket 액션 실행을 위해 유효한 체인 ID를 입력하세요.
            </div>
          )}

          <button
            type="button"
            className={`btn-create ${canCreate ? '' : 'disabled'}`}
            disabled={!canCreate}
            onClick={handleCreate}
          >
            블록 생성
          </button>
        </div>
      </div>
    </div>
  );
}
