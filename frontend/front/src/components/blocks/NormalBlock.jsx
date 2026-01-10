import './NormalBlock.css';

export default function NormalBlock({
  blockId,
  name = 'Static_Value',
  value = '100',
  onUpdateBlock
}) {
  return (
    <div className="normal-block">
      <div className="normal-block-header">
        <div className="normal-block-header-content">
          <div className="normal-block-title-row">
            <div className="normal-block-indicator" />
            <input
              className="normal-block-title-input"
              value={name}
              onChange={(event) => onUpdateBlock?.(blockId, { name: event.target.value })}
              placeholder="블록 이름"
            />
          </div>
          <p className="normal-block-subtitle">Normal Block</p>
        </div>
        <button
          type="button"
          className="normal-block-drag"
          draggable
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData('application/x-block-source', JSON.stringify({
              blockId,
              blockName: name,
              blockType: 'normal'
            }));
            event.dataTransfer.setData('text/plain', name || blockId);
          }}
          aria-label="일반 블록 연결"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M5.25 7H8.75" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4.0835 9.3335C3.013 9.3335 2.16683 8.48733 2.16683 7.41683C2.16683 6.34633 3.013 5.50016 4.0835 5.50016H5.8335" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9.9165 5.50016C10.987 5.50016 11.8332 6.34633 11.8332 7.41683C11.8332 8.48733 10.987 9.3335 9.9165 9.3335H8.1665" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      <div className="normal-block-value">
        <span className="normal-block-label">Value</span>
        <input
          className="normal-block-value-input"
          value={value}
          onChange={(event) => onUpdateBlock?.(blockId, { value: event.target.value })}
          placeholder="값 입력"
        />
      </div>

      <div className="connection-point connection-point-top" />
      <div className="connection-point connection-point-right" />
      <div className="connection-point connection-point-bottom" />
      <div className="connection-point connection-point-left" />
    </div>
  );
}
