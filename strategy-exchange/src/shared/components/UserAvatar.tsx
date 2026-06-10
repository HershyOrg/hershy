type UserAvatarProps = {
  name: string;
  src?: string;
  className?: string;
};

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function UserAvatar({ name, src, className = "" }: UserAvatarProps) {
  const classes = ["user-avatar", className].filter(Boolean).join(" ");

  return (
    <span className={classes} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" /> : <span>{getInitials(name)}</span>}
    </span>
  );
}
