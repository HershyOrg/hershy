function ForkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 3.25a2.25 2.25 0 1 1-2.75 2.19v5.12A2.25 2.25 0 1 1 1 10.56V5.44A2.25 2.25 0 1 1 5 3.25Zm-.75 0a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0ZM3.5 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.25-8.75a2.25 2.25 0 1 0-3 2.12v1.19c0 .72-.29 1.25-.72 1.62-.47.4-1.12.63-1.78.75V10h1.5V8.99a5.1 5.1 0 0 0 2.01-.86 3.24 3.24 0 0 0 1.24-2.57V5.37a2.25 2.25 0 0 0 1.75-2.12Zm-.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
      />
    </svg>
  );
}

export function ForkBadge({ count }: { count: number }) {
  return (
    <span className="fork-badge" aria-label={`Forks: ${count}`}>
      <ForkIcon />
      <span>Fork</span>
      <strong>{count}</strong>
    </span>
  );
}
