import type { ReactNode } from 'react';
import { cx } from './classnames.js';

/**
 * The non-happy states.
 *
 * UX-09 makes loading, empty, error and stale a launch requirement, and the
 * apps were meeting it with bare sentences like `Loading this store's items…`
 * dropped into the flow. Each of these keeps the shape of the content it stands
 * in for, so nothing jumps when the real content arrives.
 */

export function Skeleton({
  className,
  lines = 1,
  variant = 'text',
}: {
  readonly className?: string | undefined;
  readonly lines?: number | undefined;
  readonly variant?: 'text' | 'block' | 'tile' | undefined;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx('ns-skeleton', `ns-skeleton--${variant}`, className)}
      data-lines={lines}
    >
      {Array.from({ length: lines }, (_unused, index) => (
        <span className="ns-skeleton__line" key={index} />
      ))}
    </span>
  );
}

/**
 * A loading region that announces itself once, rather than a spinner a screen
 * reader never mentions.
 */
export function LoadingState({
  className,
  label,
  lines = 3,
}: {
  readonly label: string;
  readonly className?: string | undefined;
  readonly lines?: number | undefined;
}) {
  return (
    <div aria-busy="true" aria-live="polite" className={cx('ns-loading', className)}>
      <span className="sr-only">{label}</span>
      <Skeleton lines={lines} variant="block" />
    </div>
  );
}

export type EmptyStateProps = {
  readonly title: string;
  readonly description?: ReactNode | undefined;
  readonly action?: ReactNode | undefined;
  readonly glyph?: string | undefined;
  readonly className?: string | undefined;
};

/** Nothing here — and what to do about it. */
export function EmptyState({
  action,
  className,
  description,
  glyph = '◌',
  title,
}: EmptyStateProps) {
  return (
    <div className={cx('ns-state', 'ns-state--empty', className)}>
      <span aria-hidden="true" className="ns-state__glyph">
        {glyph}
      </span>
      <div className="ns-state__body">
        <p className="ns-state__title">{title}</p>
        {description ? <p className="ns-state__description">{description}</p> : null}
      </div>
      {action ? <div className="ns-state__action">{action}</div> : null}
    </div>
  );
}

export type ErrorStateProps = {
  readonly title: string;
  readonly description?: ReactNode | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly retryLabel?: string | undefined;
  readonly className?: string | undefined;
  /** A support or correlation reference, so a customer can quote it. */
  readonly reference?: string | undefined;
};

/** Something failed, and the one action that might fix it. */
export function ErrorState({
  className,
  description,
  onRetry,
  reference,
  retryLabel = 'Try again',
  title,
}: ErrorStateProps) {
  return (
    <div className={cx('ns-state', 'ns-state--error', className)} role="alert">
      <span aria-hidden="true" className="ns-state__glyph">
        ⚠
      </span>
      <div className="ns-state__body">
        <p className="ns-state__title">{title}</p>
        {description ? <p className="ns-state__description">{description}</p> : null}
        {reference ? <p className="ns-state__reference">Reference {reference}</p> : null}
      </div>
      {onRetry ? (
        <div className="ns-state__action">
          <button
            className="ns-button ns-button--secondary ns-button--medium"
            onClick={onRetry}
            type="button"
          >
            <span className="ns-button__label">{retryLabel}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export type NoticeTone = 'information' | 'success' | 'warning' | 'danger';

/**
 * An inline message.
 *
 * `assertive` only for something the user must act on now; everything else is
 * polite, so a status update does not interrupt what is being read.
 */
export function Notice({
  children,
  className,
  live = 'polite',
  tone = 'information',
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly live?: 'assertive' | 'polite' | 'off' | undefined;
  readonly tone?: NoticeTone | undefined;
}) {
  const glyph = tone === 'success' ? '✓' : tone === 'warning' ? '⚠' : tone === 'danger' ? '✕' : 'ℹ';
  const word =
    tone === 'success'
      ? 'Success'
      : tone === 'warning'
        ? 'Warning'
        : tone === 'danger'
          ? 'Error'
          : 'Note';
  return (
    <p
      aria-live={live === 'off' ? undefined : live}
      className={cx('ns-notice', `ns-notice--${tone}`, className)}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <span aria-hidden="true" className="ns-notice__glyph">
        {glyph}
      </span>
      <span className="sr-only">{word}: </span>
      <span className="ns-notice__body">{children}</span>
    </p>
  );
}
