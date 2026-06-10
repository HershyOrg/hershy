type ToggleOption<T extends string> = {
  label: string;
  value: T;
};

export function ToggleGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  className = "view-toggle",
}: {
  label: string;
  options: Array<ToggleOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={className} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? "active" : ""}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
