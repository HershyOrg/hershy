import type { ComponentProps } from "react";

type ButtonVariant = "plain" | "back" | "use" | "drop" | "fork" | "save";

const variantClassNames: Record<ButtonVariant, string> = {
  plain: "",
  back: "back-button",
  use: "use-button",
  drop: "drop-button",
  fork: "fork-button",
  save: "save-draft-button",
};

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
};

export function Button({ variant = "plain", className = "", type = "button", ...props }: ButtonProps) {
  const variantClassName = variantClassNames[variant];
  const mergedClassName = [variantClassName, className].filter(Boolean).join(" ");

  return <button type={type} className={mergedClassName || undefined} {...props} />;
}
