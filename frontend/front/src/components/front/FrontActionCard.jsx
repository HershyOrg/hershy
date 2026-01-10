import './FrontActionCard.css';

const DEFAULT_FIELDS = [
  { label: 'key', value: '', placeholder: 'value' },
  { label: 'key', value: '', placeholder: 'value' }
];

export default function FrontActionCard({
  title = 'Action Block',
  description = 'description',
  tag = 'F1',
  statusColor = '#10B981',
  fields = DEFAULT_FIELDS,
  ctaLabel,
  className = '',
  style
}) {
  const resolvedFields = Array.isArray(fields) ? fields : [];
  const resolvedCtaLabel = ctaLabel || title;
  const cardClassName = ['front-action-card', className].filter(Boolean).join(' ');

  return (
    <div className={cardClassName} style={style}>
      <div className="front-action-card__header">
        <span className="front-action-card__status" style={{ background: statusColor }} />
        <span className="front-action-card__tag">{tag}</span>
      </div>

      <div className="front-action-card__body">
        <div className="front-action-card__title">{title}</div>
        <div className="front-action-card__description">{description}</div>

        <div className="front-action-card__fields">
          {resolvedFields.map((field, index) => {
            const rawValue = field?.value;
            const hasValue = rawValue !== undefined && rawValue !== null && String(rawValue).length > 0;
            const displayValue = hasValue
              ? String(rawValue)
              : String(field?.placeholder ?? 'value');

            return (
              <div key={`${field?.label ?? 'field'}-${index}`} className="front-action-card__field">
                <span className="front-action-card__field-label">{field?.label ?? 'key'}</span>
                <div
                  className={`front-action-card__field-value${hasValue ? '' : ' is-placeholder'}`}
                >
                  {displayValue}
                </div>
              </div>
            );
          })}
        </div>

        <button type="button" className="front-action-card__cta">
          {resolvedCtaLabel}
        </button>
      </div>
    </div>
  );
}
