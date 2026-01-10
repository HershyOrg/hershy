import { useMemo, useState } from 'react';
import { getActionParams } from '../../data/blockFixtures';

export default function ActionBlocksPanel({ onClose, onCreate }) {
  const [actionType, setActionType] = useState('cex');
  const [blockName, setBlockName] = useState('');
  const [exchange, setExchange] = useState('Binance');
  const [marketType, setMarketType] = useState('');
  const [token, setToken] = useState('');
  const [executionMode, setExecutionMode] = useState('address');
  const [contractAddress, setContractAddress] = useState('');
  const [contractAbi, setContractAbi] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiPayloadTemplate, setApiPayloadTemplate] = useState('');

  const parameters = useMemo(
    () => getActionParams(actionType, executionMode),
    [actionType, executionMode]
  );
  const canCreate = Boolean(blockName.trim());

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
      contractAddress: actionType === 'dex' ? contractAddress.trim() : '',
      contractAbi: actionType === 'dex' ? contractAbi.trim() : '',
      executionMode: actionType === 'dex' ? executionMode : 'address',
      apiUrl: actionType === 'dex' && executionMode === 'api' ? apiUrl.trim() : '',
      apiPayloadTemplate: actionType === 'dex' && executionMode === 'api' ? apiPayloadTemplate : '',
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
                  >
                    API
                  </button>
                </div>
              </div>

              {executionMode === 'address' && (
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
            </div>
          </div>
          
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
