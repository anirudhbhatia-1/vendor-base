import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './classnames.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ControlSize = 'small' | 'medium' | 'large';

type NativeButton = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>;

export type ButtonProps = NativeButton & {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  /** Renders a spinner and blocks interaction without changing the layout. */
  readonly busy?: boolean | undefined;
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ControlSize | undefined;
  /** Fills the available inline space — the default on the checkout column. */
  readonly block?: boolean | undefined;
  readonly leading?: ReactNode | undefined;
};

/**
 * The single button.
 *
 * Four surfaces previously each declared `.primary` and `.secondary` twice and
 * then forced them with `!important`. Variants here are semantic, and the
 * minimum target comes from `--touch-target`, which the role themes raise to
 * 48px for vendor and partner (UX-02).
 */
export function Button({
  busy = false,
  children,
  className,
  block = false,
  leading,
  size = 'medium',
  type = 'button',
  variant = 'primary',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-busy={busy || undefined}
      disabled={rest.disabled === true || busy}
      className={cx(
        'ns-button',
        `ns-button--${variant}`,
        `ns-button--${size}`,
        block && 'ns-button--block',
        className,
      )}
    >
      {busy ? <span className="ns-button__spinner" aria-hidden="true" /> : leading}
      <span className="ns-button__label">{children}</span>
    </button>
  );
}

export type IconButtonProps = NativeButton & {
  /** Required: the control has no visible text, so it must carry its own name. */
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly variant?: ButtonVariant | undefined;
  readonly pressed?: boolean | undefined;
};

/** A square control whose only content is a glyph. */
export function IconButton({
  children,
  className,
  label,
  pressed,
  variant = 'ghost',
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cx('ns-icon-button', `ns-button--${variant}`, className)}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

/**
 * An action that lives inside a sentence.
 *
 * Exempt from the 44px target under the WCAG 2.5.8 inline exception, so it must
 * stay genuinely inline — never used as a row of standalone controls.
 */
export function TextAction({
  children,
  className,
  type = 'button',
  ...rest
}: NativeButton & { readonly children: ReactNode; readonly className?: string }) {
  return (
    <button {...rest} type={type} className={cx('ns-text-action', className)}>
      {children}
    </button>
  );
}
