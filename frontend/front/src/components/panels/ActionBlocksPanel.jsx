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
import {
  DEFAULT_CEX_TRADE_EXCHANGE,
  SUPPORTED_CEX_TRADE_EXCHANGES,
  isPolymarketExchangeName
} from '../../lib/exchangeCatalog.mjs';
import {
  buildPolymarketParams,
  DEFAULT_POLYMARKET_CHAIN_ID,
  POLYMARKET_ORDER_TYPE_OPTIONS,
  POLYMARKET_SIDE_OPTIONS
} from '../../lib/polymarketTrade';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select } from '../ui/select';

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
  const [exchange, setExchange] = useState(DEFAULT_CEX_TRADE_EXCHANGE);
  const [dexProtocol, setDexProtocol] = useState('generic');
  const [marketType, setMarketType] = useState('');
  const [token, setToken] = useState('');
  const [executionMode, setExecutionMode] = useState('address');
  const [contractAddress, setContractAddress] = useState('');
  const [contractAbi, setContractAbi] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiPayloadTemplate, setApiPayloadTemplate] = useState('');
  const [evmChain, setEvmChain] = useState(DEFAULT_EVM_CHAIN);
  const [polymarketChainId, setPolymarketChainId] = useState(DEFAULT_POLYMARKET_CHAIN_ID);
  const [polymarketMarketTitle, setPolymarketMarketTitle] = useState('');
  const [polymarketOutcomeLabel, setPolymarketOutcomeLabel] = useState('');
  const [polymarketTokenId, setPolymarketTokenId] = useState('');
  const [polymarketSide, setPolymarketSide] = useState('BUY');
  const [polymarketPrice, setPolymarketPrice] = useState('');
  const [polymarketSize, setPolymarketSize] = useState('');
  const [polymarketOrderType, setPolymarketOrderType] = useState('GTC');
  const [polymarketPostOnly, setPolymarketPostOnly] = useState(false);
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
    const isPolymarketExchange = actionType === 'cex' && isPolymarketExchangeName(exchange);
    if (isPolymarketExchange || (actionType === 'dex' && dexProtocol === 'polymarket')) {
      return buildPolymarketParams({
        tokenId: polymarketTokenId.trim(),
        side: polymarketSide,
        price: polymarketPrice.trim(),
        size: polymarketSize.trim(),
        orderType: polymarketOrderType,
        postOnly: polymarketPostOnly,
      });
    }
    if (actionType === 'dex' && dexProtocol === 'evm' && executionMode === 'address') {
      if (evmFunctionParameters.length > 0) {
        return evmFunctionParameters;
      }
      return [];
    }
    return getActionParams(actionType, executionMode, dexProtocol);
  }, [
    actionType,
    executionMode,
    dexProtocol,
    evmFunctionParameters,
    exchange,
    polymarketOrderType,
    polymarketPostOnly,
    polymarketPrice,
    polymarketSide,
    polymarketSize,
    polymarketTokenId,
  ]);

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
  const isPolymarketAction = (actionType === 'cex' && isPolymarketExchangeName(exchange))
    || (actionType === 'dex' && dexProtocol === 'polymarket');
  const isPolymarketTradeConfigured = !isPolymarketAction || (
    Boolean(polymarketTokenId.trim())
    && Number(polymarketPrice) > 0
    && Number(polymarketSize) > 0
  );
  const isEVMReady = !isEVMAction || (
    isValidEVMAddress(contractAddress)
    && contractAbi.trim() !== ''
    && Boolean(selectedEvmFunctionSig)
  );
  const isPolymarketReady = !isPolymarketAction || (Number(polymarketChainId) > 0);
  const canCreate = Boolean(blockName.trim()) && isAuthReady && isEVMReady && isPolymarketReady && isPolymarketTradeConfigured;

  const selectCEXAction = () => {
    setActionType('cex');
  };

  const selectContractAction = () => {
    setActionType('dex');
    if (dexProtocol === 'polymarket') {
      setDexProtocol('generic');
      setExecutionMode('address');
    }
  };

  const handleExchangeChange = (event) => {
    const nextExchange = event.target.value;
    setExchange(nextExchange);
    if (isPolymarketExchangeName(nextExchange)) {
      setDexProtocol('polymarket');
      setExecutionMode('api');
      setApiUrl('https://clob.polymarket.com');
      if (!blockName.trim()) {
        setBlockName('Polymarket_Trade_Action');
      }
      return;
    }
    if (dexProtocol === 'polymarket') {
      setDexProtocol('generic');
      setExecutionMode('address');
      setApiUrl('');
    }
  };

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
      dexProtocol: isPolymarketAction ? 'polymarket' : actionType === 'dex' ? dexProtocol : 'generic',
      polymarketMarketTitle: isPolymarketAction ? polymarketMarketTitle.trim() : '',
      polymarketOutcomeLabel: isPolymarketAction ? polymarketOutcomeLabel.trim() : '',
      contractAddress: actionType === 'dex' ? contractAddress.trim() : '',
      contractAbi: actionType === 'dex' ? contractAbi.trim() : '',
      executionMode: isPolymarketAction ? 'api' : actionType === 'dex' ? executionMode : 'address',
      apiUrl: isPolymarketAction
        ? 'https://clob.polymarket.com'
        : actionType === 'dex' && executionMode === 'api'
          ? apiUrl.trim()
          : '',
      apiPayloadTemplate: isPolymarketAction
        ? ''
        : actionType === 'dex' && executionMode === 'api'
          ? apiPayloadTemplate
          : '',
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
    setPolymarketMarketTitle('');
    setPolymarketOutcomeLabel('');
    setPolymarketTokenId('');
    setPolymarketSide('BUY');
    setPolymarketPrice('');
    setPolymarketSize('');
    setPolymarketOrderType('GTC');
    setPolymarketPostOnly(false);
    setPolymarketChainId(DEFAULT_POLYMARKET_CHAIN_ID);
  };

  const renderPolymarketTradeFields = () => (
    <>
      <div className="info-box polymarket-panel-card">
        <p className="info-text">
          Polymarket 전용 트레이딩 블록입니다. outcome token 기준으로 지정가 가격과 share 수량을 입력하면 CLOB 주문 파라미터를 바로 구성합니다.
        </p>
      </div>
      <div className="polymarket-panel-grid">
        <div className="form-field">
          <label className="field-label">마켓 라벨</label>
          <Input
            type="text"
            className="field-input"
            placeholder="예: Fed 25bp Cut in June"
            value={polymarketMarketTitle}
            onChange={(event) => setPolymarketMarketTitle(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label className="field-label">아웃컴 라벨</label>
          <Input
            type="text"
            className="field-input"
            placeholder="예: YES"
            value={polymarketOutcomeLabel}
            onChange={(event) => setPolymarketOutcomeLabel(event.target.value)}
          />
        </div>
        <div className="form-field polymarket-panel-span-2">
          <label className="field-label">Outcome Token ID</label>
          <Input
            type="text"
            className="field-input"
            placeholder="Polymarket token_id"
            value={polymarketTokenId}
            onChange={(event) => setPolymarketTokenId(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label className="field-label">Side</label>
          <div className="button-group">
            {POLYMARKET_SIDE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                className={`btn-option ${polymarketSide === option.value ? 'active' : ''}`}
                onClick={() => setPolymarketSide(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="form-field">
          <label className="field-label">Order Type</label>
          <Select
            className="field-select"
            value={polymarketOrderType}
            onChange={(event) => setPolymarketOrderType(event.target.value)}
          >
            {POLYMARKET_ORDER_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </div>
        <div className="form-field">
          <label className="field-label">Price</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            max="1"
            className="field-input"
            placeholder="0.52"
            value={polymarketPrice}
            onChange={(event) => setPolymarketPrice(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label className="field-label">Size (shares)</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            className="field-input"
            placeholder="10"
            value={polymarketSize}
            onChange={(event) => setPolymarketSize(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label className="field-label">Post Only</label>
          <div className="button-group">
            <Button
              type="button"
              className={`btn-option ${!polymarketPostOnly ? 'active' : ''}`}
              onClick={() => setPolymarketPostOnly(false)}
            >
              Off
            </Button>
            <Button
              type="button"
              className={`btn-option ${polymarketPostOnly ? 'active' : ''}`}
              onClick={() => setPolymarketPostOnly(true)}
            >
              On
            </Button>
          </div>
        </div>
        <div className="form-field">
          <label className="field-label">Chain ID</label>
          <Input
            type="number"
            className="field-input"
            value={polymarketChainId}
            onChange={(event) => setPolymarketChainId(event.target.value)}
            placeholder="137"
          />
        </div>
      </div>
    </>
  );

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
            <Input
              type="text"
              className="field-input"
              placeholder={isPolymarketAction ? '예: Polymarket_Yes_Limit' : '예: BTC_Buy_Action'}
              value={blockName}
              onChange={(event) => setBlockName(event.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="field-label">액션 타입</label>
            <div className="button-group">
              <Button
                type="button"
                className={`btn-option tall ${actionType === 'cex' ? 'active' : ''}`}
                onClick={selectCEXAction}
              >
                CEX action
              </Button>
              <Button
                type="button"
                className={`btn-option tall ${actionType === 'dex' && dexProtocol !== 'polymarket' ? 'active' : ''}`}
                onClick={selectContractAction}
              >
                DEX action
              </Button>
            </div>
          </div>

          {actionType === 'cex' && (
            <>
              <div className="form-field">
                <label className="field-label">거래소</label>
                <Select
                  className="field-select"
                  value={exchange}
                  onChange={handleExchangeChange}
                >
                  {SUPPORTED_CEX_TRADE_EXCHANGES.map((connection) => (
                    <option key={connection.id} value={connection.name}>{connection.name}</option>
                  ))}
                </Select>
              </div>

              {!isPolymarketAction && (
                <>
                  <div className="form-field">
                    <label className="field-label">시장 타입</label>
                    <Input
                      type="text"
                      className="field-input"
                      value={marketType}
                      onChange={(event) => setMarketType(event.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label className="field-label">토큰</label>
                    <Input
                      type="text"
                      className="field-input"
                      placeholder="예: BTCUSDT"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                    />
                  </div>
                </>
              )}

              {isPolymarketAction && renderPolymarketTradeFields()}
            </>
          )}

          {actionType === 'dex' && (
            <>
              {!isPolymarketAction && (
              <div className="form-field">
                <label className="field-label">DEX 프로토콜</label>
                <Select
                  className="field-select"
                  value={dexProtocol}
                  onChange={(event) => {
                    const next = event.target.value;
                    setDexProtocol(next);
                    if (next === 'polymarket') {
                      setExecutionMode('api');
                      setApiUrl('https://clob.polymarket.com');
                    }
                    if (next === 'evm') {
                      setExecutionMode('address');
                    }
                  }}
                >
                  <option value="generic">일반 DEX/커스텀</option>
                  <option value="evm">EVM Contract (Web3)</option>
                </Select>
              </div>
              )}

              {isPolymarketAction && renderPolymarketTradeFields()}

              {!isPolymarketAction && (
                <div className="form-field">
                  <label className="field-label">실행 방식</label>
                  <div className="button-group">
                    <Button
                      type="button"
                      className={`btn-option ${executionMode === 'address' ? 'active' : ''}`}
                      onClick={() => setExecutionMode('address')}
                    >
                      컨트랙트 주소
                    </Button>
                    <Button
                      type="button"
                      className={`btn-option ${executionMode === 'api' ? 'active' : ''}`}
                      onClick={() => setExecutionMode('api')}
                      disabled={dexProtocol === 'evm'}
                    >
                      API
                    </Button>
                  </div>
                </div>
              )}

              {executionMode === 'address' && dexProtocol === 'evm' && (
                <>
                  <div className="form-field">
                    <label className="field-label">체인</label>
                    <Select
                      className="field-select"
                      value={evmChain}
                      onChange={(event) => setEvmChain(event.target.value)}
                    >
                      {EVM_CHAINS.map((chain) => (
                        <option key={chain.id} value={chain.id}>{chain.label}</option>
                      ))}
                    </Select>
                  </div>

                  <div className="form-field">
                    <label className="field-label">컨트랙트 주소</label>
                    <Input
                      type="text"
                      className="field-input"
                      placeholder="0x..."
                      value={contractAddress}
                      onChange={(event) => setContractAddress(event.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <Button
                      type="button"
                      className="strategy-tool-btn host"
                      onClick={handleFetchEVMABI}
                      disabled={evmAbiLoading}
                    >
                      {evmAbiLoading ? 'ABI 조회 중...' : '검증된 ABI/함수 불러오기'}
                    </Button>
                    {evmAbiNotice && (
                      <div className="strategy-feedback-issue warn">{evmAbiNotice}</div>
                    )}
                  </div>

                  <div className="form-field">
                    <label className="field-label">함수 선택</label>
                    <Select
                      className="field-select"
                      value={selectedEvmFunctionSig}
                      onChange={(event) => setSelectedEvmFunctionSig(event.target.value)}
                    >
                      <option value="">함수를 선택하세요</option>
                      {evmFunctions.map((fn) => (
                        <option key={fn.signature} value={fn.signature}>
                          {fn.name} ({fn.stateMutability})
                        </option>
                      ))}
                    </Select>
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
                    <Input
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

              {executionMode === 'api' && !isPolymarketAction && (
                <>
                  <div className="form-field">
                    <label className="field-label">API URL</label>
                    <Input
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
              <Button
                type="button"
                className="strategy-tool-btn"
                onClick={onRequestAuth}
              >
                사전인증 탭 열기
              </Button>
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
          {!isPolymarketTradeConfigured && isPolymarketAction && (
            <div className="strategy-feedback-issue warn">
              Polymarket 주문 생성을 위해 tokenId, price, size를 모두 입력하세요.
            </div>
          )}

          <Button
            type="button"
            className={`btn-create ${canCreate ? '' : 'disabled'}`}
            disabled={!canCreate}
            onClick={handleCreate}
          >
            블록 생성
          </Button>
        </div>
      </div>
    </div>
  );
}
