import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "tertiary"
  | "danger"
  | "danger-quiet";

export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** sm is desktop-dense-toolbar only; it is below the 44px touch minimum. */
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  /** Progressive-tense label shown while loading, e.g. 送出中… */
  loadingLabel?: ReactNode;
};

export function Button({
  variant = "secondary",
  size = "md",
  block = false,
  loading = false,
  loadingLabel,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const classes = ["cc-btn", `cc-btn--${variant}`];
  if (size !== "md") classes.push(`cc-btn--${size}`);
  if (block) classes.push("cc-btn--block");
  if (className) classes.push(className);

  return (
    <button
      className={classes.join(" ")}
      disabled={disabled === true || loading}
      aria-busy={loading ? true : undefined}
      {...rest}
    >
      {loading ? (
        <>
          <span className="cc-spinner" aria-hidden="true" />
          {loadingLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
