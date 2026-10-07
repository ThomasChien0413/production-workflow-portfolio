import type { ReactNode } from "react";

export type CardProps = {
  header?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function Card({ header, footer, children, className }: CardProps) {
  const classes = ["cc-card"];
  if (className) classes.push(className);

  return (
    <section className={classes.join(" ")}>
      {header ? <div className="cc-card__header">{header}</div> : null}
      {children ? <div className="cc-card__body">{children}</div> : null}
      {footer ? <div className="cc-card__footer">{footer}</div> : null}
    </section>
  );
}
