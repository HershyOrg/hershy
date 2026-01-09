import React, { useState } from 'react';
import './ActionBlock.css';

const ActionBlock = ({ 
  name = "Long_ETH",
  actionType = "dex", // "dex" or "cex"
  web3Function = "swap",
  exchange = "Binance",
  parameters = [
    { name: "param1", value: "", placeholder: "값 또는 블록 연결" },
    { name: "param2", value: "", placeholder: "값 또는 블록 연결" }
  ]
}) => {
  const [type, setType] = useState(actionType);
  const [func, setFunc] = useState(web3Function);
  const [selectedExchange, setSelectedExchange] = useState(exchange);
  const [params, setParams] = useState(parameters);

  const updateParam = (index, value) => {
    const newParams = [...params];
    newParams[index].value = value;
    setParams(newParams);
  };

  return (
    <div className="action-block">
      <div className="action-block-header">
        <div className="action-block-header-content">
          <div className="action-block-title-row">
            <div className="action-block-indicator" />
            <h3 className="action-block-title">{name}</h3>
          </div>
          <p className="action-block-subtitle">액션 블록</p>
        </div>
      </div>

      <div className="action-block-type-toggle">
        <button 
          className={`action-type-btn ${type === 'cex' ? 'active' : ''}`}
          onClick={() => setType('cex')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M11 3.5L6.75 7.75L4.25 5.25L1 8.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8 3.5H11V6.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          CEX
        </button>
        <button 
          className={`action-type-btn ${type === 'dex' ? 'active' : ''}`}
          onClick={() => setType('dex')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M8 1.5L10 3.5L8 5.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10 3.5H2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4 10.5L2 8.5L4 6.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 8.5H10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          DEX
        </button>
      </div>

      {type === 'cex' && (
        <div className="action-block-exchange">
          <label className="action-block-label">거래소</label>
          <select 
            className="action-block-select"
            value={selectedExchange}
            onChange={(e) => setSelectedExchange(e.target.value)}
          >
            <option value="Binance">Binance</option>
            <option value="Coinbase">Coinbase</option>
            <option value="Kraken">Kraken</option>
            <option value="Upbit">Upbit</option>
          </select>
        </div>
      )}

      {type === 'dex' && (
        <div className="action-block-function">
          <label className="action-block-label">Web3 함수</label>
          <input 
            type="text"
            className="action-block-input"
            value={func}
            onChange={(e) => setFunc(e.target.value)}
            placeholder="swap"
          />
        </div>
      )}

      <div className="action-block-params">
        <div className="action-block-params-header">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4.6665 8.1665C6.5995 8.1665 8.1665 6.5995 8.1665 4.6665C8.1665 2.73351 6.5995 1.1665 4.6665 1.1665C2.73351 1.1665 1.1665 2.73351 1.1665 4.6665C1.1665 6.5995 2.73351 8.1665 4.6665 8.1665Z" stroke="#94A3B8" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10.5526 6.04932C11.104 6.2549 11.5947 6.59621 11.9793 7.04168C12.3638 7.48716 12.6299 8.02241 12.7528 8.59794C12.8756 9.17347 12.8514 9.7707 12.6823 10.3344C12.5133 10.8981 12.2048 11.41 11.7854 11.8229C11.366 12.2358 10.8493 12.5363 10.2831 12.6965C9.7168 12.8568 9.11926 12.8717 8.54572 12.7398C7.97218 12.608 7.44114 12.3336 7.00172 11.9421C6.5623 11.5507 6.22869 11.0547 6.03174 10.5001" stroke="#94A3B8" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4.0835 3.5H4.66683V5.83333" stroke="#94A3B8" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9.74741 8.09668L10.1557 8.51085L8.51074 10.1558" stroke="#94A3B8" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="action-block-params-title">파라미터</span>
        </div>
        <div className="action-block-params-list">
          {params.map((param, index) => (
            <div key={index} className="action-param-item">
              <label className="action-param-label">{param.name}</label>
              <input 
                type="text"
                className="action-param-input"
                value={param.value}
                onChange={(e) => updateParam(index, e.target.value)}
                placeholder={param.placeholder}
              />
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
