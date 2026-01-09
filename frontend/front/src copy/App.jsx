import React, { useState } from 'react';
import StreamingBlock from './components/StreamingBlock';
import MonitoringBlock from './components/MonitoringBlock';
import ActionBlock from './components/ActionBlock';
import { StreamingTableMonitor, StreamingSearchMonitor } from './components/StreamingMonitor';
import './styles.css';

function App() {
  const [activeTab, setActiveTab] = useState('backend');
  const [activeView, setActiveView] = useState('table');

  return (
    <div className="app">
      <div className="app-header">
        <h1 className="app-title">RWA Liquidity Hub</h1>
        <div className="app-tabs">
          <button 
            className={`app-tab ${activeTab === 'backend' ? 'active' : ''}`}
            onClick={() => setActiveTab('backend')}
          >
            Backend Tab
          </button>
          <button 
            className={`app-tab ${activeTab === 'frontend' ? 'active' : ''}`}
            onClick={() => setActiveTab('frontend')}
          >
            Frontend Tab
          </button>
          <button 
            className={`app-tab ${activeTab === 'monitor' ? 'active' : ''}`}
            onClick={() => setActiveTab('monitor')}
          >
            Monitor View
          </button>
        </div>
      </div>

      <div className="app-content">
        {activeTab === 'backend' && (
          <div className="blocks-container">
            <div className="blocks-section">
              <h2 className="section-title">Streaming Blocks</h2>
              <div className="blocks-grid">
                <StreamingBlock 
                  name="Binance_BTC_Stream"
                  fields={["timestamp", "price", "volume", "change"]}
                  updateMode="periodic"
                  updateInterval={1000}
                />
                <StreamingBlock 
                  name="Ethereum_Price_Feed"
                  fields={["price", "timestamp", "marketCap"]}
                  updateMode="live"
                />
              </div>
            </div>

            <div className="blocks-section">
              <h2 className="section-title">Monitoring Blocks</h2>
              <div className="blocks-grid">
                <MonitoringBlock 
                  name="Price_Table_Monitor"
                  type="table"
                  connectedStream="Binance_BTC_Stream"
                  fields={["timestamp", "price", "volume", "change"]}
                />
                <MonitoringBlock 
                  name="Trade_Search"
                  type="search"
                  connectedStream="Binance_BTC_Stream"
                  fields={["id", "timestamp", "price", "volume"]}
                />
              </div>
            </div>

            <div className="blocks-section">
              <h2 className="section-title">Action Blocks</h2>
              <div className="blocks-grid">
                <ActionBlock 
                  name="Long_ETH"
                  actionType="dex"
                  web3Function="swap"
                  parameters={[
                    { name: "tokenIn", value: "", placeholder: "값 또는 블록 연결" },
                    { name: "tokenOut", value: "", placeholder: "값 또는 블록 연결" },
                    { name: "amount", value: "", placeholder: "값 또는 블록 연결" }
                  ]}
                />
                <ActionBlock 
                  name="Quick_Buy_BTC"
                  actionType="cex"
                  exchange="Binance"
                  parameters={[
                    { name: "symbol", value: "", placeholder: "값 또는 블록 연결" },
                    { name: "amount", value: "", placeholder: "값 또는 블록 연결" }
                  ]}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'frontend' && (
          <div className="blocks-container">
            <div className="blocks-section">
              <h2 className="section-title">Frontend Action Blocks</h2>
              <p className="section-description">
                These action blocks are used on the frontend tab for user interactions.
              </p>
              <div className="blocks-grid">
                <ActionBlock 
                  name="Buy_Token"
                  actionType="dex"
                  web3Function="swap"
                  parameters={[
                    { name: "token", value: "", placeholder: "Token address" },
                    { name: "amount", value: "", placeholder: "Amount in ETH" }
                  ]}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'monitor' && (
          <div className="monitor-container">
            <div className="monitor-view-toggle">
              <button 
                className={`monitor-view-btn ${activeView === 'table' ? 'active' : ''}`}
                onClick={() => setActiveView('table')}
              >
                Table Monitor
              </button>
              <button 
                className={`monitor-view-btn ${activeView === 'search' ? 'active' : ''}`}
                onClick={() => setActiveView('search')}
              >
                Search Monitor
              </button>
            </div>

            <div className="monitor-display">
              {activeView === 'table' && (
                <StreamingTableMonitor 
                  name="Price_Table_Monitor"
                  source="TABLE NAME"
                  totalRecords={100}
                  visibleFields="5/6"
                  lastUpdate="오후 06:27:19"
                  updateSpeed="실시간"
                  currentPage={1}
                  totalPages={10}
                  viewMode="card"
                />
              )}
              {activeView === 'search' && (
                <StreamingSearchMonitor 
                  name="Trade_Search"
                  source="Binance_BTC_Stream"
                  searchPlaceholder="데이터 검색... (모든 필드 대상)"
                  currentPage={1}
                  totalPages={10}
                  totalRecords={100}
                  viewMode="card"
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
