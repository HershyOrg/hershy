import './KeyValueCard.css';

export default function KeyValueCard({
  label = 'KEY',
  value = 'VALUE',
  layout = 'stack',
  variant = 'default',
  valueTone = 'default',
  className = '',
  style
}) {
  const classes = [
    'front-key-value-card',
    layout === 'row' ? 'front-key-value-card--row' : 'front-key-value-card--stack',
    variant === 'accent' ? 'front-key-value-card--accent' : 'front-key-value-card--default',
    className
  ].filter(Boolean).join(' ');

  const valueClassName = [
    'front-key-value-card__value',
    valueTone === 'muted' ? 'is-muted' : '',
    valueTone === 'positive' ? 'is-positive' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} style={style}>
      <span className="front-key-value-card__label">{label}</span>
      <span className={valueClassName}>{value}</span>
    </div>
  );
}
