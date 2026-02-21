import {
  AUTH_PROVIDER_IDS,
  AUTH_PROVIDER_META,
  getProviderCredentials,
  hasRequiredProviderCredentials
} from '../lib/actionAuth';

const formatVerifiedAt = (value) => {
  if (!value) {
    return '미인증';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString('ko-KR');
};

export default function PreAuthTab({ authState = {}, onUpdateProvider, onExit }) {
  return (
    <div className="preauth-content">
      <div className="preauth-header">
        <div className="preauth-header-row">
          <h2 className="preauth-title">사전인증</h2>
          <button
            type="button"
            className="strategy-tool-btn"
            onClick={onExit}
          >
            나가기
          </button>
        </div>
        <p className="preauth-description">
          거래소/프로토콜별 인증 정보(API Key/HMAC Secret, Polymarket L1/L2, EVM Web3)를 전략 탭 단위로 등록합니다.
        </p>
      </div>

      <div className="preauth-list">
        {AUTH_PROVIDER_IDS.map((providerId) => {
          const meta = AUTH_PROVIDER_META[providerId];
          const item = authState?.[providerId] || {};
          const credentialDefs = Array.isArray(meta.credentials) ? meta.credentials : [];
          const credentials = getProviderCredentials(authState, providerId);
          const isCredentialsReady = hasRequiredProviderCredentials(
            { [providerId]: { credentials } },
            providerId
          );
          const isReady = Boolean(item.authenticated);

          return (
            <section key={providerId} className={`preauth-card${isReady ? ' verified' : ''}`}>
              <div className="preauth-card-head">
                <div>
                  <h3 className="preauth-card-title">{meta.label}</h3>
                  <p className="preauth-card-meta">{meta.description}</p>
                </div>
                <span className={`preauth-badge${isReady ? ' ok' : ''}`}>
                  {isReady ? '인증 완료' : '미인증'}
                </span>
              </div>

              {credentialDefs.map((field) => (
                <div key={`${providerId}-${field.key}`} className="preauth-field">
                  <label className="preauth-field-label" htmlFor={`credential-${providerId}-${field.key}`}>
                    {field.label}
                    {field.required === false ? '' : ' *'}
                  </label>
                  <input
                    id={`credential-${providerId}-${field.key}`}
                    type={field.secret ? 'password' : 'text'}
                    className="preauth-input"
                    placeholder={field.placeholder || `${providerId}-${field.key}`}
                    value={credentials[field.key] || ''}
                    onChange={(event) => {
                      onUpdateProvider?.(providerId, {
                        credentials: {
                          ...credentials,
                          [field.key]: event.target.value
                        },
                        authenticated: false,
                        verifiedAt: null
                      });
                    }}
                  />
                </div>
              ))}
              {providerId === 'polymarket' && (
                <p className="preauth-footnote">
                  L1(Private Key/Funder)는 필수입니다. L2(API Key/Secret/Passphrase)는 비워두면 런타임에서 L1으로 생성/유도합니다.
                </p>
              )}
              {providerId === 'evm' && (
                <p className="preauth-footnote">
                  EOA Private Key는 필수이며, RPC URL 또는 Alchemy API Key 중 하나는 반드시 필요합니다. Explorer API Key를 넣으면 ABI 조회/리서치 정확도가 올라갑니다.
                </p>
              )}

              <div className="preauth-actions">
                <button
                  type="button"
                  className="strategy-tool-btn host"
                  onClick={() => {
                    const sanitized = Object.keys(credentials).reduce((acc, key) => {
                      acc[key] = String(credentials[key] || '').trim();
                      return acc;
                    }, {});
                    onUpdateProvider?.(providerId, {
                      credentials: sanitized,
                      authenticated: true,
                      verifiedAt: new Date().toISOString()
                    });
                  }}
                  disabled={!isCredentialsReady}
                >
                  인증 통과 처리
                </button>
                <button
                  type="button"
                  className="strategy-tool-btn"
                  onClick={() => {
                    const resetCredentials = Object.keys(credentials).reduce((acc, key) => {
                      acc[key] = '';
                      return acc;
                    }, {});
                    onUpdateProvider?.(providerId, {
                      credentials: resetCredentials,
                      authenticated: false,
                      verifiedAt: null
                    });
                  }}
                >
                  초기화
                </button>
              </div>

              <p className="preauth-footnote">
                최근 인증 시간: {formatVerifiedAt(item.verifiedAt)}
              </p>
            </section>
          );
        })}
      </div>

      <p className="preauth-note">
        배포 시 인증정보는 런너 전략 파일에 포함되며, 지원되는 액션(Binance Spot, Polymarket CLOB, EVM Contract)은 실호출/실주문을 시도합니다.
      </p>
    </div>
  );
}
