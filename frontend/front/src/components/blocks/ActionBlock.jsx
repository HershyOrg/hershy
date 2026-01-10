import { useEffect, useMemo, useState } from 'react';
import './ActionBlock.css';

const SAVED_CONTRACTS = [
  {
    id: 'contract-1',
    name: 'Uniswap V2 Router',
    address: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    description: 'swap/liquidity 지원'
  },
  {
    id: 'contract-2',
    name: 'Aave Pool',
    address: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
    description: 'lend/borrow 지원'
  },
  {
    id: 'contract-3',
    name: 'USDC',
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    description: 'ERC20 토큰'
  }
];

const buildPayloadPreview = (template, params) => {
  const trimmed = template.trim();
  if (!trimmed) {
    const payload = params.reduce((acc, param) => {
      acc[param.name] = param.value || '';
      return acc;
    }, {});
    return JSON.stringify(payload, null, 2);
  }

  let preview = template;
  params.forEach((param) => {
    const token = new RegExp(`{{\\s*${param.name}\\s*}}`, 'g');
    preview = preview.replace(token, param.value || '');
  });
  return preview;
};

const normalizeSource = (payload) => {
  if (!payload) {
    return null;
  }
  return {
    blockId: payload.blockId,
    blockName: payload.blockName,
    blockType: payload.blockType,
    field: payload.field
  };
};

const sourceKey = (source) => (
  source ? `${source.blockId || ''}:${source.field || ''}` : ''
);

const mergeSourceList = (sources, nextSource) => {
  const resolved = Array.isArray(sources) ? sources : [];
  if (!nextSource) {
    return resolved;
  }
  const key = sourceKey(nextSource);
  if (resolved.some((item) => sourceKey(item) === key)) {
    return resolved;
  }
  return [...resolved, nextSource];
};

const normalizeParams = (params) => (
  Array.isArray(params)
    ? params.map((param) => ({
        ...param,
        source: param?.source ?? null,
        sources: mergeSourceList(
          Array.isArray(param?.sources) ? param.sources : [],
          normalizeSource(param?.source)
        )
      }))
    : []
);

const ActionBlock = ({
  blockId,
  name = 'Long_ETH',
  actionType = 'dex', // "dex" or "cex"
  exchange = 'Binance',
  contractAddress = '',
  contractAbi = '',
  contractAddressSource = null,
  contractAddressSources = [],
  executionMode = 'address', // "address" or "api"
  apiUrl = '',
  apiPayloadTemplate = '',
  parameters = [
    { name: 'param1', value: '', placeholder: '값 또는 블록 연결' },
    { name: 'param2', value: '', placeholder: '값 또는 블록 연결' }
  ],
  onUpdateBlock
}) => {
  const [type, setType] = useState(actionType);
  const [selectedExchange, setSelectedExchange] = useState(exchange);
  const [address, setAddress] = useState(contractAddress);
  const [mode, setMode] = useState(executionMode);
  const [apiEndpoint, setApiEndpoint] = useState(apiUrl);
  const [payloadTemplate, setPayloadTemplate] = useState(apiPayloadTemplate);
  const [params, setParams] = useState(() => normalizeParams(parameters));
  const [selectedContractId, setSelectedContractId] = useState(null);
  const [abi, setAbi] = useState(contractAbi);
  const [addressSource, setAddressSource] = useState(contractAddressSource);
  const [addressSources, setAddressSources] = useState(() => (
    mergeSourceList(
      Array.isArray(contractAddressSources) ? contractAddressSources : [],
      normalizeSource(contractAddressSource)
    )
  ));

  useEffect(() => {
    setType(actionType);
  }, [actionType]);

  useEffect(() => {
    setSelectedExchange(exchange);
  }, [exchange]);

  useEffect(() => {
    setAddress(contractAddress);
  }, [contractAddress]);

  useEffect(() => {
    setMode(executionMode);
  }, [executionMode]);

  useEffect(() => {
    setApiEndpoint(apiUrl);
  }, [apiUrl]);

  useEffect(() => {
    setPayloadTemplate(apiPayloadTemplate);
  }, [apiPayloadTemplate]);

  useEffect(() => {
    setParams(normalizeParams(parameters));
  }, [parameters]);

  useEffect(() => {
    setAbi(contractAbi);
  }, [contractAbi]);

  useEffect(() => {
    setAddressSource(contractAddressSource);
    setAddressSources((prev) => mergeSourceList(prev, normalizeSource(contractAddressSource)));
  }, [contractAddressSource]);

  useEffect(() => {
    setAddressSources(mergeSourceList(
      Array.isArray(contractAddressSources) ? contractAddressSources : [],
      normalizeSource(contractAddressSource)
    ));
  }, [contractAddressSources]);

  const normalizedAddress = address.trim().toLowerCase();
  const matchedContracts = useMemo(() => {
    if (!normalizedAddress) {
      return [];
    }
    return SAVED_CONTRACTS.filter((contract) => (
      contract.address.toLowerCase().includes(normalizedAddress)
    ));
  }, [normalizedAddress]);
  const showEtherscanWireframe = normalizedAddress && matchedContracts.length === 0;

  const payloadPreview = useMemo(
    () => buildPayloadPreview(payloadTemplate, params),
    [payloadTemplate, params]
  );

  const updateParam = (index, updates) => {
    const newParams = [...params];
    const current = newParams[index] || {};
    const next = { ...current, ...updates };
    if (!Array.isArray(next.sources)) {
      next.sources = Array.isArray(current.sources) ? current.sources : [];
    }
    newParams[index] = next;
    setParams(newParams);
    onUpdateBlock?.(blockId, { parameters: newParams });
  };

  const parseSourcePayload = (event) => {
    const raw = event.dataTransfer.getData('application/x-block-source');
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  };

  const getSourceLabel = (source) => {
    if (!source) {
      return '';
    }
    if (source.field) {
      const base = `${source.blockName || source.blockId}::${source.field}`;
      return source.mode === 'snapshot' ? `${base} (스냅샷)` : base;
    }
    const name = source.blockName || source.blockId || '';
    return source.mode === 'snapshot' ? `${name} (스냅샷)` : name;
  };

  const handleParamDrop = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    const payload = parseSourcePayload(event);
    if (!payload) {
      return;
    }
    const normalizedSource = normalizeSource(payload);
    const nextSources = mergeSourceList(params[index]?.sources, normalizedSource);
    updateParam(index, {
      value: '',
      source: normalizedSource ? { ...normalizedSource, mode: 'live' } : null,
      sources: nextSources,
      valueOrigin: null
    });
  };

  const handleParamSelect = (index, source) => {
    if (!source) {
      return;
    }
    updateParam(index, {
      value: '',
      source: { ...source, mode: source.mode || 'live' },
      valueOrigin: null
    });
  };

  const updateContractMapping = (updates) => {
    if (Object.prototype.hasOwnProperty.call(updates, 'contractAddress')) {
      setAddress(updates.contractAddress);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'contractAddressSource')) {
      setAddressSource(updates.contractAddressSource);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'contractAddressSources')) {
      setAddressSources(updates.contractAddressSources);
    }
    onUpdateBlock?.(blockId, updates);
  };

  const handleContractAddressDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const payload = parseSourcePayload(event);
    if (!payload) {
      return;
    }
    const normalizedSource = normalizeSource(payload);
    const nextSources = mergeSourceList(addressSources, normalizedSource);
    const nextSource = normalizedSource ? { ...normalizedSource, mode: 'live' } : null;
    updateContractMapping({
      contractAddress: '',
      contractAddressSource: nextSource,
      contractAddressSources: nextSources
    });
  };

  const handleContractSourceSelect = (source) => {
    if (!source) {
      return;
    }
    updateContractMapping({
      contractAddress: '',
      contractAddressSource: { ...source, mode: source.mode || 'live' }
    });
  };

  return (
    <div className="action-block">
      <div className="action-block-header">
        <div className="action-block-header-content">
          <div className="action-block-title-row">
            <div className="action-block-indicator" />
            <input
              className="action-block-title-input"
              value={name}
              onChange={(event) => onUpdateBlock?.(blockId, { name: event.target.value })}
              placeholder="블록 이름"
            />
          </div>
          <p className="action-block-subtitle">액션 블록</p>
        </div>
      </div>

      <div className="action-block-type-toggle">
        <button
          className={`action-type-btn ${type === 'cex' ? 'active' : ''}`}
          onClick={() => {
            setType('cex');
            onUpdateBlock?.(blockId, { actionType: 'cex' });
          }}
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M11 3.5L6.75 7.75L4.25 5.25L1 8.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 3.5H11V6.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          CEX
        </button>
        <button
          className={`action-type-btn ${type === 'dex' ? 'active' : ''}`}
          onClick={() => {
            setType('dex');
            onUpdateBlock?.(blockId, { actionType: 'dex' });
          }}
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M8 1.5L10 3.5L8 5.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 3.5H2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 10.5L2 8.5L4 6.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 8.5H10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Contract
        </button>
      </div>

      {type === 'cex' && (
        <div className="action-block-exchange">
          <label className="action-block-label">거래소</label>
          <select
            className="action-block-select"
            value={selectedExchange}
            onChange={(event) => {
              setSelectedExchange(event.target.value);
              onUpdateBlock?.(blockId, { exchange: event.target.value });
            }}
          >
            <option value="Binance">Binance</option>
            <option value="Coinbase">Coinbase</option>
            <option value="Kraken">Kraken</option>
            <option value="Upbit">Upbit</option>
          </select>
        </div>
      )}

      {type === 'dex' && (
        <>
          <div className="action-block-mode-toggle">
            <button
              type="button"
              className={`action-mode-btn ${mode === 'address' ? 'active' : ''}`}
              onClick={() => {
                setMode('address');
                onUpdateBlock?.(blockId, { executionMode: 'address' });
              }}
            >
              주소
            </button>
            <button
              type="button"
              className={`action-mode-btn ${mode === 'api' ? 'active' : ''}`}
              onClick={() => {
                setMode('api');
                onUpdateBlock?.(blockId, { executionMode: 'api' });
              }}
            >
              API
            </button>
          </div>

          {mode === 'address' && (
            <div className="action-block-contract">
              <label className="action-block-label">컨트랙트 주소</label>
              {!addressSource && (
                <input
                  type="text"
                  className="action-block-input"
                  value={address}
                  onChange={(event) => {
                    setAddress(event.target.value);
                    setSelectedContractId(null);
                    updateContractMapping({
                      contractAddress: event.target.value,
                      contractAddressSource: null
                    });
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={handleContractAddressDrop}
                  placeholder="0x..."
                />
              )}
              {addressSource && (
                <div className="action-param-source">
                  <span>{getSourceLabel(addressSource)}</span>
                  <button
                    type="button"
                    className="action-param-source-clear"
                    onClick={() => updateContractMapping({ contractAddressSource: null, contractAddress: '' })}
                  >
                    ×
                  </button>
                </div>
              )}
              {addressSources.length > 0 && (
                <div className="action-param-candidates">
                  <span className="action-param-candidates-label">연결 후보</span>
                  <div className="action-param-candidates-list">
                    {addressSources.map((source) => {
                      const key = sourceKey(source);
                      const isActive = addressSource && sourceKey(addressSource) === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`action-param-candidate action-param-candidate--${source.blockType || 'default'}${isActive ? ' is-active' : ''}`}
                          onClick={() => handleContractSourceSelect(source)}
                        >
                          {getSourceLabel(source)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {matchedContracts.length > 0 && (
                <div className="action-contract-match">
                  <p className="action-contract-title">생성 가능한 블록</p>
                  <div className="action-contract-list">
                    {matchedContracts.map((contract) => (
                      <div
                        key={contract.id}
                        className={`action-contract-card${selectedContractId === contract.id ? ' is-selected' : ''}`}
                      >
                        <div>
                          <p className="action-contract-name">{contract.name}</p>
                          <p className="action-contract-address">{contract.address}</p>
                          <p className="action-contract-desc">{contract.description}</p>
                        </div>
                        <button
                          type="button"
                          className="action-contract-select"
                          onClick={() => {
                            setSelectedContractId(contract.id);
                            setAddress(contract.address);
                            updateContractMapping({
                              contractAddress: contract.address,
                              contractAddressSource: null
                            });
                          }}
                        >
                          생성
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {showEtherscanWireframe && (
                <div className="action-contract-wireframe">
                  <div className="action-contract-wireframe-header">
                    <span>이더스캔에서 컨트랙트 정보 불러오기</span>
                    <span className="action-wireframe-badge">준비중</span>
                  </div>
                  <div className="action-contract-wireframe-body">
                    <div className="action-wireframe-line" />
                    <div className="action-wireframe-line short" />
                    <div className="action-wireframe-line" />
                  </div>
                </div>
              )}

              <label className="action-block-label">ABI (선택)</label>
              <textarea
                className="action-block-textarea"
                value={abi}
                onChange={(event) => {
                  setAbi(event.target.value);
                  onUpdateBlock?.(blockId, { contractAbi: event.target.value });
                }}
                placeholder="ABI JSON을 입력하세요"
                rows={3}
              />
            </div>
          )}

          {mode === 'api' && (
            <div className="action-block-api">
              <label className="action-block-label">API URL</label>
              <input
                type="text"
                className="action-block-input"
                value={apiEndpoint}
                onChange={(event) => {
                  setApiEndpoint(event.target.value);
                  onUpdateBlock?.(blockId, { apiUrl: event.target.value });
                }}
                placeholder="https://api.example.com/tx"
              />
              <label className="action-block-label">JSON 구조</label>
              <textarea
                className="action-block-textarea"
                value={payloadTemplate}
                onChange={(event) => {
                  setPayloadTemplate(event.target.value);
                  onUpdateBlock?.(blockId, { apiPayloadTemplate: event.target.value });
                }}
                placeholder={'{\n  \"to\": \"{{to}}\",\n  \"amount\": \"{{amount}}\"\n}'}
                rows={4}
              />
              <div className="action-block-preview">
                <span className="action-block-preview-title">자동 채움 미리보기</span>
                <pre className="action-block-preview-body">{payloadPreview}</pre>
              </div>
            </div>
          )}
        </>
      )}

      <div className="action-block-params">
        <div className="action-block-params-header">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4.6665 8.1665C6.5995 8.1665 8.1665 6.5995 8.1665 4.6665C8.1665 2.73351 6.5995 1.1665 4.6665 1.1665C2.73351 1.1665 1.1665 2.73351 1.1665 4.6665C1.1665 6.5995 2.73351 8.1665 4.6665 8.1665Z" stroke="#94A3B8" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10.5526 6.04932C11.104 6.2549 11.5947 6.59621 11.9793 7.04168C12.3638 7.48716 12.6299 8.02241 12.7528 8.59794C12.8756 9.17347 12.8514 9.7707 12.6823 10.3344C12.5133 10.8981 12.2048 11.41 11.7854 11.8229C11.366 12.2358 10.8493 12.5363 10.2831 12.6965C9.7168 12.8568 9.11926 12.8717 8.54572 12.7398C7.97218 12.608 7.44114 12.3336 7.00172 11.9421C6.5623 11.5507 6.22869 11.0547 6.03174 10.5001" stroke="#94A3B8" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4.0835 3.5H4.66683V5.83333" stroke="#94A3B8" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9.74741 8.09668L10.1557 8.51085L8.51074 10.1558" stroke="#94A3B8" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="action-block-params-title">파라미터</span>
        </div>
        <div className="action-block-params-list">
          {params.map((param, index) => (
            <div
              key={param.name}
              className="action-param-item"
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(event) => handleParamDrop(event, index)}
            >
              <label className="action-param-label">{param.name}</label>
              {param.source && (
                <div className="action-param-source">
                  <span>{getSourceLabel(param.source)}</span>
                  <button
                    type="button"
                    className="action-param-source-clear"
                    onClick={() => updateParam(index, { source: null, value: '', valueOrigin: null })}
                  >
                    ×
                  </button>
                </div>
              )}
              {!param.source && (
                <input
                  type="text"
                  className="action-param-input"
                  value={param.value || ''}
                  onChange={(event) => updateParam(index, { value: event.target.value, source: null, valueOrigin: 'backend' })}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                  }}
                  onDrop={(event) => handleParamDrop(event, index)}
                  placeholder={param.placeholder}
                />
              )}
              {Array.isArray(param.sources) && param.sources.length > 0 && (
                <div className="action-param-candidates">
                  <div className="action-param-candidates-header">
                    <span className="action-param-candidates-label">연결 후보</span>
                    {param.sources.length > 1 && param.source && (
                      <button
                        type="button"
                        className="action-param-candidates-clear"
                        onClick={() => updateParam(index, { source: null, value: '', valueOrigin: null })}
                        aria-label="연결 해제"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div className="action-param-candidates-list">
                    {param.sources.map((source) => {
                      const key = sourceKey(source);
                      const isActive = param.source && sourceKey(param.source) === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={`action-param-candidate action-param-candidate--${source.blockType || 'default'}${isActive ? ' is-active' : ''}`}
                          onClick={() => handleParamSelect(index, source)}
                        >
                          {getSourceLabel(source)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="connection-point connection-point-top" />
      <div className="connection-point connection-point-right" />
      <div className="connection-point connection-point-bottom" />
      <div className="connection-point connection-point-left" />
    </div>
  );
};

export default ActionBlock;
