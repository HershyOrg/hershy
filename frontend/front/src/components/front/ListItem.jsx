import './ListItem.css';

export default function ListItem({
  label = 'Item',
  active = false,
  className = '',
  style
}) {
  const classes = [
    'front-list-item',
    active ? 'front-list-item--active' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} style={style}>
      <span className="front-list-item__label">{label}</span>
    </div>
  );
}
