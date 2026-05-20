import { useState } from 'react';
import { getProviderCredentials } from '../../lib/actionAuth';
import { EVM_CHAINS } from '../../lib/evmChains';
import { parseJsonFields, sampleStreamDefinition } from '../../lib/streamPreview';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

const CEX_STREAM_EXCHANGES = [
  { value: 'binance', label: 'Binance' },
  { value: 'bybit', label: 'Bybit' },
  { value: 'okx', label: 'OKX' },
  { value: 'kucoin', label: 'KuCoin' },
  { value: 'bitget', label: 'Bitget' },
  { value: 'gateio', label: 'Gate.io' }
];

const STREAM_DEFAULT_FIELDS = {
  'cex-market': ['symbol', 'lastPrice', 'midPrice', 'bidPrice', 'askPrice', 'spread', 'volume', 'quoteVolume', 'eventTime'],
  'polymarket-market': ['tokenId', 'lastPrice', 'midPrice', 'bidPrice', 'askPrice', 'spread', 'bidSize', 'askSize', 'liquidity', 'eventTime']
};

export default function StreamingBlocksPanel({ onClose, onCreate, authState = {} }) {
  const [streamKind, setStreamKind] = useState('url');
  const [dataReceptionType, setDataReceptionType] = useState('realtime');
  const [blockName, setBlockName] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [exchange, setExchange] = useState('binance');
  const [symbol, setSymbol] = useState('');
  const [marketId, setMarketId] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [streamChain, setStreamChain] = useState('');
  const [streamMethod, setStreamMethod] = useState('eth_blockNumber');
  const [streamParamsJson, setStreamParamsJson] = useState('[]');
  const [updateInterval, setUpdateInterval] = useState('');
  const [responseFormat, setResponseFormat] = useState('');
  const [fields, setFields] = useState([]);
  const [parseBusy, setParseBusy] = useState(false);
  const [parseNotice, setParseNotice] = useState('');

  const isEVMRPCStream = streamKind === 'evm-rpc';
  const isCEXMarketStream = streamKind === 'cex-market';
  const isPolymarketStream = streamKind === 'polymarket-market';
  const canParse = isEVMRPCStream
    ? Boolean(streamChain.trim() && streamMethod.trim())
    : isCEXMarketStream
      ? Boolean(exchange.trim() && symbol.trim())
      : isPolymarketStream
        ? Boolean(tokenId.trim())
        : Boolean(apiUrl.trim() || responseFormat.trim());
  const hasRequiredStreamMeta = isEVMRPCStream
    ? Boolean(streamChain.trim() && streamMethod.trim())
    : isCEXMarketStream
      ? Boolean(exchange.trim() && symbol.trim())
      : isPolymarketStream
        ? Boolean(tokenId.trim())
        : Boolean(apiUrl.trim());
  const canCreate = Boolean(blockName.trim()) && hasRequiredStreamMeta && (fields.length > 0 || canParse);
  const evmCredentials = getProviderCredentials(authState, 'evm');

  const buildAuthContext = () => {
    const rpcUrl = typeof evmCredentials?.rpcUrl === 'string' ? evmCredentials.rpcUrl.trim() : '';
    const alchemyApiKey = typeof evmCredentials?.alchemyApiKey === 'string'
      ? evmCredentials.alchemyApiKey.trim()
      : '';
    if (!rpcUrl && !alchemyApiKey) {
      return null;
    }
    return {
      evm: {
        rpcUrl,
        alchemyApiKey
      }
    };
  };

  const resolveFields = async () => {
    const jsonFields = parseJsonFields(responseFormat);
    if (jsonFields.length > 0) {
      return jsonFields;
    }

    const defaultFields = STREAM_DEFAULT_FIELDS[streamKind];
    if (Array.isArray(defaultFields) && defaultFields.length > 0) {
      return defaultFields;
    }

    const payload = await sampleStreamDefinition({
      streamKind,
      apiUrl: apiUrl.trim(),
      exchange: exchange.trim(),
      symbol: symbol.trim(),
      marketId: marketId.trim(),
      tokenId: tokenId.trim(),
      streamChain: streamChain.trim(),
      streamMethod: streamMethod.trim(),
      streamParamsJson: streamParamsJson.trim() || '[]',
      responseSchema: responseFormat.trim(),
      authContext: buildAuthContext()
    });
    return Array.isArray(payload?.fields) ? payload.fields : [];
  };

  const handleParseFields = async () => {
    setParseBusy(true);
    setParseNotice('');
    try {
      const nextFields = await resolveFields();
      if (nextFields.length === 0) {
        throw new Error('실제 응답에서 감지된 필드가 없습니다.');
      }
      setFields(nextFields);
      setParseNotice(`필드 ${nextFields.length}개를 실제 응답 기준으로 감지했습니다.`);
    } catch (error) {
      setParseNotice(error?.message || '필드 파싱에 실패했습니다.');
    } finally {
      setParseBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!blockName.trim()) {
      return;
    }

    let nextFields = fields;
    if (nextFields.length === 0) {
      try {
        nextFields = await resolveFields();
        setFields(nextFields);
      } catch (error) {
        setParseNotice(error?.message || '블록 생성 전에 필드 파싱이 필요합니다.');
        return;
      }
    }

    if (nextFields.length === 0 || !onCreate) {
      return;
    }

    const updateMode = dataReceptionType === 'periodic' ? 'periodic' : 'live';
    const resolvedInterval = dataReceptionType === 'periodic'
      ? Number(updateInterval || 1000)
      : 1000;

    onCreate({
      name: blockName.trim(),
      fields: nextFields,
      streamKind,
      exchange: isCEXMarketStream ? exchange.trim() : '',
      symbol: isCEXMarketStream ? symbol.trim() : '',
      marketId: isPolymarketStream ? marketId.trim() : '',
      tokenId: isPolymarketStream ? tokenId.trim() : '',
      streamChain: isEVMRPCStream ? streamChain.trim() : '',
      streamMethod: isEVMRPCStream ? streamMethod.trim() : '',
      streamParamsJson: isEVMRPCStream ? (streamParamsJson.trim() || '[]') : '',
      apiUrl: isEVMRPCStream || isCEXMarketStream || isPolymarketStream ? '' : apiUrl.trim(),
      updateMode,
      updateInterval: resolvedInterval,
      responseSchema: responseFormat.trim()
    });

    setBlockName('');
    setFields([]);
    setParseNotice('');
  };

  return (
    <div className="overlay-panel">
      <div className="panel-sidebar">
        {/* Panel sidebar icons */}
      </div>

      <div className="panel-content">
        <div className="panel-header">
          <h3 className="panel-title">스트리밍 블록</h3>
        </div>

        <div className="panel-form">
          <div className="form-field">
            <label className="field-label">스트림 소스</label>
            <div className="button-group">
              <Button
                type="button"
                className={`btn-option ${streamKind === 'url' ? 'active' : ''}`}
                onClick={() => setStreamKind('url')}
              >
                URL/WebSocket
              </Button>
              <Button
                type="button"
                className={`btn-option ${streamKind === 'cex-market' ? 'active' : ''}`}
                onClick={() => setStreamKind('cex-market')}
              >
                CEX Market
              </Button>
              <Button
                type="button"
                className={`btn-option ${streamKind === 'polymarket-market' ? 'active' : ''}`}
                onClick={() => setStreamKind('polymarket-market')}
              >
                Polymarket
              </Button>
              <Button
                type="button"
                className={`btn-option ${streamKind === 'evm-rpc' ? 'active' : ''}`}
                onClick={() => setStreamKind('evm-rpc')}
              >
                EVM RPC
              </Button>
            </div>
          </div>

          <div className="form-field">
            <label className="field-label">블록 이름</label>
            <Input
              type="text"
              className="field-input"
              placeholder="예: BTCUSDT_Price"
              value={blockName}
              onChange={(event) => setBlockName(event.target.value)}
            />
          </div>

          {streamKind === 'url' && (
            <div className="form-field">
              <label className="field-label">API/WebSocket URL</label>
              <Input
                type="text"
                className="field-input"
                placeholder="wss://stream.binance.com:9443/ws/btcusdt@ticker"
                value={apiUrl}
                onChange={(event) => setApiUrl(event.target.value)}
              />
            </div>
          )}

          {streamKind === 'cex-market' && (
            <>
              <div className="form-field">
                <label className="field-label">거래소</label>
                <select
                  className="field-input"
                  value={exchange}
                  onChange={(event) => setExchange(event.target.value)}
                >
                  {CEX_STREAM_EXCHANGES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label className="field-label">심볼</label>
                <Input
                  type="text"
                  className="field-input"
                  placeholder="BTCUSDT / BTC-USDT / BTC_USDT"
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value)}
                />
              </div>
            </>
          )}

          {streamKind === 'polymarket-market' && (
            <>
              <div className="form-field">
                <label className="field-label">Token ID</label>
                <Input
                  type="text"
                  className="field-input"
                  placeholder="Polymarket token_id"
                  value={tokenId}
                  onChange={(event) => setTokenId(event.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="field-label">Market ID (선택)</label>
                <Input
                  type="text"
                  className="field-input"
                  placeholder="condition id / market id"
                  value={marketId}
                  onChange={(event) => setMarketId(event.target.value)}
                />
              </div>
            </>
          )}

          {streamKind === 'evm-rpc' && (
            <>
              <div className="form-field">
                <label className="field-label">체인</label>
                <select
                  className="field-input"
                  value={streamChain}
                  onChange={(event) => setStreamChain(event.target.value)}
                >
                  <option value="">체인 선택</option>
                  {EVM_CHAINS.map((chain) => (
                    <option key={chain.id} value={chain.id}>{chain.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label className="field-label">RPC Method</label>
                <Input
                  type="text"
                  className="field-input"
                  placeholder="eth_blockNumber"
                  value={streamMethod}
                  onChange={(event) => setStreamMethod(event.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="field-label">RPC Params (JSON 배열)</label>
                <textarea
                  className="field-textarea"
                  placeholder='["latest", false]'
                  value={streamParamsJson}
                  onChange={(event) => setStreamParamsJson(event.target.value)}
                />
              </div>
            </>
          )}

          <div className="form-field">
            <label className="field-label">데이터 수신 방식</label>
            <div className="button-group">
              <Button
                className={`btn-option ${dataReceptionType === 'realtime' ? 'active' : ''}`}
                onClick={() => setDataReceptionType('realtime')}
              >
                실시간
              </Button>
              <Button
                className={`btn-option ${dataReceptionType === 'periodic' ? 'active' : ''}`}
                onClick={() => setDataReceptionType('periodic')}
              >
                주기적
              </Button>
            </div>
          </div>

          {dataReceptionType === 'periodic' && (
            <div className="form-field">
              <label className="field-label">업데이트 주기 (초)</label>
              <Input
                type="text"
                className="field-input"
                placeholder="예: 1"
                value={updateInterval}
                onChange={(event) => setUpdateInterval(event.target.value)}
              />
            </div>
          )}

          <div className="form-field">
            <label className="field-label">반환값 형식 (JSON)</label>
            <textarea
              className="field-textarea"
              placeholder='{"price": "number", "volume": "number", "timestamp": "string"}'
              value={responseFormat}
              onChange={(event) => setResponseFormat(event.target.value)}
            />
          </div>

          <Button
            type="button"
            className={`btn-parse ${canParse ? '' : 'disabled'}`}
            disabled={!canParse || parseBusy}
            onClick={handleParseFields}
          >
            {parseBusy ? '실제 응답 확인 중...' : '필드 파싱'}
          </Button>

          {parseNotice && (
            <div className="field-preview">
              <span className="field-preview-label">{parseNotice}</span>
            </div>
          )}

          {fields.length > 0 && (
            <div className="field-preview">
              <span className="field-preview-label">파싱된 필드</span>
              <div className="field-preview-list">
                {fields.map((field) => (
                  <span key={field} className="field-preview-tag">{field}</span>
                ))}
              </div>
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
